// Requetes IPC emises pendant une reconnexion : elles attendent la connexion neuve (bornee)
// au lieu d'echouer. Cause du `start-claude` refuse du 15 septembre 2026 a 07:34, arrive a
// la milliseconde ou le reveil du Mac invalidait les sockets (`IPC connection lost (reveil)`).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-ipcwait-'));
process.env['KOVALINK_QUIET'] = '1';

const { KovaIpc, IpcError } = await import('../src/kova/ipc.js');
const { KOVA_EXEC, realDeps } = await import('../src/kova/discover.js');
const { FakeKova } = await import('./helpers/fakeKova.js');

function makeIpc(socketDir: string, waitMs: number) {
  return new KovaIpc({ ...realDeps, socketDir, commOf: () => `${KOVA_EXEC}\n` }, 60_000, waitMs);
}
const once = (ipc: InstanceType<typeof KovaIpc>, ev: string, value?: string): Promise<void> =>
  new Promise((resolve) => {
    const on = (v: unknown): void => {
      if (value !== undefined && v !== value) return;
      ipc.off(ev, on);
      resolve();
    };
    ipc.on(ev, on);
  });

describe('IPC pendant une reconnexion', () => {
  it('reveil : la requete en file et celle emise pendant la reconnexion aboutissent, une seule fois chacune', async () => {
    const fake = new FakeKova();
    await fake.start();
    const ipc = makeIpc(fake.dir, 3_000);
    ipc.start();
    await once(ipc, 'ready');
    const inFlight = ipc.listPanes();
    const queued = ipc.request({ cmd: 'focus-pane', pane_id: 3 });
    ipc.restart('reveil');
    assert.equal(ipc.state, 'reconnecting');
    const during = ipc.request({ cmd: 'set-pane-status', pane_id: 3, status: 'done' });
    await Promise.all([inFlight, queued, during]);
    assert.equal(fake.received.filter((m) => m['cmd'] === 'focus-pane').length, 1);
    assert.equal(fake.received.filter((m) => m['cmd'] === 'set-pane-status').length, 1);
    assert.equal(await ipc.whenUp(100), true);
    ipc.stop();
    fake.stop();
  });

  it('abonnement ferme puis Kova de retour : la requete attend la reconnexion et part', async () => {
    const fake = new FakeKova();
    await fake.start();
    const ipc = makeIpc(fake.dir, 4_000);
    ipc.start();
    await once(ipc, 'ready');
    const lost = once(ipc, 'status', 'reconnecting');
    fake.stop();
    await lost;
    const pending = ipc.request({ cmd: 'focus-pane', pane_id: 4 });
    await fake.start();
    const res = await pending;
    assert.equal(res.ok, true);
    assert.equal(fake.received.filter((m) => m['cmd'] === 'focus-pane' && m['pane_id'] === 4).length, 1);
    ipc.stop();
    fake.stop();
  });

  it('sans reconnexion, l attente est bornee puis KOVA_DOWN', async () => {
    // Les minuteries de l'IPC sont `unref` : sans Kova, rien ne garderait la boucle en vie
    // pendant l'attente (le serveur Fastify le fait dans le daemon).
    const keepAlive = setInterval(() => undefined, 1_000);
    const fake = new FakeKova();
    await fake.start();
    const ipc = makeIpc(fake.dir, 300);
    ipc.start();
    await once(ipc, 'ready');
    const lost = once(ipc, 'status', 'reconnecting');
    fake.stop();
    await lost;
    const started = Date.now();
    await assert.rejects(
      () => ipc.request({ cmd: 'focus-pane', pane_id: 5 }),
      (e: Error) => e instanceof IpcError && e.code === 'KOVA_DOWN' && /waited/.test(e.message),
    );
    assert.ok(Date.now() - started >= 250, 'la requete a attendu la reconnexion');
    assert.equal(await ipc.whenUp(50), false);
    ipc.stop();
    clearInterval(keepAlive);
  });

  it('Kova absent (down) : echec immediat, aucune attente', async () => {
    const ipc = makeIpc(mkdtempSync(join(tmpdir(), 'kovalink-empty-')), 3_000);
    ipc.start();
    assert.equal(ipc.state, 'down');
    const started = Date.now();
    await assert.rejects(() => ipc.listPanes(), (e: Error) => e instanceof IpcError && e.code === 'KOVA_DOWN');
    assert.ok(Date.now() - started < 200);
    ipc.stop();
  });
});
