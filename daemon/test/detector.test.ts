import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-test-'));
process.env['KOVALINK_QUIET'] = '1';

const { PromptDetector, PROMPT_DEBOUNCE_MS, PROMPT_POLL_MS } = await import('../src/prompt/detector.js');
const { PromptRefs } = await import('../src/prompt/refs.js');
const { PaneStore } = await import('../src/kova/panes.js');

const FIXTURES = resolve(fileURLToPath(new URL('../../test/fixtures', import.meta.url)));
const fixture = (name: string): string => readFileSync(resolve(FIXTURES, name), 'utf8');
const BASH_1 = fixture('prompt-bash-consecutive-1.txt');
const BASH_2 = fixture('prompt-bash-consecutive-2.txt');
const IDLE = fixture('screen-idle.txt');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeFixture(screen: string) {
  const panes = new PaneStore();
  const raw = {
    id: 15,
    window: 2,
    tab: 2,
    cwd: '/nonexistent/kovalink-fixture', // aucun JSONL : hasPendingTool rend false
    title: 'claude',
    pid: 1,
    agent: 'claude',
    agent_session_id: 'sess-15',
    working: true,
    awaiting: false,
    child_processes: [],
  };
  panes.upsertRaw(raw);
  let current = screen;
  const prompts = {
    fresh: async (paneId: number) => ({ id: paneId, text: current, cols: 221, rows: 64, cursor: { row: 0, col: 0 } }),
    invalidate: () => {},
    setScreen: (s: string) => {
      current = s;
    },
  };
  const refs = new PromptRefs();
  const detector = new PromptDetector(panes, prompts, refs);
  const events: { type: string; state?: string; hash?: string }[] = [];
  detector.on('prompt', (p: { state: string; promptHash?: string }) =>
    events.push({ type: 'prompt', state: p.state, hash: p.promptHash }),
  );
  detector.on('resolved', () => events.push({ type: 'resolved' }));
  return { panes, prompts, detector, events, raw };
}

describe('PromptDetector : awaiting synthetise sur le front descendant de pane-working', () => {
  it('front descendant + ecran qui parse : awaiting pose, prompt parsed emis', async () => {
    const { panes, detector, events } = makeFixture(BASH_1);
    panes.setWorking(15, false);
    assert.equal(panes.get(15)?.awaiting, false, 'rien avant l anti-rebond');
    await sleep(PROMPT_DEBOUNCE_MS + 150);
    const pane = panes.get(15);
    assert.equal(pane?.awaiting, true);
    assert.equal(typeof pane?.awaiting_since, 'string');
    assert.equal(pane?.liveState, 'awaiting');
    assert.equal(panes.isSyntheticAwaiting(15), true);
    assert.deepEqual(events.map((e) => [e.type, e.state]), [['prompt', 'parsed']]);
    detector.stop();
  });

  it('front descendant + ecran idle sans outil en attente : rien, c est une fin de tour', async () => {
    const { panes, detector, events } = makeFixture(IDLE);
    panes.setWorking(15, false);
    await sleep(PROMPT_DEBOUNCE_MS + 150);
    assert.equal(panes.get(15)?.awaiting, false);
    assert.deepEqual(events, []);
    detector.stop();
  });

  it('front montant pendant l anti-rebond : evaluation annulee', async () => {
    const { panes, detector, events } = makeFixture(BASH_1);
    panes.setWorking(15, false);
    await sleep(PROMPT_DEBOUNCE_MS / 2);
    panes.setWorking(15, true);
    await sleep(PROMPT_DEBOUNCE_MS);
    assert.equal(panes.get(15)?.awaiting, false);
    assert.deepEqual(events, []);
    detector.stop();
  });

  it('Claude repart (working true) : awaiting leve, resolved emis', async () => {
    const { panes, detector, events } = makeFixture(BASH_1);
    panes.setWorking(15, false);
    await sleep(PROMPT_DEBOUNCE_MS + 150);
    assert.equal(panes.get(15)?.awaiting, true);
    panes.setWorking(15, true);
    assert.equal(panes.get(15)?.awaiting, false);
    assert.equal(panes.get(15)?.awaiting_since, null);
    assert.equal(events.at(-1)?.type, 'resolved');
    detector.stop();
  });

  it('deux prompts consecutifs : deux awaitingSince differents, deux hashs differents', async () => {
    const { panes, prompts, detector, events } = makeFixture(BASH_1);
    panes.setWorking(15, false);
    await sleep(PROMPT_DEBOUNCE_MS + 150);
    const first = panes.get(15)?.awaiting_since;
    panes.setWorking(15, true);
    await sleep(5);
    prompts.setScreen(BASH_2);
    panes.setWorking(15, false);
    await sleep(PROMPT_DEBOUNCE_MS + 150);
    const second = panes.get(15)?.awaiting_since;
    assert.ok(first && second && first !== second);
    const hashes = events.filter((e) => e.type === 'prompt').map((e) => e.hash);
    assert.equal(hashes.length, 2);
    assert.notEqual(hashes[0], hashes[1]);
    detector.stop();
  });

  it('un instantane Kova avec awaiting:false n ecrase pas un awaiting synthetise', async () => {
    const { panes, detector, raw } = makeFixture(BASH_1);
    panes.setWorking(15, false);
    await sleep(PROMPT_DEBOUNCE_MS + 150);
    const since = panes.get(15)?.awaiting_since;
    panes.upsertRaw({ ...raw, working: false, awaiting: false, focused: true });
    assert.equal(panes.get(15)?.awaiting, true);
    assert.equal(panes.get(15)?.awaiting_since, since);
    panes.setAwaiting(15, false, null, 'kova');
    assert.equal(panes.get(15)?.awaiting, true, 'seul le daemon peut lever ce qu il a pose');
    detector.stop();
  });

  it('re-sondage : la question change a l ecran, un nouveau prompt est emis ; elle disparait, resolved', async () => {
    const { panes, prompts, detector, events } = makeFixture(BASH_1);
    panes.setWorking(15, false);
    await sleep(PROMPT_DEBOUNCE_MS + 150);
    prompts.setScreen(BASH_2);
    await sleep(PROMPT_POLL_MS + 150);
    const prompted = events.filter((e) => e.type === 'prompt');
    assert.equal(prompted.length, 2);
    assert.notEqual(prompted[0]?.hash, prompted[1]?.hash);
    prompts.setScreen(IDLE); // Robin a repondu sur le Mac
    await sleep(PROMPT_POLL_MS + 150);
    assert.equal(events.at(-1)?.type, 'resolved');
    assert.equal(panes.get(15)?.awaiting, false);
    detector.stop();
  });

  it('pane sans agent claude : jamais evalue', async () => {
    const { panes, detector, events, raw } = makeFixture(BASH_1);
    panes.upsertRaw({ ...raw, agent: null, agent_session_id: null });
    panes.setWorking(15, false);
    await sleep(PROMPT_DEBOUNCE_MS + 150);
    assert.equal(panes.get(15)?.awaiting, false);
    assert.deepEqual(events, []);
    detector.stop();
  });
});
