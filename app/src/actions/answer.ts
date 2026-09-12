// Répondre à un prompt de validation.
//
// Ce qui part est TOUJOURS un `optionIndex`, jamais un libellé, jamais un retour chariot
// seul (C1). Le chiffre imprimé dans le badge du bouton EST la valeur envoyée.
// Le `promptHash` et l'`awaitingSince` accompagnent la réponse : le daemon relit le pane et
// refuse si l'écran a changé.
import type { ActionResponse, OptionKind } from '@/protocol';
import { HttpError, postAnswer } from '@/net/http';
import { enqueue, dequeue, OUTBOX_TTL_MS } from '@/db/outbox';
import { confirmWithFaceId, optionRequiresFaceId } from './faceId';
import { nonce } from './nonce';

export type AnswerOutcome =
  | { ok: true; result: ActionResponse }
  | { ok: false; kind: 'cancelled' }
  /**
   * `cause` porte le message RÉEL du daemon. Sans lui, un 403 `FORBIDDEN_ACTION` et un
   * Mac éteint produisaient le même « Mac injoignable » : c'est ce brouillage qui a coûté
   * une journée. `retryable` dit si la mise en file a un sens.
   */
  | { ok: false; kind: 'refused' | 'network'; cause: string; retryable: boolean };

export interface AnswerRequest {
  paneId: number;
  optionIndex: number;
  optionKind: OptionKind;
  optionLabel: string;
  promptHash: string;
  awaitingSince: string;
}

export async function answerPrompt(req: AnswerRequest): Promise<AnswerOutcome> {
  if (optionRequiresFaceId(req.optionKind)) {
    const ok = await confirmWithFaceId(`Confirmer : ${req.optionLabel}`);
    if (!ok) return { ok: false, kind: 'cancelled' };
  }

  const id = nonce();
  const now = Date.now();
  // Persistance AVANT toute I/O réseau, et TTL de 60 s : une approbation vieille de deux
  // heures ne doit jamais partir.
  await enqueue({
    nonce: id,
    kind: 'answer',
    paneId: req.paneId,
    payload: {
      optionIndex: req.optionIndex,
      promptHash: req.promptHash,
      awaitingSince: req.awaitingSince,
    },
    createdAt: now,
    expiresAt: now + OUTBOX_TTL_MS.answer,
  });

  try {
    const result = await postAnswer(req.paneId, {
      optionIndex: req.optionIndex,
      promptHash: req.promptHash,
      awaitingSince: req.awaitingSince,
      nonce: id,
    });
    await dequeue(id);
    return { ok: true, result };
  } catch (e) {
    if (e instanceof HttpError) {
      // 409 PROMPT_CHANGED : le daemon a relu le pane et la question n'est plus celle que
      // Robin a lue. Rien n'a été envoyé. C'est l'état `hash_mismatch`, distinct d'un refus
      // et distinct d'`expired` : la barre le dit et affiche la nouvelle question.
      if (e.status === 409 && e.code === 'PROMPT_CHANGED') {
        await dequeue(id);
        return { ok: true, result: { applied: false, reason: 'prompt_changed' } };
      }
      // 4xx : le daemon a répondu et a refusé. Réessayer ne changera rien, et laisser le
      // travail en file ferait repartir un refus toutes les reconnexions.
      const refused = e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
      if (refused) await dequeue(id);
      return {
        ok: false,
        kind: refused ? 'refused' : 'network',
        cause: `${e.status} ${e.code} : ${e.message}`,
        retryable: !refused,
      };
    }
    return {
      ok: false,
      kind: 'network',
      cause: e instanceof Error ? e.message : String(e),
      retryable: true,
    };
  }
}
