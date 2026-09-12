// `purgeExpired` : une réponse de validation expirée n'est JAMAIS envoyée (architecture 3.4).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { OUTBOX_ANSWER_TTL_MS, OUTBOX_TEXT_TTL_MS } from '@kovalink/protocol';
import {
  OUTBOX_TTL_MS,
  awaitsConfirmation,
  confirmStale,
  countPending,
  dequeue,
  enqueue,
  isExpired,
  pending,
  purgeExpired,
  staleTexts,
  useOutboxStore,
  type OutboxJob,
  type OutboxStore,
} from '@/db/outbox';

/** Store en mémoire : le même contrat que SQLite, sans SQLite. */
function memoryStore(): OutboxStore & { rows: Map<string, OutboxJob> } {
  const rows = new Map<string, OutboxJob>();
  return {
    rows,
    all: async () => [...rows.values()],
    put: async (job) => {
      rows.set(job.nonce, { ...job });
    },
    delete: async (nonce) => {
      rows.delete(nonce);
    },
    bumpAttempt: async (nonce) => {
      const j = rows.get(nonce);
      if (j) j.attempts += 1;
    },
  };
}

const T0 = 1_700_000_000_000;

function job(nonce: string, kind: OutboxJob['kind'], createdAt: number): Omit<OutboxJob, 'attempts'> {
  return {
    nonce,
    kind,
    paneId: 7,
    payload: { text: nonce },
    createdAt,
    expiresAt: createdAt + OUTBOX_TTL_MS[kind],
  };
}

describe('purgeExpired', () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
    useOutboxStore(store);
  });
  afterEach(() => useOutboxStore(null));

  it('les TTL viennent du protocole, pas d’une copie locale', () => {
    assert.equal(OUTBOX_TTL_MS.answer, OUTBOX_ANSWER_TTL_MS);
    assert.equal(OUTBOX_TTL_MS.text, OUTBOX_TEXT_TTL_MS);
    assert.ok(OUTBOX_TTL_MS.answer <= 60_000, 'une réponse de validation ne vit jamais plus de 60 s');
  });

  it('une réponse de validation de plus de 60 s est abandonnée, un texte récent reste', async () => {
    await enqueue(job('a-vieille', 'answer', T0));
    await enqueue(job('t-recent', 'text', T0));
    const now = T0 + OUTBOX_TTL_MS.answer + 1;
    const abandoned = await purgeExpired(now);
    assert.deepEqual(abandoned.map((j) => j.nonce), ['a-vieille']);
    assert.deepEqual((await pending(now)).map((j) => j.nonce), ['t-recent']);
    assert.equal(store.rows.has('a-vieille'), false, 'la ligne est réellement supprimée');
  });

  it("la borne est incluse : à l'instant exact d'expiration, c'est fini", async () => {
    await enqueue(job('a', 'answer', T0));
    assert.equal(isExpired({ expiresAt: T0 + 10 }, T0 + 10), true);
    assert.equal(isExpired({ expiresAt: T0 + 10 }, T0 + 9), false);
    assert.equal((await purgeExpired(T0 + OUTBOX_TTL_MS.answer)).length, 1);
  });

  it('un texte de plus de 15 min n’est NI purgé NI envoyé : il attend une confirmation (CA-122)', async () => {
    await enqueue(job('t-vieux', 'text', T0));
    await enqueue(job('t-neuf', 'text', T0 + OUTBOX_TTL_MS.text - 1));
    await enqueue(job('a-vieille', 'answer', T0));
    const now = T0 + OUTBOX_TTL_MS.text;
    assert.deepEqual((await purgeExpired(now)).map((j) => j.nonce), ['a-vieille'], 'seule la réponse est abandonnée');
    assert.equal(store.rows.has('t-vieux'), true, 'le texte reste en base');
    assert.deepEqual((await pending(now)).map((j) => j.nonce), ['t-neuf'], 'il ne part pas tout seul');
    assert.deepEqual((await staleTexts(now)).map((j) => j.nonce), ['t-vieux']);
    assert.equal(awaitsConfirmation({ kind: 'answer', expiresAt: T0 }, now), false);
  });

  it('confirmé, le texte repart avec 15 min neuves et le MÊME nonce ; abandonné, il disparaît', async () => {
    await enqueue(job('t1', 'text', T0));
    await enqueue(job('t2', 'text', T0));
    const now = T0 + OUTBOX_TTL_MS.text + 60_000;
    await confirmStale('t1', now);
    assert.deepEqual((await pending(now)).map((j) => j.nonce), ['t1']);
    assert.equal(store.rows.get('t1')?.expiresAt, now + OUTBOX_TTL_MS.text);
    assert.deepEqual((await staleTexts(now)).map((j) => j.nonce), ['t2']);
    await dequeue('t2');
    assert.deepEqual(await staleTexts(now), []);
    await confirmStale('inconnu', now);
    assert.equal(store.rows.size, 1, 'un nonce inconnu ne crée rien');
  });

  it('rien d’expiré : rien de supprimé, et le rapport est vide', async () => {
    await enqueue(job('a', 'answer', T0));
    await enqueue(job('t', 'text', T0));
    assert.deepEqual(await purgeExpired(T0 + 1), []);
    assert.equal(store.rows.size, 2);
  });

  it('est idempotente : une seconde purge ne rend plus rien', async () => {
    await enqueue(job('a', 'answer', T0));
    const now = T0 + OUTBOX_TTL_MS.answer;
    assert.equal((await purgeExpired(now)).length, 1);
    assert.equal((await purgeExpired(now)).length, 0);
  });

  it('pending ignore les expirés sans les supprimer, et trie du plus ancien au plus récent', async () => {
    await enqueue(job('t2', 'text', T0 + 10));
    await enqueue(job('t1', 'text', T0));
    await enqueue(job('a0', 'answer', T0));
    const now = T0 + OUTBOX_TTL_MS.answer + 1;
    assert.deepEqual((await pending(now)).map((j) => j.nonce), ['t1', 't2']);
    assert.equal(store.rows.has('a0'), true, 'pending ne purge pas, purgeExpired le fait');
  });

  it('countPending compte les vivants, par nature ou en tout', async () => {
    await enqueue(job('t1', 'text', Date.now()));
    await enqueue(job('i1', 'interrupt', Date.now()));
    assert.equal(await countPending('text'), 1);
    assert.equal(await countPending(), 2);
    await dequeue('t1');
    assert.equal(await countPending('text'), 0);
  });

  it('enqueue remplace un nonce déjà présent au lieu de le doubler', async () => {
    await enqueue(job('n', 'text', T0));
    await enqueue({ ...job('n', 'text', T0), payload: { text: 'v2' } });
    assert.equal(store.rows.size, 1);
    assert.deepEqual(store.rows.get('n')?.payload, { text: 'v2' });
    assert.equal(store.rows.get('n')?.attempts, 0);
  });
});
