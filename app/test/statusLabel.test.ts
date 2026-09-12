import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentStatus } from '@/features/chat/statusLabel';

const base = { degraded: false, closed: false, awaiting: false, working: false, workingSince: null, finishedAt: null };
const now = 1_000_000_000;

describe('agentStatus', () => {
  it('travaille, avec la durée écoulée', () => {
    const s = agentStatus({ ...base, working: true, workingSince: now - 72_000 }, now);
    assert.deepEqual(s, { kind: 'working', label: 'Travaille · 1 min 12 s' });
    assert.equal(agentStatus({ ...base, working: true }, now).label, 'Travaille');
  });
  it('attend ta réponse prime sur travaille (A2)', () => {
    assert.equal(agentStatus({ ...base, working: true, awaiting: true }, now).kind, 'awaiting');
  });
  it('terminé il y a n, puis inactif sans fin de tour connue', () => {
    assert.equal(agentStatus({ ...base, finishedAt: now - 180_000 }, now).label, 'Terminé il y a 3 min');
    assert.equal(agentStatus(base, now).kind, 'idle');
  });
  it('hors ligne et fermée priment sur tout', () => {
    assert.equal(agentStatus({ ...base, degraded: true, working: true }, now).kind, 'offline');
    assert.equal(agentStatus({ ...base, closed: true, degraded: true }, now).kind, 'closed');
  });
});
