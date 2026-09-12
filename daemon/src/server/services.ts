import { NONCE_TTL_MS } from '@kovalink/protocol';
import type { KovalinkConfig } from '../config.js';
import type { KovaIpc } from '../kova/ipc.js';
import type { KeyGate } from '../kova/keygate.js';
import type { PaneStore } from '../kova/panes.js';
import type { AnswerRequest, AnswerResult } from '../prompt/answer.js';
import type { PromptRefs } from '../prompt/refs.js';
import type { PromptState } from '../prompt/state.js';
import type { SleepAssertion } from '../sleep.js';
import type { TranscriptTailer } from '../transcript/tailer.js';
import type { AuthFailures, RateLimiter } from './rate.js';

/**
 * Idempotence des actions d'ecriture.
 *
 * INVARIANT (`NONCE_TTL_MS`, cote protocole) : la fenetre doit couvrir le plus long TTL
 * de la file d'envoi de l'app. Elle valait 10 minutes contre 15 pour un message libre :
 * un envoi rejoue entre la dixieme et la quinzieme minute etait applique DEUX FOIS,
 * parce que son nonce avait deja ete oublie.
 */
export class NonceStore {
  private readonly seenAt = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = NONCE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Reserve un nonce, ATOMIQUEMENT : rend `false` s'il est deja connu, sinon le marque
   * et rend `true`. La marque est posee AVANT le premier `await` de l'appelant, sans
   * quoi deux requetes concurrentes portant le meme nonce passaient toutes deux la garde
   * (D1 de la revue securite : `seen` puis `remember` separes par des `await`).
   */
  reserve(nonce: string, now = Date.now()): boolean {
    this.sweep(now);
    if (this.seenAt.has(nonce)) return false;
    this.seenAt.set(nonce, now + this.ttlMs);
    return true;
  }

  /** Libere un nonce reserve dont l'action a ete REFUSEE : la meme reponse reste rejouable. */
  release(nonce: string): void {
    this.seenAt.delete(nonce);
  }

  sweep(now = Date.now()): void {
    for (const [n, exp] of this.seenAt) if (exp <= now) this.seenAt.delete(n);
  }
}

export interface Services {
  cfg: () => KovalinkConfig;
  daemonVersion: string;
  master: Buffer;
  ipc: KovaIpc;
  panes: PaneStore;
  keygate: KeyGate;
  prompts: PromptState;
  refs: PromptRefs;
  /** `answerPrompt()` lie a ses dependances : le SEUL chemin vers `KeyGate.emitAnswer`. */
  answer: (req: AnswerRequest, deviceId?: string) => Promise<AnswerResult>;
  tailer: TranscriptTailer;
  /** Anti-veille : le hub y applique `keepMacAwake` recu de l'app (A1). */
  sleep: SleepAssertion;
  rate: RateLimiter;
  authFailures: AuthFailures;
  nonces: NonceStore;
}
