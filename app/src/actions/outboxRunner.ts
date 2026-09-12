// Vidange de la file d'envoi, à la reconnexion et au lancement.
//
// Deux règles portent tout le fichier :
//  1. Les expirés sont purgés AVANT toute tentative. Une réponse de validation de plus de
//     60 s n'est jamais envoyée.
//  2. Un message en attente n'est PAS envoyé si le pane est entre temps passé en `awaiting`
//     avec un prompt parsé (C23) : il reste en file.
//  3. Un message avec pièces jointes (docs/15) téléverse d'abord ses pièces, par la même
//     file de transferts que l'écran Fichiers, et ne part que si toutes sont arrivées. Au
//     delà de 100 Mo en cellulaire, il attend le Wi-Fi ou un envoi explicite (A4) : la
//     vidange ne pose jamais la question à la place de Robin.
import { dequeue, bumpAttempt, pending, purgeExpired } from '@/db/outbox';
import { HttpError, postAnswer, postInterrupt, postText } from '@/net/http';
import { usePrompts } from '@/store/prompts';
import { needsCellularChoice } from '@/store/transfers';
import { totalSize } from '@/features/chat/attachments';
import { bootWarn } from '@/env';
import { AttachmentError } from './attachments';
import { materialize, payloadOf } from './sendText';
import { useOutboxNotices } from '@/store/outboxNotices';

let running = false;

export interface FlushReport {
  sent: number;
  held: number;
  abandoned: number;
  /** Retirés parce que le daemon les a explicitement refusés, avec la cause. */
  refused: { nonce: string; cause: string }[];
}

export async function flushOutbox(): Promise<FlushReport> {
  if (running) return { sent: 0, held: 0, abandoned: 0, refused: [] };
  running = true;
  const report: FlushReport = { sent: 0, held: 0, abandoned: 0, refused: [] };
  try {
    const expired = await purgeExpired();
    report.abandoned = expired.length;

    for (const job of await pending()) {
      const prompt = usePrompts.getState().byPane[job.paneId];
      if (job.kind === 'text' && prompt?.state === 'parsed') {
        report.held += 1;
        continue;
      }
      try {
        if (job.kind === 'answer') {
          await postAnswer(job.paneId, {
            optionIndex: Number(job.payload.optionIndex),
            promptHash: String(job.payload.promptHash),
            awaitingSince: String(job.payload.awaitingSince),
            nonce: job.nonce,
          });
        } else if (job.kind === 'interrupt') {
          await postInterrupt(job.paneId, job.nonce);
        } else {
          const payload = payloadOf(job);
          const pieces = payload.attachments ?? [];
          const waiting = pieces.filter((a) => !a.path);
          if (
            waiting.length > 0 &&
            !payload.cellularApproved &&
            (await needsCellularChoice(totalSize(waiting)))
          ) {
            report.held += 1;
            continue;
          }
          const result = await postText(job.paneId, await materialize(job), job.nonce);
          if (!result.applied) {
            // Le Mac a répondu mais n'a rien validé dans le pane (question apparue,
            // retour chariot jamais honoré). Ce n'est ni envoyé ni à rejouer en boucle :
            // on le retire, et la cause remonte jusqu'à la bulle.
            const cause = `non appliqué : ${result.reason ?? 'raison inconnue'}`;
            bootWarn('file d’attente, texte non appliqué', cause);
            await dequeue(job.nonce);
            report.refused.push({ nonce: job.nonce, cause });
            useOutboxNotices.getState().refuse(job.nonce, cause);
            continue;
          }
        }
        await dequeue(job.nonce);
        report.sent += 1;
      } catch (e) {
        // Un refus du daemon (4xx) ne se retente pas : sans ce tri, la file rejouait
        // indéfiniment un envoi condamné, en silence, à chaque reconnexion.
        const refusedByMac =
          (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) ||
          (e instanceof AttachmentError && e.final);
        if (refusedByMac) {
          const cause =
            e instanceof HttpError ? `${e.status} ${e.code} : ${e.message}` : (e as Error).message;
          bootWarn(`file d’attente, ${job.kind} refusé`, cause);
          await dequeue(job.nonce);
          report.refused.push({ nonce: job.nonce, cause });
          useOutboxNotices.getState().refuse(job.nonce, cause);
          continue;
        }
        bootWarn(`file d’attente, ${job.kind} différé`, e);
        await bumpAttempt(job.nonce);
        report.held += 1;
      }
    }
  } finally {
    running = false;
  }
  return report;
}
