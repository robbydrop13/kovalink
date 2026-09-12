// Envoi de texte libre. Le geste de tous les jours depuis D1 : l'agent a fini, Robin lit,
// Robin donne la suite.
//
// Trois régimes, et un seul énoncé (C23, design 4.5) :
//  - hors `awaiting` : autorisé, aucune authentification. C'est le cas dominant ;
//  - `awaiting` avec un prompt PARSÉ ouvert : REFUSÉ. Robin a les boutons numérotés, qui
//    sont sûrs. Taper `1` puis Envoyer serait une approbation sans hash ni relecture ;
//  - `awaiting` sans prompt parsé (`unparsable`) : autorisé APRÈS Face ID, parce qu'on ne
//    peut pas exclure que la frappe soit un chiffre qui approuve.
//
// La double barrière est volontaire : l'app évite la frustration d'un envoi refusé, le
// daemon garantit qu'aucune reprise de file ni aucun bug d'état ne fait partir un chiffre
// déguisé en phrase. Aucun filtrage côté app : un seul point d'entrée, côté daemon.
//
// Pièces jointes (docs/15) : elles sont téléversées AVANT le texte, par la file de
// transferts du bloc Fichiers, et le texte ne part que si toutes sont arrivées. Le message
// envoyé est alors le texte suivi d'un chemin par ligne. Un message avec pièces suit la
// même file hors ligne qu'un texte : ses pièces voyagent avec lui, et repartent à la
// reconnexion.
import { ImpactStyle, impact } from '@/utils/haptics';
import type { ActionResponse, Prompt } from '@/protocol';
import { t } from '@/i18n/en';
import { HttpError, postText } from '@/net/http';
import { enqueue, dequeue, replaceJob, OUTBOX_TTL_MS, countPending, TEXT_QUEUE_MAX, type OutboxJob } from '@/db/outbox';
import { isDegraded, useConnection } from '@/store/connection';
import { composeMessage, type Attachment } from '@/features/chat/attachments';
import { AttachmentError, uploadAttachments } from './attachments';
import { confirmWithFaceId } from './faceId';
import { nonce } from './nonce';

export type SendTextOutcome =
  | { ok: true; result: ActionResponse; nonce: string; attachments: Attachment[] }
  | { ok: false; kind: 'locked' | 'cancelled' | 'queue_full' }
  | { ok: false; kind: 'queued'; nonce: string; attachments: Attachment[] }
  /** Refus explicite du daemon : rien ne sert de le remettre en file, on dit pourquoi. */
  | { ok: false; kind: 'refused'; cause: string };

/** Ce qu'un travail `text` de la file porte. Les `uri` sont locaux à l'iPhone. */
export interface TextPayload {
  text: string;
  attachments?: Attachment[];
  destDir?: string;
  /** Robin a déjà accepté le seuil cellulaire pour cet envoi (A4) : on ne redemande pas. */
  cellularApproved?: boolean;
}

export interface Pieces {
  items: Attachment[];
  /** Dossier de session sur le Mac, `attachmentsDir(sessionId)` du protocole. */
  destDir: string;
  cellularApproved: boolean;
}

export function payloadOf(job: OutboxJob): TextPayload {
  const p = job.payload as Partial<TextPayload>;
  return {
    text: String(p.text ?? ''),
    attachments: Array.isArray(p.attachments) ? p.attachments : [],
    ...(typeof p.destDir === 'string' ? { destDir: p.destDir } : {}),
    cellularApproved: p.cellularApproved === true,
  };
}

/**
 * Pièces d'abord, puis le message composé. Rend le texte à envoyer au Mac.
 *
 * Chaque pièce arrivée est persistée dans le travail de file AVANT de passer à la
 * suivante : si l'app meurt entre deux, la reprise ne renvoie pas ce qui est déjà là.
 * Partagé entre l'envoi immédiat et la vidange de la file : un seul chemin.
 */
export async function materialize(job: OutboxJob): Promise<string> {
  const payload = payloadOf(job);
  const pieces = payload.attachments ?? [];
  if (pieces.length === 0) return payload.text;
  if (!payload.destDir) throw new AttachmentError(pieces[0] as Attachment, t.attachmentNoDestDir, 'BAD_REQUEST');
  const arrived = await uploadAttachments(pieces, payload.destDir, {
    cellularApproved: payload.cellularApproved ?? false,
    onDone: async (a) => {
      const current = payloadOf(job);
      const next = (current.attachments ?? []).map((x) => (x.id === a.id ? a : x));
      job.payload = { ...current, attachments: next };
      await replaceJob(job);
    },
  });
  return composeMessage(payload.text, arrived);
}

export async function sendText(
  paneId: number,
  text: string,
  prompt: Prompt | undefined,
  pieces: Pieces | null = null,
): Promise<SendTextOutcome> {
  if (prompt?.state === 'parsed') return { ok: false, kind: 'locked' };

  if (prompt?.state === 'unparsable') {
    const ok = await confirmWithFaceId(t.faceIdSendFreeText);
    if (!ok) return { ok: false, kind: 'cancelled' };
  }

  if ((await countPending('text')) >= TEXT_QUEUE_MAX) return { ok: false, kind: 'queue_full' };

  impact(ImpactStyle.Light);

  const id = nonce();
  const now = Date.now();
  const payload: TextPayload = pieces
    ? { text, attachments: pieces.items, destDir: pieces.destDir, cellularApproved: pieces.cellularApproved }
    : { text };
  const job: OutboxJob = {
    nonce: id,
    kind: 'text',
    paneId,
    payload: payload as unknown as Record<string, unknown>,
    createdAt: now,
    expiresAt: now + OUTBOX_TTL_MS.text,
    attempts: 0,
  };
  await enqueue(job);

  // Mac injoignable : inutile de tenter trois reprises de transfert pour le constater.
  // Le message reste en file avec ses pièces, comme un texte (P5).
  if (pieces && pieces.items.length > 0 && isDegraded(useConnection.getState().link)) {
    return { ok: false, kind: 'queued', nonce: id, attachments: pieces.items };
  }

  let message: string;
  try {
    message = await materialize(job);
  } catch (e) {
    if (e instanceof AttachmentError && e.final) {
      // Le Mac a dit non pour cette pièce (liste noire, empreinte, disque plein). Rien
      // n'est envoyé, la file est vidée de ce message, et la cause est montrée telle
      // quelle : les vignettes restent dans le composer pour un nouvel essai.
      await dequeue(id);
      return { ok: false, kind: 'refused', cause: e.message };
    }
    // Panne réseau au milieu d'un transfert : le message et ses pièces restent en file.
    return { ok: false, kind: 'queued', nonce: id, attachments: payloadOf(job).attachments ?? [] };
  }
  const attachments = payloadOf(job).attachments ?? [];

  try {
    const result = await postText(paneId, message, id);
    await dequeue(id);
    return { ok: true, result, nonce: id, attachments };
  } catch (e) {
    if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) {
      // Le daemon a répondu et a refusé (pane sans agent, texte trop long, question en
      // attente). Le mettre en file le ferait repartir en boucle : on le retire et on
      // affiche la cause exacte au lieu d'un « message en attente » mensonger.
      await dequeue(id);
      return { ok: false, kind: 'refused', cause: t.refusedCause(e.code, e.message) };
    }
    // Vraie panne réseau : mis en file, pas rejeté (P5). Revalidé à la reprise.
    return { ok: false, kind: 'queued', nonce: id, attachments };
  }
}
