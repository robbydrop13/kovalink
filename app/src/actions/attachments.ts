// Téléversement des pièces jointes d'un message (docs/15, point 2).
//
// RIEN de nouveau ici : chaque pièce passe par la file de transferts de l'écran Fichiers
// (`queueUpload`), donc par le même hachage SHA-256, le même upload en flux par morceaux
// de 4 Mo, la même reprise, la même vérification d'empreinte au `complete`. Ce module se
// contente d'enchaîner les pièces dans l'ordre et de rendre leurs chemins sur le Mac.
import { attachmentName } from '@/protocol';
import { t } from '@/i18n/en';
import { isFinalCode, queueUpload, useTransfers, waitForTransfer } from '@/store/transfers';
import type { Attachment } from '@/features/chat/attachments';

/** Échec d'une pièce : le message du daemon tel quel, et s'il sert à quelque chose de réessayer. */
export class AttachmentError extends Error {
  constructor(
    readonly attachment: Attachment,
    message: string,
    readonly code: string | null,
  ) {
    super(t.attachmentError(attachment.name, message));
    this.name = 'AttachmentError';
  }

  /** Vrai pour un refus du Mac (liste noire, empreinte, disque). Faux pour une panne réseau. */
  get final(): boolean {
    return isFinalCode(this.code) || this.code === 'ABORTED';
  }
}

/**
 * Téléverse, une à la fois et dans l'ordre, les pièces qui n'ont pas encore de chemin.
 *
 * S'arrête à la PREMIÈRE pièce en échec : les suivantes ne partent pas, l'appelant
 * n'envoie pas le texte, et les pièces déjà arrivées gardent leur chemin pour qu'un
 * nouvel essai ne les renvoie pas (docs/15, point 4). `onDone` est appelé à chaque pièce
 * arrivée, pour que l'appelant persiste le chemin au fur et à mesure.
 */
export async function uploadAttachments(
  attachments: readonly Attachment[],
  destDir: string,
  o: { cellularApproved?: boolean; onDone?: (a: Attachment) => void | Promise<void> } = {},
): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const a of attachments) {
    if (a.path) {
      out.push(a);
      continue;
    }
    const transferId = `${a.id}-${Date.now()}`;
    await queueUpload(
      {
        id: transferId,
        uri: a.uri,
        filename: attachmentName(a.name),
        size: a.size,
        destDir,
        destLabel: t.attachmentDestLabel,
      },
      { cellularApproved: o.cellularApproved ?? false },
    );
    let path: string;
    try {
      const done = await waitForTransfer(transferId);
      // Le dossier est celui du protocole (racine `/tmp`), le nom est celui que le Mac a
      // RÉELLEMENT écrit, collision comprise. Voir `ATTACHMENTS_ROOT` sur `/private/tmp`.
      path = `${destDir}/${done.finalName ?? attachmentName(a.name)}`;
    } catch (e) {
      const err = e as Error & { code?: string | null };
      throw new AttachmentError(a, err.message, err.code ?? null);
    } finally {
      // La ligne a fait son office : l'écran Fichiers n'a pas à afficher les pièces du chat.
      useTransfers.getState().remove(transferId);
    }
    const arrived = { ...a, path };
    out.push(arrived);
    await o.onDone?.(arrived);
  }
  return out;
}
