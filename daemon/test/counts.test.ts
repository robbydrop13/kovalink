import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { AskItem, CountsPush, Pane } from '@kovalink/protocol';
import type { SilentCountsMessage } from '../src/push/sender.js';
import type { DeviceRecord } from '../src/security/token.js';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-counts-'));
process.env['KOVALINK_QUIET'] = '1';
// Import dynamique assume : `paths` lit `KOVALINK_HOME` a la construction du module, il
// doit donc etre pose avant tout import du daemon. Meme motif que `policy.test.ts`.

const { COUNTS_PUSH_MIN_INTERVAL_MS, CountsPusher, countsOf } = await import(
  '../src/push/counts.js'
);
const { buildCountsMessage, PushSender, pushTargets } = await import('../src/push/sender.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');
const { saveDevices } = await import('../src/security/token.js');

function paneOf(id: number, patch: Partial<Pane> = {}): Pane {
  return {
    id,
    window: 0,
    tab: 1,
    cwd: '/tmp/projet',
    title: 'cc',
    focused: false,
    pid: id,
    child_processes: [],
    is_idle: true,
    working: false,
    awaiting: false,
    awaiting_since: null,
    awaiting_seen: false,
    minimized: false,
    agent: 'claude',
    agent_session_id: `sess-${id}`,
    agent_session_name: null,
    claude_session_id: null,
    claude_session_name: null,
    resume_agent: null,
    resume_session_id: null,
    resume_command: null,
    projectName: 'projet',
    hasTranscript: false,
    chatCapable: true,
    permissionMode: null,
    color: null,
    liveState: 'idle',
    tabId: null,
    launching: false,
    ...patch,
  };
}

function askOf(id: string, patch: Partial<AskItem> = {}): AskItem {
  return {
    id,
    from: 'agent',
    message: 'Question ?',
    buttons: ['Yes'],
    input: true,
    askedAtMs: Date.parse('2025-12-31T23:00:00.000Z'),
    snoozedUntilMs: 0,
    due: true,
    waiting: true,
    sessionId: null,
    cwd: null,
    ...patch,
  };
}

function target(deviceId: string) {
  return {
    deviceId,
    name: deviceId,
    pairedAt: '',
    exp: 0,
    revoked: false,
    expoPushToken: `tok-${deviceId}`,
  } satisfies DeviceRecord & { expoPushToken: string };
}

/** Les chaines portees par une valeur, pour prouver qu'aucun texte ne fuit. */
function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) stringsOf(v, out);
  }
  return out;
}

/** Horloge et minuteurs factices : la minute se teste sans l'attendre. */
class FakeClock {
  nowMs = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  now = (): number => this.nowMs;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.nowMs + ms, fn });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  advance(ms: number): void {
    const target = this.nowMs + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.nowMs = due[1].at;
      due[1].fn();
    }
    this.nowMs = target;
  }
}

const counts = (asks: number, patch: Partial<CountsPush> = {}): CountsPush => ({
  t: 'counts',
  asks,
  errors: 0,
  ended: 0,
  oldestAt: 1_700_000_000,
  at: 1_700_000_060,
  ...patch,
});

describe('charge utile silencieuse', () => {
  it('ne porte que des nombres, et `counts` comme seule chaine', () => {
    const payload = counts(3, { errors: 1, ended: 2 });
    const message = buildCountsMessage('ExponentPushToken[x]', payload);

    assert.deepEqual(Object.keys(message).sort(), ['_contentAvailable', 'data', 'priority', 'to']);
    assert.equal(message._contentAvailable, true);
    assert.equal(message.priority, 'normal');
    assert.deepEqual(message.data, { kl: payload });
    assert.deepEqual(stringsOf(message.data), ['counts']);
  });

  it('n a ni alerte, ni son, ni badge : rien ne s affiche et le badge ne bouge pas', () => {
    const message = buildCountsMessage('tok', counts(1));
    const json = JSON.stringify(message);
    const forbidden = [
      'title',
      'body',
      'subtitle',
      'sound',
      'badge',
      'categoryId',
      'mutableContent',
      'interruptionLevel',
      'collapseId',
      'ttl',
    ];
    for (const key of forbidden) {
      assert.equal(key in message, false, `${key} ne doit pas exister`);
      assert.equal(json.includes(`"${key}"`), false, `${key} ne doit pas exister`);
    }
  });

  it('Expo recoit le message tel quel : content-available, priorite 5, type background', async () => {
    const chunks: unknown[][] = [];
    const fake = {
      chunkPushNotifications: (messages: unknown[]): unknown[][] => [messages],
      sendPushNotificationsAsync: async (chunk: unknown[]): Promise<unknown[]> => {
        chunks.push(chunk);
        return chunk.map((_, i) => ({ status: 'ok', id: `ticket-${i}` }));
      },
      getPushNotificationReceiptsAsync: async (): Promise<Record<string, { status: string }>> => ({}),
    };
    const sender = new PushSender(
      () => DEFAULT_CONFIG,
      undefined,
      async () => fake as never,
    );
    const sent = await sender.sendCounts(counts(2), [target('a')]);

    assert.equal(sent, 1);
    assert.equal(chunks.length, 1);
    const message = chunks[0]?.[0] as SilentCountsMessage;
    // `_contentAvailable` est ce qu'Expo traduit en `aps: { "content-available": 1 }` et
    // en `apns-push-type: background` ; `normal` vaut `apns-priority: 5`.
    assert.equal(message._contentAvailable, true);
    assert.equal(message.priority, 'normal');
    assert.equal('title' in message, false);
    assert.equal('body' in message, false);
    assert.equal('sound' in message, false);
    assert.equal('badge' in message, false);
    assert.equal(message.data.kl.asks, 2);
  });

  it('un appareil sans jeton, revoque, ne recoit rien ; les reglages d alerte ne filtrent pas', () => {
    const device = (deviceId: string, patch: Partial<DeviceRecord>): DeviceRecord => ({
      ...target(deviceId),
      ...patch,
    });
    saveDevices({
      ok: device('ok', { prefs: { onlyValidations: true, quietHours: true } }),
      revoked: device('revoked', { revoked: true }),
      noToken: device('noToken', { expoPushToken: undefined }),
    });

    assert.deepEqual(
      pushTargets().map((d) => d.deviceId),
      ['ok'],
    );
  });
});

describe('countsOf', () => {
  it('compte permissions, erreurs et questions orphelines, et date la plus ancienne', () => {
    const panes = [
      paneOf(1, { awaiting: true, awaiting_since: '2026-01-01T00:00:00.000Z', error: { kind: 'API error', text: 'boom' } }),
      paneOf(2),
    ];
    const asks = [
      askOf('gone', { sessionId: 'sess-disparue' }),
      askOf('snoozed', {
        sessionId: 'sess-disparue',
        due: false,
        snoozedUntilMs: Date.parse('2026-01-01T02:00:00.000Z'),
      }),
      askOf('unknown-session'),
    ];

    const snapshot = countsOf(panes, asks, Date.parse('2026-01-01T01:00:00.000Z'));

    assert.equal(snapshot.errors, 1);
    // Une permission et deux questions ouvertes, la question reportee ne compte pas.
    assert.equal(snapshot.asks, 3);
    // Seule la question dont la session est connue et disparue est « finie ».
    assert.equal(snapshot.ended, 1);
    // La question de 23 h est plus ancienne que la permission de minuit.
    assert.equal(snapshot.oldestAt, Math.floor(Date.parse('2025-12-31T23:00:00.000Z') / 1000));
  });

  it('sans aucun pane lu, ne devine aucune question orpheline', () => {
    const snapshot = countsOf([], [askOf('a', { sessionId: 'sess-1' })], 0);
    assert.equal(snapshot.ended, 0);
  });
});

describe('anti-rebond par appareil', () => {
  it('envoie tout de suite, puis au plus une fois par minute avec la derniere valeur', () => {
    const clock = new FakeClock();
    const sent: CountsPush[] = [];
    const pusher = new CountsPusher({
      send: async (payload) => {
        sent.push(payload);
        return 1;
      },
      targets: () => [target('a')],
      clock,
    });

    pusher.update({ asks: 1, errors: 0, ended: 0, oldestAt: 10 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.at, 0);

    clock.advance(10_000);
    pusher.update({ asks: 2, errors: 0, ended: 0, oldestAt: 20 });
    assert.equal(sent.length, 1);

    clock.advance(10_000);
    pusher.update({ asks: 3, errors: 1, ended: 0, oldestAt: 30 });
    assert.equal(sent.length, 1);

    clock.advance(COUNTS_PUSH_MIN_INTERVAL_MS - 20_000);
    assert.equal(sent.length, 2);
    // Le rattrapage porte la DERNIERE valeur, pas celle du premier changement.
    assert.equal(sent[1]?.asks, 3);
    assert.equal(sent[1]?.errors, 1);
    assert.equal(sent[1]?.at, 60);
  });

  it('ne renvoie pas un trio inchange, meme apres plusieurs minutes', () => {
    const clock = new FakeClock();
    let sends = 0;
    const pusher = new CountsPusher({
      send: async () => {
        sends += 1;
        return 1;
      },
      targets: () => [target('a')],
      clock,
    });
    const snapshot = { asks: 1, errors: 0, ended: 0, oldestAt: 10 };

    pusher.update(snapshot);
    clock.advance(5_000);
    pusher.update(snapshot);
    clock.advance(5 * COUNTS_PUSH_MIN_INTERVAL_MS);

    assert.equal(sends, 1);
  });

  it('un trio qui revient a sa valeur d avant annule le rattrapage', () => {
    const clock = new FakeClock();
    let sends = 0;
    const pusher = new CountsPusher({
      send: async () => {
        sends += 1;
        return 1;
      },
      targets: () => [target('a')],
      clock,
    });

    pusher.update({ asks: 1, errors: 0, ended: 0, oldestAt: 10 });
    clock.advance(10_000);
    pusher.update({ asks: 2, errors: 0, ended: 0, oldestAt: 20 });
    clock.advance(5_000);
    pusher.update({ asks: 1, errors: 0, ended: 0, oldestAt: 10 });
    clock.advance(COUNTS_PUSH_MIN_INTERVAL_MS);

    assert.equal(sends, 1);
  });

  it('un appareil en plus recoit tout de suite, les autres gardent leur fenetre', () => {
    const chunksSent: string[][] = [];
    const clock = new FakeClock();
    let targets = [target('a')];
    const pusher = new CountsPusher({
      send: async (_counts, devices) => {
        chunksSent.push(devices.map((d) => d.deviceId));
        return devices.length;
      },
      targets: () => targets,
      clock,
    });

    pusher.update({ asks: 1, errors: 0, ended: 0, oldestAt: 0 });
    clock.advance(5_000);
    targets = [target('a'), target('b')];
    pusher.update({ asks: 1, errors: 0, ended: 0, oldestAt: 0 });

    assert.deepEqual(chunksSent, [['a'], ['b']]);
  });
});
