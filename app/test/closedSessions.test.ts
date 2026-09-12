// Sessions fermées dans les palettes : filtre et sous-liste par projet.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { KovaSessionEntry } from '@/protocol';
import { closedMatching, closedOfProject } from '@/features/sessions/closedSessions';

function entry(partial: Partial<KovaSessionEntry> & { sessionId: string }): KovaSessionEntry {
  return {
    cwd: '/Users/robin/dev/link',
    projectName: 'link',
    title: 'Application iOS Kova',
    lastActiveMs: 1_789_234_000_000,
    promptCount: 1,
    state: 'closed',
    paneId: null,
    ...partial,
  };
}

const SESSIONS = [
  entry({ sessionId: 'open-1', state: 'open', paneId: 3, title: 'Session vivante' }),
  entry({ sessionId: 'c1', title: 'Agrégateur investissements Finary', cwd: '/Users/robin/perso/Investissements', projectName: 'Investissements', lastActiveMs: 3 }),
  entry({ sessionId: 'c2', title: 'Analyse de maquette', lastActiveMs: 2 }),
  entry({ sessionId: 'c3', title: 'Echo bonjour', lastActiveMs: 1 }),
  entry({ sessionId: 'c4', title: 'Vieille session link', lastActiveMs: 0 }),
];

describe('sessions fermées', () => {
  it('closedMatching ne rend que les fermées, filtrées sur libellé, projet et dossier', () => {
    assert.deepEqual(closedMatching(SESSIONS, '').map((s) => s.sessionId), ['c1', 'c2', 'c3', 'c4']);
    assert.deepEqual(closedMatching(SESSIONS, 'finary').map((s) => s.sessionId), ['c1']);
    assert.deepEqual(closedMatching(SESSIONS, 'LINK').map((s) => s.sessionId), ['c2', 'c3', 'c4']);
    assert.deepEqual(closedMatching(SESSIONS, 'vivante'), []);
  });

  it('closedOfProject : les plus récentes du dossier, trois au plus', () => {
    assert.deepEqual(closedOfProject(SESSIONS, '/Users/robin/dev/link').map((s) => s.sessionId), ['c2', 'c3', 'c4']);
    assert.deepEqual(closedOfProject(SESSIONS, '/Users/robin/dev/link', 2).map((s) => s.sessionId), ['c2', 'c3']);
    assert.deepEqual(closedOfProject(SESSIONS, '/nulle/part'), []);
  });
});
