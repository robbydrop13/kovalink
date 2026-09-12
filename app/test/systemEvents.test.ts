// Les évènements du harnais ne sont jamais des bulles : lignes discrètes, bruit regroupé.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Turn } from '@/protocol';
import { feedItems, isQuietSystem } from '@/features/chat/systemEvents';
import { recentExchanges, withoutEchoed } from '@/store/session';

function turn(partial: Partial<Turn> & { id: string; seq: number }): Turn {
  return { kind: 'user', ts: '2026-09-12T18:00:00.000Z', uuids: [], blocks: [{ type: 'text', text: 'x' }], isSidechain: false, ...partial };
}
const notif = turn({ id: 'n', seq: 2, kind: 'system', systemTag: 'task-notification', summary: 'Agent "PRD" finished', blocks: [{ type: 'text', text: '<task-notification>…</task-notification>' }] });
const reminder = turn({ id: 'r1', seq: 3, kind: 'system', systemTag: 'system-reminder', summary: 'reminder' });
const meta = turn({ id: 'r2', seq: 4, kind: 'system', systemTag: null, summary: 'skill' });

describe('feedItems', () => {
  it('une notification reste une ligne ; les rappels consécutifs se regroupent', () => {
    const items = feedItems([turn({ id: 'u', seq: 1 }), notif, reminder, meta, turn({ id: 'a', seq: 5, kind: 'assistant' })]);
    assert.deepEqual(
      items.map((i) => (i.kind === 'quiet' ? `quiet:${i.turns.length}` : `${i.turn.kind}:${i.turn.id}`)),
      ['user:u', 'system:n', 'quiet:2', 'assistant:a'],
    );
    assert.equal(isQuietSystem(notif), false);
    assert.equal(isQuietSystem(reminder), true);
  });
});

describe('les tours system ne sont ni des échanges ni des échos', () => {
  it('recentExchanges ne compte que les vrais tours utilisateur', () => {
    const turns = [turn({ id: 'u1', seq: 1 }), turn({ id: 'a1', seq: 2, kind: 'assistant' }), notif, reminder];
    assert.equal(recentExchanges(turns, 1)[0]?.id, 'u1');
  });
  it('withoutEchoed ignore un tour system au même texte', () => {
    const pending = [{ nonce: 'p', text: 'Agent "PRD" finished', state: 'sent' as const, ts: '2026-09-12T17:59:00.000Z', afterSeq: 0, sessionId: 's1' }];
    const sys = turn({ id: 's', seq: 9, kind: 'system', systemTag: 'task-notification', blocks: [{ type: 'text', text: 'Agent "PRD" finished' }] });
    assert.equal(withoutEchoed(pending, [sys], 's1').length, 1);
  });
});
