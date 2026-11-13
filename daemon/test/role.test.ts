// Role du Mac (`config.role`). Un Mac secondaire est un secours en lecture : ses
// bannieres disent d'ou elles viennent, et la file d'attention, les routines et les
// agents lui sont fermes. Le Mac principal, lui, ne doit rien voir changer.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { ROUTE_PATTERNS, ROUTES, type AskItem, type Pane, type Prompt } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-role-'));
process.env['KOVALINK_QUIET'] = '1';

const { DEFAULT_CONFIG, hostName, loadConfig } = await import('../src/config.js');
const { PushSender, buildPayload, withHost } = await import('../src/push/sender.js');
const { HourlyCap } = await import('../src/push/policy.js');
const { registerRoleGuard } = await import('../src/server/roleGuard.js');
const { saveDevices } = await import('../src/security/token.js');
const { paths } = await import('../src/paths.js');
type KovalinkConfig = import('../src/config.js').KovalinkConfig;

const TS_DNS = 'm1.tail1234.ts.net';
const primary: KovalinkConfig = { ...DEFAULT_CONFIG, tsDns: 'mac.tail1234.ts.net' };
const secondary: KovalinkConfig = { ...DEFAULT_CONFIG, tsDns: TS_DNS, role: 'secondary' };

const pane: Pane = {
  id: 66,
  window: 0,
  tab: 1,
  cwd: '/Users/alice/dev/projet',
  title: 'cc',
  focused: false,
  pid: 1,
  child_processes: [],
  is_idle: true,
  working: false,
  awaiting: false,
  awaiting_since: null,
  awaiting_seen: false,
  minimized: false,
  agent: 'claude',
  agent_session_id: 'sess-42',
  agent_session_name: null,
  claude_session_id: null,
  claude_session_name: null,
  resume_agent: null,
  resume_session_id: null,
  resume_command: null,
  projectName: 'projet',
  hasTranscript: true,
  chatCapable: true,
  permissionMode: null,
  color: null,
  liveState: 'idle',
  tabId: null,
  launching: false,
};

const turnEnd: Prompt = {
  state: 'turn_end',
  paneId: 66,
  sessionId: 'sess-42',
  endedAt: '2026-09-11T10:00:00.000Z',
  summary: 'Tout passe.',
  subtitle: '4m 12s, 11 tools',
  toolCount: 11,
  durationMs: 252_000,
  promptRef: 'ref-1',
};

const device = {
  deviceId: 'd1',
  name: 'iPhone',
  pairedAt: '',
  exp: 0,
  revoked: false,
  expoPushToken: 'tok-d1',
  prefs: { onlyValidations: false, quietHours: false },
};

describe('role : lecture de config.json', () => {
  it('fichier sans champ role : primary, comme avant', () => {
    writeFileSync(paths.config(), JSON.stringify({ port: 8765, tsDns: 'mac.ts.net' }));
    assert.equal(loadConfig().role, 'primary');
  });

  it('role secondary lu tel quel', () => {
    writeFileSync(paths.config(), JSON.stringify({ role: 'secondary' }));
    assert.equal(loadConfig().role, 'secondary');
  });

  it('valeur inconnue (satellite, faute) : secondary, on ferme plutot qu ouvrir', () => {
    writeFileSync(paths.config(), JSON.stringify({ role: 'satellite' }));
    assert.equal(loadConfig().role, 'secondary');
  });

  it('name absent ou vide : le nom d hote de macOS, comme avant', () => {
    const fromOs = hostname().replace(/\.local$/, '');
    assert.equal(hostName(DEFAULT_CONFIG), fromOs);
    assert.equal(hostName({ name: '  ' }), fromOs);
  });

  it('name renseigne : remplace le nom d hote (QR, hello.ok, bannieres)', () => {
    writeFileSync(paths.config(), JSON.stringify({ role: 'secondary', name: ' M1 ' }));
    assert.equal(hostName(loadConfig()), 'M1');
  });
});

describe('role : champ host des notifications', () => {
  it('Mac principal : titre inchange, data.host porte le tsDns', () => {
    const base = buildPayload(turnEnd, pane, 'tok', 0);
    assert.ok(base);
    const m = withHost(base, primary);
    assert.equal(m.title, base.title);
    assert.equal(m.title, 'cc . projet');
    assert.equal(m.data.host, 'mac.tail1234.ts.net');
    // Seul `host` s'ajoute : le reste de la charge est celui d'avant.
    assert.deepEqual(m.data, { ...base.data, host: 'mac.tail1234.ts.net' });
  });

  it('Mac secondaire : titre prefixe par le nom du Mac', () => {
    const base = buildPayload(turnEnd, pane, 'tok', 0);
    assert.ok(base);
    const m = withHost(base, secondary);
    assert.equal(m.title, `${hostName(secondary)} . cc . projet`);
    assert.equal(m.data.host, TS_DNS);
  });

  it('name de config.json : c est lui qui prefixe le titre', () => {
    const base = buildPayload(turnEnd, pane, 'tok', 0);
    assert.ok(base);
    assert.equal(withHost(base, { ...secondary, name: 'M1' }).title, 'M1 . cc . projet');
  });

  it('sans tsDns : aucun champ host', () => {
    const base = buildPayload(turnEnd, pane, 'tok', 0);
    assert.ok(base);
    assert.equal('host' in withHost(base, DEFAULT_CONFIG).data, false);
  });

  it('compose marque chaque banniere, agregee comprise', () => {
    const sender = new PushSender(() => secondary, new HourlyCap(0));
    const { messages } = sender.compose(turnEnd, pane, { cfg: secondary }, [device], 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.data.kind, 'aggregate');
    assert.equal(messages[0]?.data.host, TS_DNS);
    assert.equal(messages[0]?.title, `${hostName(secondary)} . KovaLink`);
  });

  it('question d agent (sendAsk) : data.host et titre prefixe', async () => {
    saveDevices({ d1: device });
    const sent: { title: string; data: { host?: string } }[] = [];
    const fakeExpo = {
      chunkPushNotifications: (messages: unknown[]) => [messages],
      sendPushNotificationsAsync: async (chunk: unknown[]) => {
        sent.push(...(chunk as typeof sent));
        return chunk.map((_, i) => ({ status: 'ok', id: `t-${i}` }));
      },
      getPushNotificationReceiptsAsync: async () => ({}),
    };
    const sender = new PushSender(() => secondary, new HourlyCap(), async () => fakeExpo);
    const ask = {
      id: 'ask-1',
      from: 'claap-agent',
      message: 'ok ?',
      buttons: ['Oui'],
      input: false,
      askedAtMs: 0,
      snoozedUntilMs: 0,
      due: true,
      waiting: true,
      sessionId: null,
      cwd: null,
    } as AskItem;
    assert.equal(await sender.sendAsk(ask, 1), 1);
    sender.stop();
    assert.equal(sent[0]?.title, `${hostName(secondary)} . claap-agent`);
    assert.equal(sent[0]?.data.host, TS_DNS);
  });
});

/**
 * Le garde est monte sur un Fastify nu, devant des routes factices aux vrais chemins :
 * c'est lui qu'on teste, pas `attn`, `routinectl` ou `team`.
 */
async function guarded(cfg: KovalinkConfig) {
  const app = Fastify();
  registerRoleGuard(app, () => cfg);
  const ok = async () => ({ ok: true });
  app.get(ROUTE_PATTERNS.attention, ok);
  app.post(ROUTE_PATTERNS.attentionAct, ok);
  app.get(ROUTE_PATTERNS.routines, ok);
  app.post(ROUTE_PATTERNS.routineRun, ok);
  app.get(ROUTE_PATTERNS.routineLog, ok);
  app.get(ROUTE_PATTERNS.agentsRoster, ok);
  app.post(ROUTE_PATTERNS.agentReopen, ok);
  app.get(ROUTE_PATTERNS.panes, ok);
  await app.ready();
  return app;
}

const CLOSED: { family: string; method: 'GET' | 'POST'; url: string }[] = [
  { family: 'attention', method: 'GET', url: ROUTES.attention },
  { family: 'attention', method: 'POST', url: ROUTES.attentionAct('OL-1') },
  { family: 'routines', method: 'GET', url: ROUTES.routines },
  { family: 'routines', method: 'POST', url: ROUTES.routineRun('tri-inbox') },
  { family: 'routines', method: 'GET', url: ROUTES.routineLog('tri-inbox') },
  { family: 'agents', method: 'GET', url: ROUTES.agentsRoster },
  { family: 'agents', method: 'POST', url: ROUTES.agentReopen('claap-agent') },
];

describe('role : routes fermees sur un Mac secondaire', () => {
  for (const r of CLOSED) {
    it(`${r.family} : ${r.method} ${r.url} rend 403 FORBIDDEN_ACTION`, async () => {
      const app = await guarded(secondary);
      const res = await app.inject({ method: r.method, url: r.url });
      assert.equal(res.statusCode, 403);
      const body = res.json() as { code: string; message: string; retryable: boolean };
      assert.equal(body.code, 'FORBIDDEN_ACTION');
      assert.equal(body.message, 'available on the primary Mac only');
      assert.equal(body.retryable, false);
      await app.close();
    });
  }

  it('les autres routes restent ouvertes (panes)', async () => {
    const app = await guarded(secondary);
    const res = await app.inject({ method: 'GET', url: ROUTES.panes });
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  it('Mac principal : toutes les familles repondent comme avant', async () => {
    const app = await guarded(primary);
    for (const r of CLOSED) {
      const res = await app.inject({ method: r.method, url: r.url });
      assert.equal(res.statusCode, 200, `${r.method} ${r.url}`);
    }
    await app.close();
  });
});
