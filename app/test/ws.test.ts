// Un seul socket vivant : un socket remplacé ne rappelle plus personne (13 septembre).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

class FakeWs {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWs.all.push(this);
  }
  send(s: string): void {
    this.sent.push(s);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  /** Ce que fait le vrai socket : `onclose` arrive APRÈS `close()`, de façon asynchrone. */
  fireClose(code = 1000): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  pong(): void {
    const ping = JSON.parse(this.sent[this.sent.length - 1] ?? '{}') as { id: string };
    this.onmessage?.({ data: JSON.stringify({ t: 'pong', reqId: ping.id, serverTime: new Date().toISOString() }) });
  }
}

const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
beforeEach(() => {
  FakeWs.all = [];
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWs;
});
afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  mock.timers.reset();
});

/** Minuteries simulées : les cadences de ping se testent à leur vraie valeur, sans attendre. */
function fakeClock(): { tick: (ms: number) => void } {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  return { tick: (ms: number) => mock.timers.tick(ms) };
}

const { Socket, PING_INTERVAL_FAST_MS, PONG_TIMEOUT_FAST_MS } = await import('@/net/ws');

function make() {
  const events: string[] = [];
  const latencies: number[] = [];
  const s = new Socket('wss://mac:1/ws', 'tok', {
    onOpen: () => events.push('open'),
    onClose: (r) => events.push(`close:${r}`),
    onMessage: (m) => events.push(`msg:${m.t}`),
    onLatency: (ms) => latencies.push(ms),
    foregroundPaneId: () => null,
  });
  return { s, events, latencies };
}

describe('Socket', () => {
  it('reconnectNow remplace le socket ; la fermeture tardive de l ancien est ignorée', () => {
    const { s, events } = make();
    s.connect();
    const first = FakeWs.all[0]!;
    first.open();
    s.reconnectNow();
    assert.equal(FakeWs.all.length, 2, 'un nouveau socket, pas trois');
    assert.equal(first.closed, true);
    const second = FakeWs.all[1]!;
    // L'ancien ferme après coup : ni « close », ni reconnexion, et le nouveau reste là.
    first.fireClose(1000);
    assert.deepEqual(events, ['open']);
    second.open();
    assert.equal(s.isOpen, true);
    assert.equal(FakeWs.all.length, 2);
    assert.equal(s.send({ t: 'ping', id: 'x', foregroundPaneId: null }), true);
    assert.equal(second.sent.length, 1);
    s.close();
  });

  it('une fermeture réseau du socket courant remonte et reprogramme une connexion', () => {
    const { s, events } = make();
    s.connect();
    const first = FakeWs.all[0]!;
    first.open();
    first.fireClose(1006);
    assert.deepEqual(events, ['open', 'close:network']);
    assert.equal(s.isOpen, false);
    s.close();
  });

  /**
   * A3. En régime lent (20 s de ping, 8 s de pong, deux pongs manqués), un socket mort
   * pouvait rester en place 36 s. Le journal du 25 septembre montre pire : mort à 20:04:55
   * avec une session ouverte, retour à 20:29:23, 24,5 minutes d'aveuglement, pendant que
   * les envois HTTPS passaient toujours. Écran de session ouvert, un seul pong manqué
   * suffit désormais.
   */
  it('en régime rapide, un seul pong manqué reconnecte', () => {
    const clock = fakeClock();
    const { s } = make();
    s.setFastPing(true);
    s.connect();
    const first = FakeWs.all[0]!;
    first.open();
    s.pingNow();
    assert.equal(FakeWs.all.length, 1);
    // Aucun pong : à l'échéance du pong court, on reconnecte sans attendre un second ping.
    clock.tick(PONG_TIMEOUT_FAST_MS);
    assert.equal(FakeWs.all.length, 2, 'un socket neuf, tout de suite');
    s.close();
  });

  it('en régime lent, il faut deux pongs manqués', () => {
    const clock = fakeClock();
    const { s } = make();
    s.connect();
    const first = FakeWs.all[0]!;
    first.open();
    s.pingNow();
    clock.tick(8_000);
    assert.equal(FakeWs.all.length, 1, 'un second ping part, pas une reconnexion');
    clock.tick(8_000);
    assert.equal(FakeWs.all.length, 2);
    s.close();
  });

  it('le passage en régime rapide reprend la minuterie en cours', () => {
    const clock = fakeClock();
    const { s } = make();
    s.connect();
    FakeWs.all[0]!.open();
    const sentBefore = FakeWs.all[0]!.sent.length;
    s.setFastPing(true);
    clock.tick(PING_INTERVAL_FAST_MS);
    assert.ok(FakeWs.all[0]!.sent.length > sentBefore, 'le ping serré part sans attendre 20 s');
    s.close();
  });

  it('la latence est l aller-retour du ping, mesuré par identifiant', () => {
    const { s, latencies } = make();
    s.connect();
    const ws = FakeWs.all[0]!;
    ws.open();
    s.pingNow();
    ws.pong();
    assert.equal(latencies.length, 1);
    assert.ok(latencies[0]! < 1000);
    s.close();
  });
});
