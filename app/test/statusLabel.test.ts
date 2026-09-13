import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentStatus } from '@/features/chat/statusLabel';

const base = { degraded: false, closed: false, awaiting: false, working: false, workingSince: null, finishedAt: null };
const now = 1_000_000_000;

describe('agentStatus', () => {
  it('travaille, avec la durée écoulée', () => {
    const s = agentStatus({ ...base, working: true, workingSince: now - 72_000 }, now);
    assert.deepEqual(s, { kind: 'working', label: 'Working · 1m 12s' });
    assert.equal(agentStatus({ ...base, working: true }, now).label, 'Working');
  });
  it('attend ta réponse prime sur travaille (A2)', () => {
    assert.equal(agentStatus({ ...base, working: true, awaiting: true }, now).kind, 'awaiting');
  });
  it('terminé il y a n, puis inactif sans fin de tour connue', () => {
    assert.equal(agentStatus({ ...base, finishedAt: now - 180_000 }, now).label, 'Done 3 min ago');
    assert.equal(agentStatus(base, now).kind, 'idle');
  });
  it('hors ligne et fermée priment sur tout', () => {
    assert.equal(agentStatus({ ...base, degraded: true, working: true }, now).kind, 'offline');
    assert.equal(agentStatus({ ...base, closed: true, degraded: true }, now).kind, 'closed');
  });
});

describe('agentStatus, demarrage', () => {
  it('« Starting Claude » prime sur inactif et attend, jamais sur fermee ni hors ligne', () => {
    const base = { degraded: false, closed: false, awaiting: false, working: false, workingSince: null, finishedAt: null };
    assert.equal(agentStatus({ ...base, launching: true }).kind, 'starting');
    assert.equal(agentStatus({ ...base, launching: true, awaiting: true }).kind, 'starting');
    assert.equal(agentStatus({ ...base, launching: true, degraded: true }).kind, 'offline');
    assert.equal(agentStatus({ ...base, launching: true, closed: true }).kind, 'closed');
    assert.equal(agentStatus(base).kind, 'idle');
  });
});
