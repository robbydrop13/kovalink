import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  FOREGROUND_TTL_MS,
  PROTOCOL_VERSION,
  WS_CLOSE_CODE,
  WS_DEAD_AFTER_MISSED_PONGS,
  type C2S,
  type S2C,
} from '@kovalink/protocol';

const PROJECTS = mkdtempSync(join(tmpdir(), 'kovalink-hub-projects-'));
process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-hub-'));
process.env['KOVALINK_CLAUDE_PROJECTS'] = PROJECTS;
process.env['KOVALINK_QUIET'] = '1';

const { Hub } = await import('../src/server/hub.js');
const { PaneStore } = await import('../src/kova/panes.js');
const { TranscriptTailer } = await import('../src/transcript/tailer.js');
const { SleepAssertion } = await import('../src/sleep.js');
const { AuthFailures, RateLimiter } = await import('../src/server/rate.js');
const { NonceStore } = await import('../src/server/services.js');
const { PromptRefs } = await import('../src/prompt/refs.js');
const { DEFAULT_CONFIG, loadConfig, saveConfig } = await import('../src/config.js');
const { loadDevices, saveDevices } = await import('../src/security/token.js');
const { projectSlug } = await import('../src/paths.js');
type Services = import('../src/server/services.js').Services;
type Socket = import('../src/server/hub.js').Socket;

const CWD = '/Users/robin/dev/projet';
const SESSION = 'sess-hub';
/** Plafond d'attente d'une reponse du hub. Largement au dessus du pire cas mesure sous charge. */
const SAY_TIMEOUT_MS = 2_000;

/**
 * Harnais vivants du test en cours. Chaque `attach` ouvre un observateur chokidar qui garde
 * la boucle d'evenements vivante : sans ce nettoyage, un test qui echoue avant son
 * `detachAll()` empechait `node --test` de finir le fichier.
 */
const live: { tailer: { detachAll(): void }; hub: { stopHeartbeat(): void } }[] = [];
afterEach(() => {
  for (const h of live.splice(0)) {
    h.tailer.detachAll();
    h.hub.stopHeartbeat();
  }
});

function writeTranscript(): void {
  const dir = join(PROJECTS, projectSlug(CWD));
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-11T10:00:00.000Z', message: { role: 'user', content: 'corrige' } },
    {
      type: 'assistant',
      uuid: 'a1',
      requestId: 'req_A',
      apiBlockIndex: 0,
      timestamp: '2026-09-11T10:04:12.000Z',
      message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tout passe.' }] },
    },
  ];
  writeFileSync(join(dir, `${SESSION}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

/** Faux socket : enregistre ce que le hub envoie et ce qu'il fait du socket. */
class FakeSocket implements Socket {
  sent: S2C[] = [];
  closes: { code?: number; reason?: string }[] = [];
  pings = 0;
  terminated = false;
  private readonly handlers = new Map<string, ((arg?: unknown) => void)[]>();

  send(data: string): void {
    this.sent.push(JSON.parse(data) as S2C);
  }
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
  ping(): void {
    this.pings += 1;
  }
  terminate(): void {
    this.terminated = true;
  }
  on(event: string, cb: (arg?: unknown) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
  }
  emit(event: string, arg?: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) cb(arg);
  }
  /**
   * Envoie un message client et attend LA reponse qui porte son `reqId`, avec un plafond.
   * Une attente fixe de 20 ms ne tenait pas sous charge : `session.attach` fait un
   * `import('chokidar')` puis ouvre un observateur FSEvents, et depassait le delai quand
   * Metro et les tests app tournaient a cote. Ici, le hub repond quand il repond ; le
   * plafond ne sert qu'a rendre un echec lisible au lieu d'un test qui pend.
   */
  async say(msg: C2S, timeoutMs = SAY_TIMEOUT_MS): Promise<S2C[]> {
    const before = this.sent.length;
    this.emit('message', JSON.stringify(msg));
    const reqId = (msg as { id?: string }).id;
    // La reponse porte le `reqId` de la requete, sauf les instantanes pousses sans
    // identifiant (`panes.snapshot`, `prompt`) qui repondent a `panes.subscribe` et
    // `pane.peek` : un message sans `reqId` compte donc aussi.
    await this.waitFor(
      (fresh) => fresh.some((m) => ('reqId' in m && m.reqId !== undefined ? m.reqId === reqId : true)),
      before,
      timeoutMs,
    );
    return this.sent.slice(before);
  }
  /** Trame brute (JSON illisible) : la reponse ne peut pas porter de `reqId`, on attend la premiere. */
  async sayRaw(text: string, timeoutMs = SAY_TIMEOUT_MS): Promise<S2C[]> {
    const before = this.sent.length;
    this.emit('message', text);
    await this.waitFor((fresh) => fresh.length > 0, before, timeoutMs);
    return this.sent.slice(before);
  }
  private async waitFor(done: (fresh: S2C[]) => boolean, from: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!done(this.sent.slice(from))) {
      if (Date.now() >= deadline) return;
      await new Promise((r) => setTimeout(r, 2));
    }
  }
}

function harness() {
  let clock = 5_000_000;
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
  const tailer = new TranscriptTailer();
  const spawned: string[][] = [];
  let killed = 0;
  const sleep = new SleepAssertion(() => loadConfig().preventSleep, {
    spawn: (args) => {
      spawned.push(args);
      return {
        kill: () => {
          killed += 1;
        },
      };
    },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    pid: 1,
  });
  const services: Services = {
    cfg: loadConfig,
    daemonVersion: 'test',
    master: Buffer.alloc(32, 1),
    ipc: { state: 'up', pid: 4242, commands: {} } as never,
    panes,
    keygate: {} as never,
    answer: async () => ({ applied: false, reason: 'not_awaiting' }) as never,
    prompts: {} as never,
    refs: new PromptRefs(),
    tailer,
    sleep,
    rate: new RateLimiter(),
    authFailures: new AuthFailures(),
    nonces: new NonceStore(),
  };
  const hub = new Hub(services, { now: () => clock });
  live.push({ tailer, hub });
  const connect = (deviceId = 'dev-1'): FakeSocket => {
    const sock = new FakeSocket();
    hub.add(sock, deviceId, '100.64.0.2');
    return sock;
  };
  return {
    hub,
    panes,
    tailer,
    sleep,
    spawned,
    killed: () => killed,
    connect,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

const hello = (id = 'h1'): Extract<C2S, { t: 'hello' }> => ({
  t: 'hello',
  id,
  protocol: PROTOCOL_VERSION,
  deviceId: 'dev-1',
  appVersion: '0.1.0',
  platform: 'ios',
});

describe('Hub : poignee de main', () => {
  it('repond hello.ok avec l etat Kova du protocole', async () => {
    const h = harness();
    const s = h.connect();
    const [reply] = await s.say(hello());
    assert.equal(reply?.t, 'hello.ok');
    assert.deepEqual((reply as { kova: unknown }).kova, { status: 'up', pid: 4242, commands: {} });
  });

  it('version de protocole inconnue : erreur PUIS fermeture 4426, reellement emise', async () => {
    const h = harness();
    const s = h.connect();
    const [reply] = await s.say({ ...hello(), protocol: 99 } as unknown as C2S);
    assert.equal(reply?.t, 'error');
    assert.equal((reply as { code: string }).code, 'PROTOCOL_VERSION');
    assert.deepEqual(s.closes, [{ code: WS_CLOSE_CODE.PROTOCOL_VERSION, reason: 'protocol version' }]);
    assert.equal(h.hub.clientCount, 0);
  });

  it('panes.subscribe avec un etag a jour rend ack, sinon la liste', async () => {
    const h = harness();
    const fresh = h.connect();
    await fresh.say({ ...hello(), resume: { panesEtag: h.panes.etag } } as C2S);
    const [ack] = await fresh.say({ t: 'panes.subscribe', id: 'p1' });
    assert.equal(ack?.t, 'ack');

    const stale = h.connect('dev-2');
    await stale.say({ ...hello(), resume: { panesEtag: 'perime' } } as C2S);
    const [snap] = await stale.say({ t: 'panes.subscribe', id: 'p2' });
    assert.equal(snap?.t, 'panes.snapshot');
    assert.equal((snap as { panes: unknown[] }).panes.length, 1);
  });
});

describe('Hub : rejeu des fins de tour apres un instantane (docs/16, 6.5)', () => {
  const turnEnd = (paneId: number, ref: string) =>
    ({
      state: 'turn_end',
      paneId,
      sessionId: SESSION,
      endedAt: '2026-09-12T18:00:00.000Z',
      summary: 'Done.',
      subtitle: '1m 00s, 0 tools',
      toolCount: 0,
      durationMs: 60_000,
      promptRef: ref,
    }) as const;

  it('une app lancee a froid recoit, apres panes.snapshot, le dernier prompt lisible de chaque pane', async () => {
    const h = harness();
    // Une fin de tour survenue AVANT que le telephone se connecte.
    h.hub.pushPrompt(turnEnd(66, 'ref-a'));
    h.hub.pushPrompt(turnEnd(66, 'ref-b'));
    const client = h.connect();
    await client.say(hello());
    const msgs = await client.say({ t: 'panes.subscribe', id: 'p1' });
    await new Promise((r) => setTimeout(r, 10));
    const all = client.sent.slice(client.sent.length - 3);
    const snapAt = all.findIndex((m) => m.t === 'panes.snapshot');
    const promptAt = all.findIndex((m) => m.t === 'prompt');
    assert.ok(msgs[0]?.t === 'panes.snapshot');
    assert.ok(promptAt > snapAt, 'le snapshot d abord, pour que l app connaisse le pane');
    const prompt = all[promptAt] as { prompt: { promptRef?: string } };
    assert.equal(prompt.prompt.promptRef, 'ref-b', 'seule la derniere reference compte');
  });

  it('un pane repasse en travail, ferme, ou rend none : plus rien a rejouer', async () => {
    const h = harness();
    h.hub.pushPrompt(turnEnd(66, 'ref-a'));
    assert.equal(h.hub.replayablePrompts().length, 1);
    h.hub.forgetPrompt(66);
    assert.equal(h.hub.replayablePrompts().length, 0);
    h.hub.pushPrompt(turnEnd(66, 'ref-b'));
    h.hub.pushPrompt({ state: 'none', paneId: 66 });
    assert.equal(h.hub.replayablePrompts().length, 0);
    // Un pane qui n'existe plus dans le store n'est pas rejoue, meme si son prompt traine.
    h.hub.pushPrompt(turnEnd(99, 'ref-x'));
    const client = h.connect();
    await client.say(hello());
    await client.say({ t: 'panes.subscribe', id: 'p1' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(client.sent.filter((m) => m.t === 'prompt').length, 0);
  });

  it('une reprise avec etag a jour rejoue aussi les prompts : les fins de tour hors ligne ne se perdent pas', async () => {
    const h = harness();
    h.hub.pushPrompt(turnEnd(66, 'ref-off'));
    const client = h.connect();
    await client.say({ ...hello(), resume: { panesEtag: h.panes.etag } } as C2S);
    await client.say({ t: 'panes.subscribe', id: 'p1' });
    await new Promise((r) => setTimeout(r, 10));
    const prompts = client.sent.filter((m) => m.t === 'prompt') as { prompt: { promptRef?: string } }[];
    assert.deepEqual(prompts.map((p) => p.prompt.promptRef), ['ref-off']);
  });
});

describe('Hub : attache de session et instantane (H2)', () => {
  it('le premier attach rend les turns, et le SECOND aussi, jamais une liste vide', async () => {
    writeTranscript();
    const h = harness();
    const a = h.connect('dev-a');
    const [snapA] = await a.say({ t: 'session.attach', id: 's1', sessionId: SESSION });
    assert.equal(snapA?.t, 'session.snapshot');
    assert.equal((snapA as { turns: unknown[] }).turns.length, 2);
    assert.equal(h.tailer.isAttached(SESSION), true);

    // Reconnexion du meme appareil, ou second appareil : le tail est deja abonne.
    const b = h.connect('dev-b');
    const [snapB] = await b.say({ t: 'session.attach', id: 's2', sessionId: SESSION });
    assert.equal(snapB?.t, 'session.snapshot');
    assert.equal((snapB as { turns: unknown[] }).turns.length, 2, 'instantane vide a la reconnexion');
  });

  it('session inconnue : SESSION_NOT_FOUND, jamais un silence', async () => {
    const h = harness();
    const s = h.connect();
    const [err] = await s.say({ t: 'session.attach', id: 's1', sessionId: 'nope' });
    assert.equal(err?.t, 'error');
    assert.equal((err as { code: string }).code, 'SESSION_NOT_FOUND');
  });

  it('le tail est detache quand le dernier client se detache ou disparait', async () => {
    writeTranscript();
    const h = harness();
    const a = h.connect('dev-a');
    const b = h.connect('dev-b');
    await a.say({ t: 'session.attach', id: 's1', sessionId: SESSION });
    await b.say({ t: 'session.attach', id: 's2', sessionId: SESSION });
    await a.say({ t: 'session.detach', id: 'd1', sessionId: SESSION });
    assert.equal(h.tailer.isAttached(SESSION), true, 'b regarde encore');
    b.emit('close');
    assert.equal(h.tailer.isAttached(SESSION), false);
  });
});

describe('Hub : premier plan et suppression de push (A1, CA-31)', () => {
  it('attacher la session pose le premier plan ; il perime apres 60 s sans ping', async () => {
    writeTranscript();
    const h = harness();
    const s = h.connect();
    await s.say({ t: 'session.attach', id: 's1', sessionId: SESSION });
    assert.equal(h.hub.isWatching(SESSION, 66), true);
    h.advance(FOREGROUND_TTL_MS - 1);
    assert.equal(h.hub.isWatching(SESSION, 66), true);
    h.advance(1);
    assert.equal(h.hub.isWatching(SESSION, 66), false, 'sans signal frais, on ne supprime rien');
  });

  it('le ping rafraichit le premier plan avec le pane annonce, null l efface', async () => {
    writeTranscript();
    const h = harness();
    const s = h.connect();
    await s.say({ t: 'session.attach', id: 's1', sessionId: SESSION });
    h.advance(FOREGROUND_TTL_MS + 1);
    assert.equal(h.hub.isWatching(SESSION, 66), false);
    await s.say({ t: 'ping', id: 'p1', foregroundPaneId: 66 });
    assert.equal(h.hub.isWatching(SESSION, 66), true);
    await s.say({ t: 'ping', id: 'p2', foregroundPaneId: null });
    assert.equal(h.hub.isWatching(SESSION, 66), false);
    // Un autre pane au premier plan ne compte pas pour celui ci.
    await s.say({ t: 'ping', id: 'p3', foregroundPaneId: 67 });
    assert.equal(h.hub.isWatching(SESSION, 66), false);
  });

  it('un ping d un client ancien, sans le champ, vaut « pas au premier plan »', async () => {
    writeTranscript();
    const h = harness();
    const s = h.connect();
    await s.say({ t: 'session.attach', id: 's1', sessionId: SESSION });
    await s.say({ t: 'ping', id: 'p1' } as C2S);
    assert.equal(h.hub.isWatching(SESSION, 66), false);
  });

  it('le premier plan seul ne suffit pas : la session doit etre attachee', async () => {
    const h = harness();
    const s = h.connect();
    await s.say({ t: 'ping', id: 'p1', foregroundPaneId: 66 });
    assert.equal(h.hub.isWatching(SESSION, 66), false);
  });

  it('se detacher efface le premier plan de ce pane', async () => {
    writeTranscript();
    const h = harness();
    const s = h.connect();
    await s.say({ t: 'session.attach', id: 's1', sessionId: SESSION });
    await s.say({ t: 'session.detach', id: 'd1', sessionId: SESSION });
    assert.equal(h.hub.isWatching(SESSION, 66), false);
  });
});

describe('Hub : detection des clients morts (H1)', () => {
  it('pinge a chaque battement et declare mort apres 2 pings sans pong : 4408, terminate, nettoyage', async () => {
    writeTranscript();
    const h = harness();
    const s = h.connect();
    await s.say({ t: 'session.attach', id: 's1', sessionId: SESSION });
    assert.equal(h.hub.isWatching(SESSION, 66), true);

    h.hub.heartbeat();
    assert.equal(s.pings, 1);
    h.hub.heartbeat();
    assert.equal(s.pings, 2);
    assert.equal(h.hub.clientCount, 1, 'pas encore mort : deux pings sans pong, on attend le troisieme tour');

    h.hub.heartbeat();
    assert.equal(WS_DEAD_AFTER_MISSED_PONGS, 2);
    assert.equal(h.hub.clientCount, 0, 'declare mort');
    assert.deepEqual(s.closes, [{ code: WS_CLOSE_CODE.DEAD_CLIENT, reason: 'ping timeout' }]);
    assert.equal(s.terminated, true);
    assert.equal(h.hub.isWatching(SESSION, 66), false, 'plus de premier plan');
    assert.equal(h.tailer.isAttached(SESSION), false, 'tail detache');
  });

  it('un pong remet le compteur a zero', () => {
    const h = harness();
    const s = h.connect();
    h.hub.heartbeat();
    h.hub.heartbeat();
    s.emit('pong');
    h.hub.heartbeat();
    h.hub.heartbeat();
    assert.equal(h.hub.clientCount, 1);
    assert.equal(s.pings, 4);
  });

  it('un message applicatif compte aussi comme signe de vie', async () => {
    const h = harness();
    const s = h.connect();
    h.hub.heartbeat();
    h.hub.heartbeat();
    await s.say({ t: 'ping', id: 'p1', foregroundPaneId: null });
    h.hub.heartbeat();
    h.hub.heartbeat();
    assert.equal(h.hub.clientCount, 1);
  });

  it('une fermeture du socket retire le client immediatement', async () => {
    writeTranscript();
    const h = harness();
    const s = h.connect();
    await s.say({ t: 'session.attach', id: 's1', sessionId: SESSION });
    s.emit('close');
    assert.equal(h.hub.clientCount, 0);
    assert.equal(h.tailer.isAttached(SESSION), false);
  });
});

describe('Hub : revocation et reglage anti-veille', () => {
  it('dropDevice ferme avec 4401 et retire le client', () => {
    const h = harness();
    const s = h.connect('dev-x');
    const other = h.connect('dev-y');
    h.hub.dropDevice('dev-x');
    assert.deepEqual(s.closes, [{ code: WS_CLOSE_CODE.UNAUTHORIZED, reason: 'revoked' }]);
    assert.equal(other.closes.length, 0);
    assert.equal(h.hub.clientCount, 1);
  });

  it('push.register avec keepMacAwake:false ecrit preventSleep et relache l assertion (CA-126)', async () => {
    saveConfig({ ...DEFAULT_CONFIG, preventSleep: true });
    const h = harness();
    h.panes.setWorking(66, true);
    h.sleep.reconcile(true);
    assert.equal(h.sleep.active, true);

    const s = h.connect();
    await s.say({
      t: 'push.register',
      id: 'r1',
      expoPushToken: 'ExponentPushToken[x]',
      prefs: { onlyValidations: false, quietHours: true, keepMacAwake: false },
    });
    assert.equal(loadConfig().preventSleep, false);
    assert.equal(h.sleep.active, false, 'assertion relachee sur le champ');
    assert.equal(h.killed(), 1);

    await s.say({
      t: 'push.register',
      id: 'r2',
      expoPushToken: 'ExponentPushToken[x]',
      prefs: { onlyValidations: false, quietHours: true, keepMacAwake: true },
    });
    assert.equal(loadConfig().preventSleep, true);
    assert.equal(h.sleep.active, true, 'reposee, un agent travaille toujours');
  });

  it('un push.register avec un jeton vide garde le jeton range : seuls les reglages changent', async () => {
    saveDevices({
      'dev-1': { deviceId: 'dev-1', name: 'iPhone', pairedAt: '', exp: 0, revoked: false, expoPushToken: 'ExponentPushToken[garde]' },
    });
    const h = harness();
    const s = h.connect();
    await s.say({
      t: 'push.register',
      id: 'r1',
      expoPushToken: '',
      prefs: { onlyValidations: true, quietHours: false, keepMacAwake: true },
    });
    const device = loadDevices()['dev-1'];
    assert.equal(device?.expoPushToken, 'ExponentPushToken[garde]');
    assert.deepEqual(device?.prefs, { onlyValidations: true, quietHours: false });
  });

  it('un push.register d un client ancien, sans keepMacAwake, ne touche pas au reglage', async () => {
    saveConfig({ ...DEFAULT_CONFIG, preventSleep: true });
    const h = harness();
    const s = h.connect();
    await s.say({
      t: 'push.register',
      id: 'r1',
      expoPushToken: 'ExponentPushToken[x]',
      prefs: { onlyValidations: false, quietHours: true } as never,
    });
    assert.equal(loadConfig().preventSleep, true);
  });
});

describe('Hub : refus explicites', () => {
  it('aucune ecriture par WS : pane.answer, pane.interrupt et pane.sendText sont des types inconnus', async () => {
    // Retires du protocole : la seule surface d'ecriture est HTTPS. Un client qui les
    // emettrait encore recoit BAD_REQUEST, jamais un send-keys.
    const h = harness();
    const s = h.connect();
    for (const t of ['pane.answer', 'pane.interrupt', 'pane.sendText']) {
      const [r] = await s.say({ t, id: `w-${t}`, paneId: 66, nonce: 'n', text: 'x', optionIndex: 1 } as never);
      assert.equal(r?.t, 'error', t);
      assert.equal((r as { code: string }).code, 'BAD_REQUEST', t);
      assert.equal((r as { reqId: string }).reqId, `w-${t}`);
    }
  });

  it('pane.sendKeys et term.input rendent FORBIDDEN_ACTION, jamais un silence', async () => {
    const h = harness();
    const s = h.connect();
    const [b] = await s.say({ t: 'pane.sendKeys', id: 'x2', paneId: 66, keys: ['enter'] as never });
    assert.equal((b as { code: string }).code, 'FORBIDDEN_ACTION');
    const [c] = await s.say({ t: 'term.input', id: 'x3', paneId: 66, keys: ['enter'] as never });
    assert.equal((c as { code: string }).code, 'FORBIDDEN_ACTION');
  });

  it('JSON illisible et type inconnu rendent BAD_REQUEST', async () => {
    const h = harness();
    const s = h.connect();
    const [bad] = await s.sayRaw('{pas du json');
    assert.equal((bad as { code: string }).code, 'BAD_REQUEST');
    const [u] = await s.say({ t: 'inconnu', id: 'z' } as never);
    assert.equal((u as { code: string }).code, 'BAD_REQUEST');
  });
});

describe('fenetre de demarrage apres un lancement de claude', () => {
  it('launching tant que l agent manque, retombe quand il apparait ou a l echeance', async () => {
    const { LAUNCH_GRACE_MS } = await import('../src/kova/panes.js');
    let clock = 1_000_000;
    const panes = new PaneStore(() => clock);
    const raw = { id: 90, window: 0, tab: 2, cwd: CWD, title: 'claude', agent: null, child_processes: [] };
    panes.upsertRaw(raw);
    assert.equal(panes.get(90)?.launching, false);
    const events: Array<[number, boolean]> = [];
    panes.on('launching', (id: number, on: boolean) => events.push([id, on]));
    panes.markLaunching(90);
    assert.equal(panes.get(90)?.launching, true);
    // Un instantane de Kova sans agent ne l'efface pas.
    panes.upsertRaw(raw);
    assert.equal(panes.get(90)?.launching, true);
    // L'agent apparait : fini, et un nouvel instantane ne le remet pas.
    panes.upsertRaw({ ...raw, agent: 'claude', agent_session_id: 'abc' });
    assert.equal(panes.get(90)?.launching, false);
    panes.upsertRaw(raw);
    assert.equal(panes.get(90)?.launching, false);
    // Echeance sans agent.
    panes.markLaunching(90);
    clock += LAUNCH_GRACE_MS;
    panes.upsertRaw(raw);
    assert.equal(panes.get(90)?.launching, false);
    assert.deepEqual(events, [[90, true], [90, true]]);
    panes.remove(90, null, null);
  });
});

describe('changement de liaison Tailscale', () => {
  it('daemon.status n est pousse que quand le relais du client change', async () => {
    const { setKnownPeers } = await import('../src/net/tailscale.js');
    const h = harness();
    setKnownPeers([{ addresses: ['100.64.0.2'], curAddr: '', relay: 'par' }]);
    const sock = h.connect();
    h.hub.pushDaemonStatus('up', 1);
    const links = () => sock.sent.filter((m) => m.t === 'daemon.status').map((m) => (m as { link: { relay: string | null } }).link.relay);
    assert.deepEqual(links(), ['par']);
    h.hub.pushLinkChanges({ status: 'up', pid: 1 });
    assert.deepEqual(links(), ['par'], 'rien a annoncer, meme relais');
    // Tailscale trouve un chemin direct : un seul message, relais null.
    setKnownPeers([{ addresses: ['100.64.0.2'], curAddr: '[2a01::1]:41641', relay: 'par' }]);
    h.hub.pushLinkChanges({ status: 'up', pid: 1 });
    h.hub.pushLinkChanges({ status: 'up', pid: 1 });
    assert.deepEqual(links(), ['par', null]);
    setKnownPeers([]);
  });
});
