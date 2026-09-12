// Index des sessions ouvertes et fermees (PRD 3.4, design 4.11) et reprise d'une session
// fermee. Donnees calquees sur la machine de Robin le 12 septembre, anonymisees : quatre
// panes ouverts, 62 transcripts sur disque, un index Kova en retard de deux jours.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Pane, Tab } from '@kovalink/protocol';

const PROJECTS = mkdtempSync(join(tmpdir(), 'kovalink-sessions-projects-'));
process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-sessions-'));
process.env['KOVALINK_CLAUDE_PROJECTS'] = PROJECTS;
process.env['KOVALINK_KOVA_HISTORY'] = join(PROJECTS, 'claude_history.json');
process.env['KOVALINK_QUIET'] = '1';

const { mergeSessions, scanTranscripts, readKovaHistory, findSession, isSessionId } = await import('../src/kova/sessions.js');
const { resumeSession } = await import('../src/kova/resume.js');
const { projectSlug } = await import('../src/paths.js');
type DiskSession = import('../src/kova/sessions.js').DiskSession;
type KovaHistoryEntry = import('../src/kova/sessions.js').KovaHistoryEntry;

const LINK = '18567852-dee8-4afe-9408-214e119953e7';
const TRAIL = 'a8fce9d9-3e41-4207-97a2-1e168ae42fea';
const CLOSED_A = '65cd7b48-89fa-4eb2-b245-cc16d52521ab';
const CLOSED_B = 'a444aea0-10c1-4c4e-9a1d-000000000002';
const GONE_DIR = 'b7a7b664-3240-4f2f-8f31-000000000003';

function pane(id: number, tab: number, cwd: string, sessionId: string | null): Pane {
  return {
    id, window: 0, tab, cwd, title: 'claude', focused: false, pid: 1, child_processes: [], is_idle: false,
    working: false, awaiting: false, awaiting_since: null, awaiting_seen: false, minimized: false,
    agent: sessionId ? 'claude' : null, agent_session_id: sessionId, agent_session_name: null,
    claude_session_id: null, claude_session_name: null, projectName: cwd.split('/').pop() ?? cwd,
    hasTranscript: true, chatCapable: true, permissionMode: null, color: null, liveState: 'idle',
  };
}
function tab(id: number, index: number): Tab {
  return { id, window: 0, tab_index: index, title: null, pane_count: 1, focused_pane_id: 0, active: false, has_bell: false, has_completion: false, has_running: false, color: null };
}
function disk(sessionId: string, cwd: string, firstPrompt: string, lastActiveMs: number, aiTitle: string | null = null): DiskSession {
  return { sessionId, cwd, firstPrompt, aiTitle, lastActiveMs, promptCount: 1 };
}

describe('mergeSessions', () => {
  const DISK = [
    disk(LINK, '/Users/robin/dev/link', 'Ok pour les sessions', 1_789_234_000_000, 'Application iOS Kova'),
    disk(TRAIL, '/Users/robin/perso/trail-coach', 'What can you tell me', 1_789_233_000_000),
    disk(CLOSED_A, '/Users/robin/claap/automation-prototype', 'ok is it good or work remaining?', 1_786_634_748_000),
    disk(CLOSED_B, '/Users/robin/claap/admin', 'tu peux faire un PDF de ça ?', 1_789_036_226_000),
  ];
  const KOVA = new Map<string, KovaHistoryEntry>([
    [CLOSED_A, { id: CLOSED_A, cwd: '/Users/robin/Claap/Product/automation-prototype', title: 'ok is it good or work remaining?', label: 'Proto automation' }],
  ]);
  const PANES = [pane(11, 3, '/Users/robin/perso/trail-coach', TRAIL), pane(3, 1, '/Users/robin/dev/link', LINK), pane(4, 1, '/Users/robin/dev/link', null)];
  const TABS = [tab(11, 0), tab(3, 1), tab(18, 2), tab(10, 3)];

  it('ouvertes d abord dans l ordre des onglets, puis fermees par derniere activite, sans doublon', () => {
    const out = mergeSessions(DISK, KOVA, PANES, TABS);
    assert.deepEqual(
      out.map((s) => [s.state, s.paneId, s.sessionId.slice(0, 8), s.title]),
      [
        ['open', 3, '18567852', 'Application iOS Kova'],
        ['open', 11, 'a8fce9d9', 'What can you tell me'],
        ['closed', null, 'a444aea0', 'tu peux faire un PDF de ça ?'],
        ['closed', null, '65cd7b48', 'Proto automation'],
      ],
    );
    assert.equal(new Set(out.map((s) => s.sessionId)).size, out.length, 'jamais deux fois le meme id');
  });

  it('le label Kova l emporte, sinon l ai-title, sinon le premier prompt ; le cwd vient du disque', () => {
    const out = mergeSessions(DISK, KOVA, [], []);
    const a = out.find((s) => s.sessionId === CLOSED_A);
    assert.equal(a?.title, 'Proto automation');
    assert.equal(a?.cwd, '/Users/robin/claap/automation-prototype', 'pas le cwd perime de Kova');
    assert.equal(a?.projectName, 'automation-prototype');
  });

  it('un pane ouvert dont le transcript n est pas indexe apparait quand meme, ouvert', () => {
    const out = mergeSessions([], new Map(), PANES, TABS);
    assert.deepEqual(out.map((s) => [s.state, s.paneId]), [['open', 3], ['open', 11]]);
  });
});

describe('scanTranscripts et claude_history.json', () => {
  const cwd = '/Users/robin/dev/closed-project';
  const cwdGone = join(PROJECTS, 'dossier-disparu');
  function writeTranscript(sessionId: string, dir: string, prompt: string, extra: string[] = []): void {
    const slug = join(PROJECTS, projectSlug(dir));
    mkdirSync(slug, { recursive: true });
    const lines = [
      { type: 'mode', mode: 'normal', sessionId },
      { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', cwd: dir, sessionId, message: { role: 'user', content: prompt } },
      { type: 'assistant', uuid: 'a1', requestId: 'r1', timestamp: '2026-09-10T10:00:05.000Z', cwd: dir, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fait.' }] } },
      ...extra.map((t) => ({ type: 'user', uuid: `ux${t.length}`, cwd: dir, message: { role: 'user', content: t } })),
    ];
    writeFileSync(join(slug, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }
  writeTranscript(CLOSED_A, cwd, 'range les fichiers du bureau');
  writeTranscript(GONE_DIR, cwdGone, 'un projet dont le dossier a disparu');
  // Un transcript sans aucun prompt humain (tool_result seul) : pas une session a lister.
  mkdirSync(join(PROJECTS, projectSlug(cwd)), { recursive: true });
  writeFileSync(join(PROJECTS, projectSlug(cwd), 'a444aea0-10c1-4c4e-9a1d-000000000009.jsonl'), `${JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } })}\n`);
  // Un fichier qui n a pas un nom de session.
  writeFileSync(join(PROJECTS, projectSlug(cwd), 'notes.jsonl'), '{}\n');
  writeFileSync(process.env['KOVALINK_KOVA_HISTORY'] as string, JSON.stringify({ version: 1, sessions: { [`${cwd}:${CLOSED_A}`]: { id: CLOSED_A, cwd, title: 'range les fichiers du bureau', last_active: 1_789_036_226, prompts: '1', resumes: 0 } } }));

  it('indexe les transcripts par la tete du fichier : cwd, premier prompt, sans les sous-agents', () => {
    const list = scanTranscripts();
    assert.deepEqual(list.map((d) => d.sessionId).sort(), [CLOSED_A, GONE_DIR].sort());
    const a = list.find((d) => d.sessionId === CLOSED_A);
    assert.equal(a?.cwd, cwd);
    assert.equal(a?.firstPrompt, 'range les fichiers du bureau');
  });

  it('lit l index de Kova quelle que soit sa forme (objet ou tableau), par identifiant', () => {
    const byId = readKovaHistory();
    assert.equal(byId.get(CLOSED_A)?.title, 'range les fichiers du bureau');
    assert.equal(isSessionId('pas un uuid'), false);
    assert.equal(findSession('../../etc/passwd', [], []), null);
  });
});

describe('resumeSession', () => {
  function harness(paneAppears: boolean) {
    const requests: Record<string, unknown>[] = [];
    const launched: number[] = [];
    const store = new Map<number, Pane>();
    const services = {
      ipc: {
        request: async (payload: Record<string, unknown>) => {
          requests.push(payload);
          if (paneAppears) store.set(42, pane(42, 5, String(payload['cwd']), null));
          return { ok: true, data: { tab_id: 9, pane_id: 42 } };
        },
      },
      panes: { all: () => [...store.values()], allTabs: () => [], get: (id: number) => store.get(id) },
      keygate: {
        emitLaunch: async (paneId: number) => {
          launched.push(paneId);
          return { applied: true };
        },
      },
    };
    return { services: services as never, requests, launched };
  }

  it('refuse un identifiant inconnu ou mal forme, sans rien lancer', async () => {
    const { services, requests } = harness(true);
    const unknown = await resumeSession(services, 'a444aea0-10c1-4c4e-9a1d-ffffffffffff', 'dev');
    assert.deepEqual(unknown, { ok: false, status: 404, code: 'SESSION_NOT_FOUND', message: 'session not in the index' });
    const bad = await resumeSession(services, 'x; rm -rf /', 'dev');
    assert.equal(bad.ok, false);
    assert.equal(requests.length, 0);
  });

  it('refuse une session dont le dossier a disparu', async () => {
    const { services, requests } = harness(true);
    const out = await resumeSession(services, GONE_DIR, 'dev');
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.status, 400);
    assert.equal(requests.length, 0);
  });

  it('un seul new-tab, commande construite par le daemon, puis l Entree sur le pane cree', async () => {
    // Le cwd doit exister : on reecrit le transcript de CLOSED_A vers un dossier reel.
    const real = mkdtempSync(join(tmpdir(), 'kovalink-resume-cwd-'));
    const slug = join(PROJECTS, projectSlug(real));
    mkdirSync(slug, { recursive: true });
    const sid = 'c0ffee00-1111-4222-8333-444444444444';
    writeFileSync(join(slug, `${sid}.jsonl`), `${JSON.stringify({ type: 'user', uuid: 'u', cwd: real, message: { role: 'user', content: 'reprends' } })}\n`);
    const { services, requests, launched } = harness(true);
    const out = await resumeSession(services, sid, 'dev', 500);
    assert.deepEqual(requests, [{ cmd: 'new-tab', cwd: real, command: `claude --resume ${sid}` }]);
    assert.deepEqual(launched, [42]);
    assert.deepEqual(out, { ok: true, response: { tabId: 9, paneId: 42, cwd: real, launched: true, alreadyOpen: false } });
  });

  it('une session deja ouverte rend son pane, sans new-tab', async () => {
    const { services, requests } = harness(true);
    const open = pane(7, 0, '/Users/robin/dev/x', CLOSED_A);
    const svc = { ...(services as object), panes: { all: () => [open], allTabs: () => [], get: () => open } } as never;
    const out = await resumeSession(svc, CLOSED_A, 'dev');
    assert.deepEqual(out, { ok: true, response: { tabId: null, paneId: 7, cwd: '/Users/robin/dev/x', launched: false, alreadyOpen: true } });
    assert.equal(requests.length, 0);
  });
});
