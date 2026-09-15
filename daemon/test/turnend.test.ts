import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const PROJECTS = mkdtempSync(join(tmpdir(), 'kovalink-projects-'));
process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-turnend-'));
process.env['KOVALINK_CLAUDE_PROJECTS'] = PROJECTS;
process.env['KOVALINK_QUIET'] = '1';

const { PaneStore } = await import('../src/kova/panes.js');
const { PromptRefs } = await import('../src/prompt/refs.js');
const { TurnEndDetector, DEBOUNCE_MS, formatDuration, formatTurnEndSubtitle } = await import(
  '../src/turnEnd.js'
);
const { DEFAULT_CONFIG } = await import('../src/config.js');
const { projectSlug } = await import('../src/paths.js');

const CWD = '/Users/alice/dev/projet';
const SESSION = 'sess-42';

function writeTranscript(lines: unknown[]): void {
  const dir = join(PROJECTS, projectSlug(CWD));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSION}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

const closedTurn = [
  { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'corrige' } },
  {
    type: 'assistant',
    uuid: 'a1',
    requestId: 'req_A',
    apiBlockIndex: 0,
    timestamp: '2026-09-10T10:04:12.000Z',
    message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tout passe.' }] },
  },
];

const pendingTool = [
  { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'corrige' } },
  {
    type: 'assistant',
    uuid: 'a1',
    requestId: 'req_A',
    apiBlockIndex: 0,
    timestamp: '2026-09-10T10:04:12.000Z',
    message: {
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
    },
  },
];

function setup() {
  const panes = new PaneStore();
  panes.upsertRaw({
    id: 66,
    window: 0,
    tab: 1,
    cwd: CWD,
    title: 'cc',
    pid: 1,
    agent: 'claude',
    agent_session_id: SESSION,
    working: true,
    awaiting: false,
    child_processes: [],
  });
  const refs = new PromptRefs();
  const cfg = { ...DEFAULT_CONFIG, push: { ...DEFAULT_CONFIG.push, minWorkingMsForTurnEnd: 0 } };
  const detector = new TurnEndDetector(panes, refs, () => cfg);
  const events: unknown[] = [];
  detector.on('turn-end', (p: unknown) => events.push(p));
  return { panes, detector, events, refs };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('detection de fin de tour (D1)', () => {
  it('front descendant de pane-working + tour clos dans le JSONL : notification', async () => {
    writeTranscript(closedTurn);
    const { panes, detector, events } = setup();
    panes.setWorking(66, false);
    await wait(DEBOUNCE_MS + 150);
    detector.stop();
    assert.equal(events.length, 1);
    const prompt = events[0] as { state: string; summary: string; promptRef: string };
    assert.equal(prompt.state, 'turn_end');
    assert.equal(prompt.summary, 'Tout passe.');
    assert.ok(prompt.promptRef.length > 0);
  });

  it('front descendant sans tour clos : rien, c est un outil long qui rend la main', async () => {
    writeTranscript(pendingTool);
    const { panes, detector, events } = setup();
    panes.setWorking(66, false);
    await wait(DEBOUNCE_MS + 150);
    detector.stop();
    assert.deepEqual(events, []);
  });

  it('le pane repart pendant l anti-rebond : la notification est annulee', async () => {
    writeTranscript(closedTurn);
    const { panes, detector, events } = setup();
    panes.setWorking(66, false);
    await wait(200);
    panes.setWorking(66, true);
    await wait(DEBOUNCE_MS + 150);
    detector.stop();
    assert.deepEqual(events, []);
  });

  it('awaiting n est jamais un declencheur sur cette machine', async () => {
    writeTranscript(closedTurn);
    const { panes, detector, events } = setup();
    panes.setAwaiting(66, true, new Date().toISOString());
    await wait(DEBOUNCE_MS + 150);
    detector.stop();
    assert.deepEqual(events, [], 'aucun push ne doit dependre de awaiting');
  });

  it('un pane sans agent claude ne notifie jamais', async () => {
    writeTranscript(closedTurn);
    const { panes, detector, events } = setup();
    panes.upsertRaw({
      id: 66,
      window: 0,
      tab: 1,
      cwd: CWD,
      title: 'shell',
      pid: 1,
      agent: null,
      agent_session_id: null,
      working: true,
      awaiting: false,
      child_processes: [],
    });
    panes.setWorking(66, false);
    await wait(DEBOUNCE_MS + 150);
    detector.stop();
    assert.deepEqual(events, []);
  });
});

/**
 * C29, CA-30 : le seuil de 60 s est une valeur opposable. Il est teste ICI a sa vraie
 * valeur (`DEFAULT_CONFIG.push.minWorkingMsForTurnEnd`), avec une horloge simulee :
 * le test precedent le mettait a 0, donc ne le testait pas.
 */
describe('seuil de 60 s de travail avant notification (C29)', () => {
  const THRESHOLD = DEFAULT_CONFIG.push.minWorkingMsForTurnEnd;
  const FAST_DEBOUNCE = 30;

  function setupClock() {
    let clock = 1_000_000;
    const panes = new PaneStore(() => clock);
    panes.upsertRaw({
      id: 66,
      window: 0,
      tab: 1,
      cwd: CWD,
      title: 'cc',
      pid: 1,
      agent: 'claude',
      agent_session_id: SESSION,
      working: false,
      awaiting: false,
      child_processes: [],
    });
    const refs = new PromptRefs();
    const detector = new TurnEndDetector(panes, refs, () => DEFAULT_CONFIG, {
      debounceMs: FAST_DEBOUNCE,
    });
    const events: unknown[] = [];
    detector.on('turn-end', (p: unknown) => events.push(p));
    return { panes, detector, events, advance: (ms: number) => (clock += ms) };
  }

  it('la valeur par defaut est bien 60 000 ms', () => {
    assert.equal(THRESHOLD, 60_000);
  });

  it('un tour de 59 999 ms ne notifie pas', async () => {
    writeTranscript(closedTurn);
    const { panes, detector, events, advance } = setupClock();
    panes.setWorking(66, true);
    advance(THRESHOLD - 1);
    panes.setWorking(66, false);
    await wait(FAST_DEBOUNCE + 60);
    detector.stop();
    assert.deepEqual(events, []);
  });

  it('un tour de 60 000 ms notifie, avec la duree reelle dans le prompt', async () => {
    writeTranscript(closedTurn);
    const { panes, detector, events, advance } = setupClock();
    panes.setWorking(66, true);
    advance(THRESHOLD);
    panes.setWorking(66, false);
    await wait(FAST_DEBOUNCE + 60);
    detector.stop();
    assert.equal(events.length, 1);
    const prompt = events[0] as { durationMs: number | null; subtitle: string };
    assert.equal(prompt.durationMs, THRESHOLD);
    assert.equal(prompt.subtitle, '1m 00s, 0 tools');
  });

  it('un tour de 55 279 ms, la valeur vue dans le journal, est ignore', async () => {
    writeTranscript(closedTurn);
    const { panes, detector, events, advance } = setupClock();
    panes.setWorking(66, true);
    advance(55_279);
    panes.setWorking(66, false);
    await wait(FAST_DEBOUNCE + 60);
    detector.stop();
    assert.deepEqual(events, []);
  });
});

describe('references de prompt (R3)', () => {
  it('reste valable pour plusieurs lecteurs, pas un usage unique', async () => {
    const { PromptRefs: Refs } = await import('../src/prompt/refs.js');
    const refs = new Refs();
    const ref = refs.mint(66, SESSION);
    assert.ok(refs.resolve(ref));
    assert.ok(refs.resolve(ref), 'la NSE, l action rapide et le lien profond la lisent');
    assert.ok(refs.resolve(ref));
  });

  it('expire au bout de 10 minutes', async () => {
    const { PromptRefs: Refs, PROMPT_REF_TTL_MS } = await import('../src/prompt/refs.js');
    const refs = new Refs();
    const now = Date.now();
    const ref = refs.mint(66, SESSION, now);
    assert.ok(refs.resolve(ref, now + PROMPT_REF_TTL_MS - 1));
    assert.equal(refs.resolve(ref, now + PROMPT_REF_TTL_MS), null);
  });

  it('est invalidee des que le pane reprend la main', async () => {
    const { PromptRefs: Refs } = await import('../src/prompt/refs.js');
    const refs = new Refs();
    const ref = refs.mint(66, SESSION);
    refs.invalidatePane(66);
    assert.equal(refs.resolve(ref), null);
  });
});

describe('sous-titre de la banniere de fin de tour', () => {
  it('formate une duree lisible', () => {
    assert.equal(formatDuration(42_000), '42s');
    assert.equal(formatDuration(252_000), '4m 12s');
    assert.equal(formatDuration(3_900_000), '1h 05m');
    assert.equal(formatDuration(-5), '0s');
  });

  it('rend le gabarit du PRD : duree puis nombre d outils', () => {
    assert.equal(formatTurnEndSubtitle(252_000, 11), '4m 12s, 11 tools');
    assert.equal(formatTurnEndSubtitle(1000, 1), '1s, 1 tool');
  });

  it('omet la duree quand elle est inconnue, sans laisser de virgule pendante', () => {
    assert.equal(formatTurnEndSubtitle(null, 3), '3 tools');
    assert.equal(formatTurnEndSubtitle(0, 0), '0 tools');
  });

  it('ne porte aucun contenu de conversation (A14)', () => {
    const subtitle = formatTurnEndSubtitle(252_000, 11);
    assert.equal(/[a-z]{6,}/.test(subtitle.replace(/tools?/g, '')), false);
  });
});
