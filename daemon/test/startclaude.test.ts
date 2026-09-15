// `Start Claude here` depuis l'app : un pane qui n'est qu'un shell recoit `claude` et
// l'Entree, puis passe « en demarrage ». Un pane occupe rend 409 sans qu'une touche parte.
// Vrai `KeyGate` et vrai `KovaIpc` contre le faux Kova : ce qui l'atteint est exactement
// ce qui atteindrait le vrai.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { KEY_TABLE } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-startclaude-'));
process.env['KOVALINK_QUIET'] = '1';

const { KeyGate, LAUNCH_COMMAND } = await import('../src/kova/keygate.js');
const { PaneStore } = await import('../src/kova/panes.js');
const { KovaIpc, IpcError } = await import('../src/kova/ipc.js');
const { KOVA_EXEC, realDeps } = await import('../src/kova/discover.js');
const { startClaudeInPane, NEW_TAB_COMMAND } = await import('../src/kova/resume.js');
const { FakeKova } = await import('./helpers/fakeKova.js');

const fake = new FakeKova();
let ipc: InstanceType<typeof KovaIpc>;
before(async () => {
  await fake.start();
  ipc = new KovaIpc({ ...realDeps, socketDir: fake.dir, commOf: () => `${KOVA_EXEC}\n` });
  ipc.start();
  await new Promise((r) => ipc.once('ready', r));
});
after(() => {
  ipc.stop();
  fake.stop();
});

interface Sent {
  paneId: number;
  text: string;
}

function harness(overrides: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  const onCommand = (payload: Record<string, unknown>): void => {
    if (payload['cmd'] !== 'send-keys') return;
    sent.push({ paneId: payload['pane_id'] as number, text: payload['text'] as string });
  };
  fake.on('command', onCommand);
  const panes = new PaneStore();
  panes.upsertRaw({
    id: 71,
    window: 0,
    tab: 2,
    cwd: '/tmp/projet',
    title: 'zsh',
    pid: 1,
    agent: null,
    working: false,
    awaiting: false,
    child_processes: [],
    ...overrides,
  });
  const prompts = {
    current: async () => ({ state: 'none', paneId: 71 }),
    screen: async () => null,
  };
  const keygate = new KeyGate(ipc as never, panes, prompts as never);
  const services = { ipc, panes, keygate } as never;
  return { services, panes, sent, done: () => fake.off('command', onCommand) };
}

describe('startClaudeInPane', () => {
  it('un pane nu : `claude` et l Entree en un seul send-keys, puis le pane est en demarrage', async () => {
    const { services, panes, sent, done } = harness();
    assert.equal(panes.get(71)?.launching, false);
    const out = await startClaudeInPane(services, 71, 'dev');
    done();
    assert.deepEqual(out, { ok: true, response: { launched: true } });
    assert.equal(sent[0]?.paneId, 71);
    assert.equal(sent[0]?.text, `${NEW_TAB_COMMAND}${KEY_TABLE.enter}`);
    assert.equal(NEW_TAB_COMMAND, LAUNCH_COMMAND);
    assert.equal(panes.get(71)?.launching, true);
  });

  it('un pane inconnu : 404, rien n est envoye', async () => {
    const { services, sent, done } = harness();
    const out = await startClaudeInPane(services, 999, 'dev');
    done();
    assert.deepEqual(out, { ok: false, status: 404, code: 'PANE_NOT_FOUND', message: 'unknown pane' });
    assert.equal(sent.length, 0);
  });

  it('un pane avec agent, avec un processus, ou deja en demarrage : 409 PANE_BUSY, aucune touche', async () => {
    const withAgent = harness({ agent: 'claude', agent_session_id: 'sess-1' });
    const a = await startClaudeInPane(withAgent.services, 71, 'dev');
    withAgent.done();
    assert.equal(a.ok, false);
    if (!a.ok) assert.deepEqual([a.status, a.code], [409, 'PANE_BUSY']);
    assert.equal(withAgent.sent.length, 0);

    const withChild = harness({ child_processes: [{ name: 'vim', pid: 12 }] });
    const c = await startClaudeInPane(withChild.services, 71, 'dev');
    withChild.done();
    assert.equal(c.ok, false);
    if (!c.ok) assert.deepEqual([c.status, c.code], [409, 'PANE_BUSY']);
    assert.equal(withChild.sent.length, 0);

    const launching = harness();
    launching.panes.markLaunching(71);
    const l = await startClaudeInPane(launching.services, 71, 'dev');
    launching.done();
    assert.equal(l.ok, false);
    if (!l.ok) assert.deepEqual([l.status, l.code], [409, 'PANE_BUSY']);
    assert.equal(launching.sent.length, 0);
  });

  it('store perime (claude quitte, processus encore liste) : le pane est relu chez Kova, puis lance', async () => {
    const { services, sent, done } = harness({ child_processes: [{ name: 'claude', pid: 9 }] });
    fake.respond = (msg) =>
      msg['cmd'] === 'list-panes'
        ? { ok: true, data: [{ id: 71, window: 0, tab: 2, cwd: '/tmp/projet', title: 'zsh', pid: 1, agent: null, working: false, awaiting: false, child_processes: [] }] }
        : null;
    try {
      const out = await startClaudeInPane(services, 71, 'dev');
      assert.deepEqual(out, { ok: true, response: { launched: true } });
      assert.equal(sent.filter((s) => s.text.includes(LAUNCH_COMMAND)).length, 1);
    } finally {
      fake.respond = null;
      done();
    }
  });

  it('deux start-claude simultanes sur le meme pane : une seule frappe, la meme reponse', async () => {
    const { services, sent, done } = harness();
    const [a, b] = await Promise.all([startClaudeInPane(services, 71, 'dev'), startClaudeInPane(services, 71, 'dev')]);
    done();
    assert.deepEqual(a, b);
    assert.deepEqual(a, { ok: true, response: { launched: true } });
    assert.equal(sent.filter((s) => s.text.includes(LAUNCH_COMMAND)).length, 1);
  });
});

describe('startClaudeInPane apres une coupure IPC (reveil du Mac)', () => {
  /** KeyGate simulee : la premiere frappe tombe sur une coupure, les suivantes passent. */
  function stubbed(opts: { up: boolean; screen: string | null; paneOverrides?: Record<string, unknown> }) {
    const panes = new PaneStore();
    panes.upsertRaw({ id: 72, window: 0, tab: 3, cwd: '/tmp/projet', title: 'zsh', pid: 1, agent: null, working: false, awaiting: false, child_processes: [] });
    const calls: boolean[] = [];
    const keygate = {
      emitLaunch: async (_paneId: number, _dev: string, typeCommand = false) => {
        calls.push(typeCommand);
        if (calls.length === 1) {
          // Pendant la coupure, le pane a pu changer (Kova l'a relu a la reconnexion).
          if (opts.paneOverrides) panes.upsertRaw({ id: 72, window: 0, tab: 3, cwd: '/tmp/projet', title: 'zsh', pid: 1, agent: null, working: false, awaiting: false, child_processes: [], ...opts.paneOverrides });
          throw new IpcError('KOVA_DOWN', 'IPC connection lost (reveil)');
        }
        return { applied: true };
      },
    };
    const fakeIpc = {
      whenUp: async () => opts.up,
      getPaneContent: async () => (opts.screen === null ? [] : [{ id: 72, text: opts.screen, cols: 80, rows: 24, cursor: { row: 0, col: 0 } }]),
    };
    return { services: { ipc: fakeIpc, panes, keygate } as never, calls };
  }

  it('rien n a atteint le shell : une seule nouvelle frappe apres la reconnexion', async () => {
    const { services, calls } = stubbed({ up: true, screen: '~/projet %' });
    const out = await startClaudeInPane(services, 72, 'dev');
    assert.deepEqual(out, { ok: true, response: { launched: true } });
    assert.deepEqual(calls, [true, true]);
  });

  it('Claude Code est deja a l ecran, ou l agent est vu : rien n est retape', async () => {
    const banner = stubbed({ up: true, screen: 'Welcome to Claude Code' });
    assert.deepEqual(await startClaudeInPane(banner.services, 72, 'dev'), { ok: true, response: { launched: true } });
    assert.deepEqual(banner.calls, [true]);
    const agent = stubbed({ up: true, screen: '', paneOverrides: { agent: 'claude', child_processes: [{ name: 'claude', pid: 9 }] } });
    assert.equal((await startClaudeInPane(agent.services, 72, 'dev')).ok, true);
    assert.deepEqual(agent.calls, [true]);
  });

  it('ecran illisible ou Kova toujours absent : aucune nouvelle frappe, une raison lisible', async () => {
    const unreadable = stubbed({ up: true, screen: null });
    const a = await startClaudeInPane(unreadable.services, 72, 'dev');
    assert.equal(a.ok && a.response.launched, false);
    assert.match(a.ok ? a.response.reason ?? '' : '', /unreadable/);
    assert.deepEqual(unreadable.calls, [true]);
    const down = stubbed({ up: false, screen: '~ %' });
    const b = await startClaudeInPane(down.services, 72, 'dev');
    assert.match(b.ok ? b.response.reason ?? '' : '', /Kova is unreachable/);
    assert.deepEqual(down.calls, [true]);
  });
});
