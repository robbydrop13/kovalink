// File d'envoi différé.
//
// Règle non négociable (docs/03-architecture.md 3.4) : une réponse de validation a un TTL de
// 60 s et n'est JAMAIS envoyée au delà. Une approbation rejouée tardivement est le pire
// accident possible. Un message libre vit 15 min, file plafonnée à 5 ; au delà de 15 min il
// n'est PAS purgé mais mis en attente de confirmation (CA-122) : Robin décide, l'app ne
// jette pas un texte écrit dans le train en silence.
//
// Découpage : la logique (expiration, ordre, comptage) est écrite en JS sur un `OutboxStore`
// minimal, et SQLite n'est qu'un adaptateur de ce store. C'est ce qui permet de tester
// `purgeExpired` sous Node avec un store en mémoire, sans module natif.
import {
  OUTBOX_ANSWER_TTL_MS,
  OUTBOX_INTERRUPT_TTL_MS,
  OUTBOX_TEXT_MAX,
  OUTBOX_TEXT_TTL_MS,
} from '@/protocol';
import { db } from './index';

export type OutboxKind = 'answer' | 'interrupt' | 'text';

/**
 * Les TTL vivent dans le protocole : le daemon calibre sa fenêtre d'idempotence
 * (`NONCE_TTL_MS`) sur le plus long d'entre eux. Les deux valeurs étaient écrites
 * séparément, et le texte survivait 15 min à des nonces oubliés au bout de 10 : un envoi
 * rejoué dans cette fenêtre partait DEUX FOIS.
 */
export const OUTBOX_TTL_MS: Record<OutboxKind, number> = {
  answer: OUTBOX_ANSWER_TTL_MS,
  interrupt: OUTBOX_INTERRUPT_TTL_MS,
  text: OUTBOX_TEXT_TTL_MS,
};

export const TEXT_QUEUE_MAX = OUTBOX_TEXT_MAX;

export interface OutboxJob {
  nonce: string;
  kind: OutboxKind;
  paneId: number;
  payload: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

/** Le strict nécessaire pour porter la file. SQLite en prod, un tableau dans les tests. */
export interface OutboxStore {
  all(): Promise<OutboxJob[]>;
  /** Insère ou remplace : le `nonce` est la clé. */
  put(job: OutboxJob): Promise<void>;
  delete(nonce: string): Promise<void>;
  bumpAttempt(nonce: string): Promise<void>;
}

interface Row {
  nonce: string;
  kind: string;
  pane_id: number;
  payload: string;
  created_at: number;
  expires_at: number;
  attempts: number;
}

function toJob(r: Row): OutboxJob {
  return {
    nonce: r.nonce,
    kind: r.kind as OutboxKind,
    paneId: r.pane_id,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    attempts: r.attempts,
  };
}

const sqliteStore: OutboxStore = {
  async all() {
    const rows = await (await db()).getAllAsync<Row>('SELECT * FROM outbox');
    return rows.map(toJob);
  },
  async put(job) {
    await (await db()).runAsync(
      'INSERT OR REPLACE INTO outbox (nonce, kind, pane_id, payload, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)',
      job.nonce,
      job.kind,
      job.paneId,
      JSON.stringify(job.payload),
      job.createdAt,
      job.expiresAt,
      job.attempts,
    );
  },
  async delete(nonce) {
    await (await db()).runAsync('DELETE FROM outbox WHERE nonce = ?', nonce);
  },
  async bumpAttempt(nonce) {
    await (await db()).runAsync('UPDATE outbox SET attempts = attempts + 1 WHERE nonce = ?', nonce);
  },
};

let store: OutboxStore = sqliteStore;

/** Remplace le stockage. Réservé aux tests : la prod ne connaît que SQLite. */
export function useOutboxStore(next: OutboxStore | null): void {
  store = next ?? sqliteStore;
}

/** Vrai quand le travail n'a plus le droit de partir. La borne est INCLUSE : à `expiresAt`, c'est fini. */
export function isExpired(job: Pick<OutboxJob, 'expiresAt'>, now: number): boolean {
  return job.expiresAt <= now;
}

export async function enqueue(job: Omit<OutboxJob, 'attempts'>): Promise<void> {
  await store.put({ ...job, attempts: 0 });
}

/** Réécrit un travail tel quel, tentatives comprises : une pièce jointe arrivée est persistée ici. */
export async function replaceJob(job: OutboxJob): Promise<void> {
  await store.put({ ...job });
}

export async function dequeue(nonce: string): Promise<void> {
  await store.delete(nonce);
}

export async function bumpAttempt(nonce: string): Promise<void> {
  await store.bumpAttempt(nonce);
}

/**
 * Vrai pour un texte au delà de ses 15 min : il attend une confirmation, il n'est ni
 * envoyé ni purgé (CA-122). Une réponse ou une interruption expirée n'attend rien : purgée.
 */
export function awaitsConfirmation(job: Pick<OutboxJob, 'kind' | 'expiresAt'>, now: number): boolean {
  return job.kind === 'text' && isExpired(job, now);
}

/** Supprime les réponses et interruptions expirées et rend la liste de ce qui a été abandonné. */
export async function purgeExpired(now = Date.now()): Promise<OutboxJob[]> {
  const expired = (await store.all()).filter((j) => isExpired(j, now) && !awaitsConfirmation(j, now));
  for (const job of expired) await store.delete(job.nonce);
  return expired;
}

/** Ce qui reste à envoyer sans rien demander, du plus ancien au plus récent. */
export async function pending(now = Date.now()): Promise<OutboxJob[]> {
  return (await store.all())
    .filter((j) => !isExpired(j, now))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Textes de plus de 15 min qui attendent le choix de Robin, du plus ancien au plus récent. */
export async function staleTexts(now = Date.now()): Promise<OutboxJob[]> {
  return (await store.all())
    .filter((j) => awaitsConfirmation(j, now))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Robin confirme : le texte repart avec 15 min de vie neuves et le MÊME nonce. Le daemon
 * a peut-être oublié ce nonce (fenêtre d'idempotence alignée sur 15 min) : c'est la
 * confirmation explicite, prise devant le transcript, qui tient lieu de garde-fou.
 */
export async function confirmStale(nonce: string, now = Date.now()): Promise<void> {
  const job = (await store.all()).find((j) => j.nonce === nonce);
  if (!job) return;
  await store.put({ ...job, expiresAt: now + OUTBOX_TTL_MS.text });
}

export async function countPending(kind?: OutboxKind): Promise<number> {
  const live = await pending();
  return kind ? live.filter((j) => j.kind === kind).length : live.length;
}
