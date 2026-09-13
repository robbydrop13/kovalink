import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  FOREGROUND_TTL_MS,
  MAC_FOCUSED_DEFER_MS,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_ACTIONS,
  type Pane,
  type Prompt,
} from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-policy-'));
process.env['KOVALINK_QUIET'] = '1';

const { DEFAULT_CONFIG } = await import('../src/config.js');
const { deliveryFor, HourlyCap, PUSH_HOURLY_CAP, PushNotifier, inQuietHours } = await import(
  '../src/push/policy.js'
);
const { PushSender, buildPayload } = await import('../src/push/sender.js');
const { saveDevices } = await import('../src/security/token.js');
const { paths } = await import('../src/paths.js');

const pane: Pane = {
  id: 66,
  window: 0,
  tab: 1,
  cwd: '/Users/robin/dev/projet',
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

const validation: Prompt = {
  state: 'unparsable',
  paneId: 66,
  awaitingSince: '2026-09-11T10:00:00.000Z',
  rawScreen: '',
  cols: 80,
  rows: 24,
  promptRef: 'ref-2',
};

const at2am = new Date(2026, 8, 11, 2, 0, 0);
const at3pm = new Date(2026, 8, 11, 15, 0, 0);
const cfg = DEFAULT_CONFIG;

describe('heures calmes (PRD 4.4, CA-130)', () => {
  it('couvrent 23h a 7h, bornes comprises a gauche', () => {
    assert.equal(inQuietHours(new Date(2026, 8, 11, 23, 0)), true);
    assert.equal(inQuietHours(new Date(2026, 8, 11, 6, 59)), true);
    assert.equal(inQuietHours(new Date(2026, 8, 11, 7, 0)), false);
    assert.equal(inQuietHours(new Date(2026, 8, 11, 22, 59)), false);
  });

  it('a 2 h, une fin de tour (N2) est LIVREE en passif, pas supprimee', () => {
    const d = deliveryFor(turnEnd, cfg, { onlyValidations: false, quietHours: true }, at2am);
    assert.deepEqual(d, { kind: 'send', passive: true });
  });

  it('a 2 h, une validation (N1) sonne', () => {
    const d = deliveryFor(validation, cfg, { onlyValidations: false, quietHours: true }, at2am);
    assert.deepEqual(d, { kind: 'send', passive: false });
  });

  it('a 15 h, une fin de tour sonne', () => {
    const d = deliveryFor(turnEnd, cfg, { onlyValidations: false, quietHours: true }, at3pm);
    assert.deepEqual(d, { kind: 'send', passive: false });
  });

  it('heures calmes desactivees sur l appareil : a 2 h la fin de tour sonne', () => {
    const d = deliveryFor(turnEnd, cfg, { onlyValidations: false, quietHours: false }, at2am);
    assert.deepEqual(d, { kind: 'send', passive: false });
  });

  it('le mode passif se traduit dans la charge utile : sans son, interruptionLevel passive', () => {
    const passive = buildPayload(turnEnd, pane, 'ExponentPushToken[x]', 0, true);
    const active = buildPayload(turnEnd, pane, 'ExponentPushToken[x]', 0, false);
    assert.equal(passive?.sound, null);
    assert.equal(passive?.interruptionLevel, 'passive');
    assert.equal(active?.sound, 'default');
    assert.equal(active?.interruptionLevel, 'active');
  });
});

describe('Validations seulement', () => {
  it('supprime une fin de tour et laisse passer une validation', () => {
    const prefs = { onlyValidations: true, quietHours: false };
    assert.deepEqual(deliveryFor(turnEnd, cfg, prefs, at3pm), {
      kind: 'suppress',
      reason: 'only_validations',
    });
    assert.deepEqual(deliveryFor(validation, cfg, prefs, at3pm), { kind: 'send', passive: false });
  });

  it('sans preference d appareil, le fichier de config decide', () => {
    const strict = { ...cfg, push: { ...cfg.push, onlyValidations: true } };
    assert.equal(deliveryFor(turnEnd, strict, undefined, at3pm).kind, 'suppress');
    assert.equal(deliveryFor(turnEnd, cfg, undefined, at3pm).kind, 'send');
  });
});

describe('une banniere vivante par pane (CA-14)', () => {
  it('deux fins de tour du meme pane partagent le collapseId', () => {
    const a = buildPayload(turnEnd, pane, 'tok', 0);
    const b = buildPayload({ ...turnEnd, promptRef: 'ref-9' }, pane, 'tok', 0);
    assert.equal(a?.collapseId, b?.collapseId);
    assert.notEqual(a?.collapseId, buildPayload(turnEnd, { ...pane, id: 67 }, 'tok', 0)?.collapseId);
  });

  it('la charge utile data ne porte ni paneId ni contenu (A14, C24)', () => {
    const p = buildPayload(turnEnd, pane, 'tok', 0);
    assert.equal('paneId' in (p?.data ?? {}), false);
    assert.equal(JSON.stringify(p?.data).includes('Tout passe'), false);
  });
});

describe('plafond horaire (PRD 4.4, CA-32)', () => {
  it('laisse passer 20 envois dans l heure, agrege a partir du 21e', () => {
    const cap = new HourlyCap();
    const t0 = 1_000_000;
    for (let i = 0; i < PUSH_HOURLY_CAP; i++) {
      assert.deepEqual(cap.admit(i, t0 + i * 1000), { aggregated: false });
    }
    assert.deepEqual(cap.admit(100, t0 + 30_000), { aggregated: true, waiting: 1 });
    assert.deepEqual(cap.admit(101, t0 + 31_000), { aggregated: true, waiting: 2 });
    // Le meme pane deux fois ne compte qu un agent.
    assert.deepEqual(cap.admit(101, t0 + 32_000), { aggregated: true, waiting: 2 });
  });

  it('la fenetre glisse : une heure plus tard, on repart', () => {
    const cap = new HourlyCap(2);
    cap.admit(1, 0);
    cap.admit(2, 1000);
    assert.equal(cap.admit(3, 2000).aggregated, true);
    assert.equal(cap.admit(3, 3_600_000).aggregated, false);
  });

  it('la banniere agregee ne porte que Ouvrir et un collapseId fixe', () => {
    const sender = new PushSender(() => cfg, new HourlyCap(0));
    const device = {
      deviceId: 'd1',
      name: 'iPhone',
      pairedAt: '',
      exp: 0,
      revoked: false,
      expoPushToken: 'tok',
      prefs: { onlyValidations: false, quietHours: false },
    };
    const { messages } = sender.compose(turnEnd, pane, { cfg, now: at3pm }, [device], 3);
    assert.equal(messages.length, 1);
    const m = messages[0];
    assert.equal(m?.categoryId, NOTIFICATION_CATEGORY.AGGREGATE);
    assert.equal(m?.collapseId, 'aggregate');
    assert.equal(m?.body, '1 agent is waiting');
    assert.equal(m?.data.kind, 'aggregate');
    assert.deepEqual(
      NOTIFICATION_CATEGORY_ACTIONS[NOTIFICATION_CATEGORY.AGGREGATE].map((a) => a.identifier),
      ['open'],
    );
  });
});

describe('composition par appareil (PushSender.compose)', () => {
  const device = (deviceId: string, prefs: { onlyValidations: boolean; quietHours: boolean }) => ({
    deviceId,
    name: 'iPhone',
    pairedAt: '',
    exp: 0,
    revoked: false,
    expoPushToken: `tok-${deviceId}`,
    prefs,
  });

  it('decide appareil par appareil : l un supprime, l autre passif, le troisieme sonne', () => {
    const sender = new PushSender(() => cfg);
    const { messages, routed } = sender.compose(
      turnEnd,
      pane,
      { cfg, now: at2am },
      [
        device('a', { onlyValidations: true, quietHours: true }),
        device('b', { onlyValidations: false, quietHours: true }),
        device('c', { onlyValidations: false, quietHours: false }),
      ],
      0,
    );
    assert.deepEqual(
      messages.map((m) => [m.to, m.sound]),
      [
        ['tok-b', null],
        ['tok-c', 'default'],
      ],
    );
    assert.equal(routed.get('tok-b'), 'b');
  });

  it('un evenement compte UNE fois dans le plafond, quel que soit le nombre d appareils', () => {
    const cap = new HourlyCap(1);
    const sender = new PushSender(() => cfg, cap);
    const two = [device('a', { onlyValidations: false, quietHours: false }), device('b', { onlyValidations: false, quietHours: false })];
    const first = sender.compose(turnEnd, pane, { cfg, now: at3pm }, two, 0);
    assert.deepEqual(
      first.messages.map((m) => m.categoryId),
      [NOTIFICATION_CATEGORY.AWAITING_BLIND, NOTIFICATION_CATEGORY.AWAITING_BLIND],
    );
    const second = sender.compose(turnEnd, pane, { cfg, now: at3pm }, two, 0);
    assert.ok(second.messages.every((m) => m.categoryId === NOTIFICATION_CATEGORY.AGGREGATE));
  });
});

/**
 * Couche par evenement, avec horloge et minuteries simulees. Le seuil de 60 s de
 * premier plan et la suspension de 60 s sont testes a leur VRAIE valeur.
 */
describe('PushNotifier : session ouverte et Mac focalise (A1, CA-31)', () => {
  function harness() {
    let clock = 10_000_000;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let nextId = 1;
    const sent: Prompt[] = [];
    const state = {
      watched: false,
      macFocused: false,
      pane: { ...pane } as Pane | undefined,
      refValid: true,
    };
    const notifier = new PushNotifier(
      {
        isWatchedLive: () => state.watched,
        isMacFocused: () => state.macFocused,
        pane: () => state.pane,
        isRefValid: () => state.refValid,
        send: async (prompt) => {
          sent.push(prompt);
        },
      },
      {
        now: () => clock,
        setTimeout: (fn, ms) => {
          const id = nextId++;
          timers.set(id, { fn, at: clock + ms });
          return id;
        },
        clearTimeout: (h) => {
          timers.delete(h as number);
        },
      },
    );
    const advance = (ms: number): void => {
      clock += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= clock) {
          timers.delete(id);
          t.fn();
        }
      }
    };
    return { notifier, sent, state, advance, timers };
  }

  it('envoie tout de suite quand personne ne regarde', () => {
    const h = harness();
    assert.deepEqual(h.notifier.notify(turnEnd, pane), { kind: 'sent' });
    assert.equal(h.sent.length, 1);
  });

  it('supprime quand un telephone VIVANT a la session ouverte au premier plan', () => {
    const h = harness();
    h.state.watched = true;
    assert.deepEqual(h.notifier.notify(turnEnd, pane), { kind: 'suppressed', reason: 'session_open' });
    assert.equal(h.sent.length, 0);
  });

  it('Mac focalise : suspend 60 s, puis ENVOIE si l etat n a pas change, meme Mac toujours focalise', () => {
    const h = harness();
    h.state.macFocused = true;
    assert.deepEqual(h.notifier.notify(turnEnd, pane), {
      kind: 'deferred',
      delayMs: MAC_FOCUSED_DEFER_MS,
    });
    assert.equal(MAC_FOCUSED_DEFER_MS, 60_000);
    h.advance(59_999);
    assert.equal(h.sent.length, 0);
    h.advance(1);
    assert.equal(h.sent.length, 1, 'la notification part quand meme apres 60 s');
  });

  it('Mac focalise, puis l agent repart pendant la suspension : abandon', () => {
    const h = harness();
    h.state.macFocused = true;
    h.notifier.notify(turnEnd, pane);
    h.state.pane = { ...pane, working: true, liveState: 'working' };
    h.advance(60_000);
    assert.equal(h.sent.length, 0);
  });

  it('Mac focalise, puis le pane est ferme ou la reference invalidee : abandon', () => {
    const closed = harness();
    closed.state.macFocused = true;
    closed.notifier.notify(turnEnd, pane);
    closed.state.pane = undefined;
    closed.advance(60_000);
    assert.equal(closed.sent.length, 0);

    const invalid = harness();
    invalid.state.macFocused = true;
    invalid.notifier.notify(turnEnd, pane);
    invalid.state.refValid = false;
    invalid.advance(60_000);
    assert.equal(invalid.sent.length, 0);
  });

  it('Mac focalise, puis Robin ouvre la session sur son telephone : supprime a la reprise', () => {
    const h = harness();
    h.state.macFocused = true;
    h.notifier.notify(turnEnd, pane);
    h.state.watched = true;
    h.advance(60_000);
    assert.equal(h.sent.length, 0);
  });

  it('un nouvel evenement sur le meme pane remplace le report en attente', () => {
    const h = harness();
    h.state.macFocused = true;
    h.notifier.notify(turnEnd, pane);
    h.notifier.notify({ ...turnEnd, promptRef: 'ref-2' }, pane);
    assert.equal(h.timers.size, 1);
    h.advance(60_000);
    assert.equal(h.sent.length, 1);
    assert.equal((h.sent[0] as { promptRef: string }).promptRef, 'ref-2');
  });

  it('stop() annule les reports en attente', () => {
    const h = harness();
    h.state.macFocused = true;
    h.notifier.notify(turnEnd, pane);
    h.notifier.stop();
    h.advance(60_000);
    assert.equal(h.sent.length, 0);
  });

  it('la fraicheur du premier plan vaut 60 s dans le protocole', () => {
    assert.equal(FOREGROUND_TTL_MS, 60_000);
  });
});

describe('journal a l emission d un push (CA-12)', () => {
  it('une ligne info « push envoye » avec pane, categorie et identifiant de ticket', async () => {
    saveDevices({
      d1: {
        deviceId: 'd1',
        name: 'iPhone',
        pairedAt: '',
        exp: 0,
        revoked: false,
        expoPushToken: 'ExponentPushToken[xxxx]',
        prefs: { onlyValidations: false, quietHours: false },
      },
    });
    const fakeExpo = {
      chunkPushNotifications: (messages: unknown[]) => [messages],
      sendPushNotificationsAsync: async (chunk: unknown[]) =>
        chunk.map((_, i) => ({ status: 'ok', id: `ticket-${i}` })),
      getPushNotificationReceiptsAsync: async () => ({}),
    };
    const sender = new PushSender(() => cfg, new HourlyCap(), async () => fakeExpo);
    const sent = await sender.send(turnEnd, pane, { cfg, now: at3pm }, 1);
    sender.stop();
    assert.equal(sent, 1);
    const lines = readFileSync(paths.logFile(), 'utf8')
      .split('\n')
      .filter((l) => l.includes('"push envoye"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(lines.length, 1);
    const entry = lines[0];
    assert.equal(entry?.['level'], 'info');
    assert.equal(entry?.['paneId'], 66);
    assert.equal(entry?.['deviceId'], 'd1');
    assert.equal(entry?.['kind'], 'turn_end');
    assert.equal(entry?.['categoryId'], NOTIFICATION_CATEGORY.TURN_END);
    assert.equal(entry?.['ticketId'], 'ticket-0');
    // Le jeton push n apparait jamais dans le journal, meme sur cette ligne.
    assert.equal(JSON.stringify(entry).includes('xxxx'), false);
  });

  it('aucun appareil avec jeton (Expo Go) : une ligne « push sans destinataire », jamais un silence', async () => {
    saveDevices({
      go: { deviceId: 'go', name: 'iPhone Expo Go', pairedAt: '', exp: 0, revoked: false },
      old: { deviceId: 'old', name: 'ancien', pairedAt: '', exp: 0, revoked: true, expoPushToken: 'ExponentPushToken[revoque]' },
    });
    let expoCalls = 0;
    const sender = new PushSender(() => cfg, new HourlyCap(), async () => {
      expoCalls += 1;
      throw new Error('Expo ne doit pas etre sollicite sans destinataire');
    });
    const sent = await sender.send(turnEnd, pane, { cfg, now: at3pm }, 1);
    sender.stop();
    assert.equal(sent, 0);
    assert.equal(expoCalls, 0);
    const lines = readFileSync(paths.logFile(), 'utf8')
      .split('\n')
      .filter((l) => l.includes('"push sans destinataire"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(lines.length, 1);
    const entry = lines[0];
    assert.equal(entry?.['level'], 'info');
    assert.equal(entry?.['paneId'], 66);
    assert.equal(entry?.['kind'], 'turn_end');
    assert.equal(entry?.['categoryId'], NOTIFICATION_CATEGORY.TURN_END);
    assert.equal(entry?.['reason'], 'aucun_jeton_push');
    // L appareil revoque ne compte pas parmi les appaires.
    assert.equal(entry?.['pairedDevices'], 1);
  });
});
