// Interrompre. Contrat unique pour les quatre surfaces : la carte EN ATTENTE, la ligne
// TRAVAILLE, la barre de validation et la notification (C21, C32).
//
// Sur les quatre : message dédié `pane.interrupt {paneId}`, aucune confirmation, aucune
// authentification, haptique Heavy, libellé `Interrompre` et jamais autre chose.
import { ImpactStyle, impact } from '@/utils/haptics';
import type { ActionResponse } from '@/protocol';
import { postInterrupt } from '@/net/http';
import { enqueue, dequeue, OUTBOX_TTL_MS } from '@/db/outbox';
import { nonce } from './nonce';

export async function interruptPane(
  paneId: number,
  opts: { haptics?: boolean } = {},
): Promise<ActionResponse> {
  if (opts.haptics !== false) {
    impact(ImpactStyle.Heavy);
  }
  const id = nonce();
  const now = Date.now();
  await enqueue({
    nonce: id,
    kind: 'interrupt',
    paneId,
    payload: {},
    createdAt: now,
    expiresAt: now + OUTBOX_TTL_MS.interrupt,
  });
  try {
    const res = await postInterrupt(paneId, id);
    await dequeue(id);
    return res;
  } catch (e) {
    // Laissé dans la file : elle le purgera au bout de 60 s. Interrompre un agent qui a
    // fini depuis longtemps n'a aucun sens.
    throw e;
  }
}
