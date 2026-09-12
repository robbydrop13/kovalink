import { timingSafeEqual } from 'node:crypto';
import { isPaneContentError, type ActionReason, type ActionResponse } from '@kovalink/protocol';
import { audit } from '../audit.js';
import type { KeyGate } from '../kova/keygate.js';
import type { PaneStore } from '../kova/panes.js';
import type { NonceStore } from '../server/services.js';
import { parsePromptText } from './parser.js';
import { hashPrompt, type PromptState } from './state.js';

/** Contrat arrete (C1, PRD 3.2) : jamais `approve`, jamais un libelle, toujours un rang. */
export interface AnswerRequest {
  paneId: number;
  optionIndex: number;
  promptHash: string;
  awaitingSince: string;
  nonce: string;
}

/** Reponse de `POST /v1/panes/:id/answer`, forme du protocole. */
export type AnswerResult = ActionResponse;

export interface AnswerDeps {
  panes: PaneStore;
  prompts: Pick<PromptState, 'fresh' | 'invalidate'>;
  keygate: Pick<KeyGate, 'emitAnswer'>;
  nonces: Pick<NonceStore, 'reserve' | 'release'>;
  /** Verrou par pane. Un seul par processus : le defaut du module sert en production. */
  lock?: PaneAnswerLock;
}

/**
 * Serialise les reponses PAR PANE et retient l'occurrence deja repondue.
 *
 * D1 de la revue securite : deux `pane.answer` concurrents avec le bon hash relisaient
 * tous deux l'ecran avant que le premier `emitAnswer` ne l'ait change, et le second
 * `chiffre + Entree` tombait sur l'ecran suivant. La relecture n'est pas un
 * compare-and-swap : il faut serialiser. Et comme l'ecran peut mettre quelques
 * millisecondes a bouger apres l'emission, la relecture seule ne suffit pas non plus :
 * on retient l'`awaiting_since` repondu, et toute reponse pour la meme occurrence est
 * un doublon, quel que soit ce que l'ecran montre a cet instant.
 */
export class PaneAnswerLock {
  private readonly tails = new Map<number, Promise<void>>();
  private readonly answered = new Map<number, string>();

  /** Execute `fn` quand aucune autre reponse n'est en cours sur ce pane. */
  async run<T>(paneId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(paneId) ?? Promise.resolve();
    let release: () => void = () => {};
    const mine = new Promise<void>((r) => {
      release = r;
    });
    const tail = prev.then(() => mine);
    this.tails.set(paneId, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(paneId) === tail) this.tails.delete(paneId);
    }
  }

  wasAnswered(paneId: number, awaitingSince: string): boolean {
    return this.answered.get(paneId) === awaitingSince;
  }

  markAnswered(paneId: number, awaitingSince: string): void {
    this.answered.set(paneId, awaitingSince);
  }
}

const defaultLock = new PaneAnswerLock();

/**
 * `timingSafeEqual` leve une RangeError si les longueurs different, ce qui
 * transformerait un hash malforme en 500 et divulguerait la longueur attendue. On
 * compare d'abord les longueurs, puis le contenu a temps constant.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Reponse a un prompt parse. C1 et C20 dans l'ordre strict, sans etape optionnelle.
 *
 * Ce que ce chemin interdit par construction : approuver sans avoir lu (il faut un
 * `optionIndex`, il n'existe aucun `approve` generique), approuver la mauvaise option (le
 * hash couvre les libelles), approuver une seconde demande identique en apparence (le
 * hash couvre le detail, `awaitingSince` couvre l'occurrence), approuver deux fois
 * (nonce), approuver un ecran perime (relecture fraiche, jamais le cache). La position
 * du curseur sur le Mac n'entre jamais dans la decision : le chiffre est emis tel quel.
 *
 * Tout refus rend `applied: false` SANS qu'un seul octet ait atteint le pane.
 */
export async function answerPrompt(
  deps: AnswerDeps,
  req: AnswerRequest,
  deviceId?: string,
): Promise<AnswerResult> {
  // Le nonce est reserve AVANT le premier `await` : deux requetes de meme nonce ne
  // peuvent plus passer la garde ensemble. Un refus le libere, une emission le garde.
  if (!deps.nonces.reserve(req.nonce)) return { applied: false, reason: 'duplicate' };
  const lock = deps.lock ?? defaultLock;
  try {
    const res = await lock.run(req.paneId, () => answerSerialized(deps, lock, req, deviceId));
    if (!res.applied) deps.nonces.release(req.nonce);
    return res;
  } catch (e) {
    deps.nonces.release(req.nonce);
    throw e;
  }
}

/** Corps de `answerPrompt`, execute sous le verrou du pane. */
async function answerSerialized(
  deps: AnswerDeps,
  lock: PaneAnswerLock,
  req: AnswerRequest,
  deviceId?: string,
): Promise<AnswerResult> {
  const deny = (reason: ActionReason, detail: string): AnswerResult => {
    audit({ deviceId, action: 'pane.answer', paneId: req.paneId, result: 'denied', detail });
    return { applied: false, reason };
  };

  // Occurrence deja repondue sous ce verrou : doublon, meme si l'ecran n'a pas encore bouge.
  if (lock.wasAnswered(req.paneId, req.awaitingSince)) {
    return deny('duplicate', 'already_answered');
  }

  const pane = deps.panes.get(req.paneId);
  if (!pane) return deny('pane_gone', 'pane_gone');
  if (!pane.awaiting || !pane.awaiting_since) return deny('not_awaiting', 'not_awaiting');
  // Garde 2 : meme occurrence de `awaiting`, independamment du texte.
  if (pane.awaiting_since !== req.awaitingSince) {
    return deny('prompt_changed', 'awaiting_since');
  }

  // Relecture SYSTEMATIQUE et fraiche : jamais un etat mis en cache.
  const pc = await deps.prompts.fresh(req.paneId);
  if (!pc || isPaneContentError(pc)) return deny('pane_gone', 'pane_gone');
  const core = parsePromptText(pc.text);
  if (!core) return deny('prompt_changed', 'unparsable_now');

  // Garde 1 : le hash couvre question, detail et options (C20).
  const current = hashPrompt(core.question, core.detail, core.options);
  if (!timingSafeEqualStr(current, req.promptHash)) {
    return deny('prompt_changed', 'hash_mismatch');
  }

  const opt = core.options.find((o) => o.index === req.optionIndex);
  if (!opt) return deny('prompt_changed', `option_${req.optionIndex}_absent`);

  // UN SEUL send-keys, chiffre et Entree ensemble, aucun delai (C1.3).
  await deps.keygate.emitAnswer(req.paneId, req.optionIndex);
  lock.markAnswered(req.paneId, req.awaitingSince);
  deps.prompts.invalidate(req.paneId);
  // Jamais le libelle dans le journal, seulement le rang et la nature.
  audit({
    deviceId,
    action: 'pane.answer',
    paneId: req.paneId,
    result: 'ok',
    detail: `index=${req.optionIndex} kind=${opt.kind}`,
  });
  return { applied: true };
}
