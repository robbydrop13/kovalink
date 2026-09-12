import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-ipc-'));
process.env['KOVALINK_QUIET'] = '1';

const { KovaIpc } = await import('../src/kova/ipc.js');
const { KOVA_EXEC, realDeps } = await import('../src/kova/discover.js');
const { FakeKova, FAKE_KOVA_IDLE_MS: IDLE_MS } = await import('./helpers/fakeKova.js');

const fake = new FakeKova();
before(async () => {
  await fake.start();
});
after(() => fake.stop());

function makeIpc(downAfterMs?: number) {
  const deps = { ...realDeps, socketDir: fake.dir, commOf: () => `${KOVA_EXEC}\n` };
  const ipc = new KovaIpc(deps, downAfterMs);
  const statuses: string[] = [];
  let readyCount = 0;
  ipc.on('status', (s: string) => statuses.push(s));
  ipc.on('ready', () => {
    readyCount += 1;
  });
  return { ipc, statuses, ready: () => readyCount };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('deux regimes de connexion IPC', () => {
  it('la fermeture pour inactivite d une connexion de requete est le cas NOMINAL', async () => {
    const { ipc, statuses, ready } = makeIpc();
    ipc.start();
    await new Promise((r) => ipc.once('ready', r));
    const closuresAtStart = fake.idleClosures;

    // On laisse passer plusieurs delais d'inactivite, en intercalant des requetes.
    for (let i = 0; i < 3; i++) {
      await wait(IDLE_MS * 2);
      const panes = await ipc.listPanes();
      assert.deepEqual(panes, []);
    }
    await wait(IDLE_MS * 2);

    assert.ok(
      fake.idleClosures > closuresAtStart,
      'le faux Kova doit bien avoir ferme des connexions de requete',
    );
    // Aucune degradation d'etat, aucune reconnexion : le chemin de requete est jetable.
    assert.deepEqual(statuses, ['up'], `etats observes : ${statuses.join(', ')}`);
    assert.equal(ready(), 1, 'aucune reconnexion ne doit avoir eu lieu');
    assert.equal(ipc.state, 'up');
    ipc.stop();
  });

  it('la fermeture de l abonnement est un INCIDENT, suivie d une reconnexion', async () => {
    const { ipc, statuses, ready } = makeIpc();
    ipc.start();
    await new Promise((r) => ipc.once('ready', r));
    assert.deepEqual(statuses, ['up']);

    fake.dropSubscription();
    await new Promise((r) => ipc.once('ready', r));

    assert.deepEqual(statuses, ['up', 'reconnecting', 'up']);
    assert.equal(ready(), 2, 'l abonnement doit avoir ete retabli');
    ipc.stop();
  });

  it('une requete refusee ne degrade pas l etat de l abonnement', async () => {
    const { ipc, statuses } = makeIpc();
    ipc.start();
    await new Promise((r) => ipc.once('ready', r));
    // `send-keys` est refuse par le garde-fou, hors de KeyGate.
    assert.throws(() => ipc.request({ cmd: 'send-keys', pane_id: 1, text: 'x' }));
    await wait(IDLE_MS * 2);
    assert.deepEqual(statuses, ['up']);
    ipc.stop();
  });

  it('les requetes restent serialisees, une seule en vol a la fois', async () => {
    const { ipc } = makeIpc();
    ipc.start();
    await new Promise((r) => ipc.once('ready', r));
    const results = await Promise.all([ipc.listPanes(), ipc.listTabs(), ipc.listPanes()]);
    assert.equal(results.length, 3);
    ipc.stop();
  });
});

/**
 * CA-123. Kova quitte : l'abonnement tombe, aucun socket n'est redecouvert. Avant
 * `KOVA_DOWN_AFTER_MS` l'etat est `reconnecting` ; a l'echeance il passe a `down` et y
 * reste sans clignoter, tant qu'un socket ne revient pas.
 */
describe('Kova quitte : etat down apres le delai sans socket (CA-123)', () => {
  it('reconnecting, puis down a l echeance, puis up quand Kova revient', async () => {
    const own = new FakeKova();
    await own.start();
    const deps = { ...realDeps, socketDir: own.dir, commOf: () => `${KOVA_EXEC}\n` };
    const ipc = new KovaIpc(deps, 300);
    const statuses: string[] = [];
    ipc.on('status', (s: string) => statuses.push(s));
    ipc.start();
    await new Promise((r) => ipc.once('ready', r));
    assert.deepEqual(statuses, ['up']);

    // Kova est quitte : plus de serveur, plus de socket.
    own.stop();
    await new Promise<void>((r) => ipc.once('status', () => r()));
    assert.equal(ipc.state, 'reconnecting');
    await wait(150);
    assert.equal(ipc.state, 'reconnecting', 'pas encore a l echeance');
    await wait(300);
    assert.equal(ipc.state, 'down');
    assert.equal(ipc.pid, null);
    // Plusieurs tentatives de reconnexion passent : l'etat ne clignote pas.
    await wait(600);
    assert.deepEqual(statuses, ['up', 'reconnecting', 'down']);

    // Kova relance sur le meme chemin : le daemon le rattrape seul.
    const back = new FakeKova();
    back.path = own.path;
    await back.start();
    await new Promise((r) => ipc.once('ready', r));
    assert.equal(ipc.state, 'up');
    ipc.stop();
    back.stop();
  });

  it('restart() apres un reveil passe par reconnecting, jamais par down', async () => {
    const { ipc, statuses } = makeIpc(5_000);
    ipc.start();
    await new Promise((r) => ipc.once('ready', r));
    ipc.restart('reveil');
    await new Promise((r) => ipc.once('ready', r));
    assert.deepEqual(statuses, ['up', 'reconnecting', 'up']);
    ipc.stop();
  });

  it('sans Kova au demarrage, down d emblee, sans attendre', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'kovalink-nosock-'));
    const ipc = new KovaIpc({ ...realDeps, socketDir: empty }, 5_000);
    const statuses: string[] = [];
    ipc.on('status', (s: string) => statuses.push(s));
    ipc.start();
    await wait(50);
    assert.equal(ipc.state, 'down');
    assert.deepEqual(statuses, [], 'deja down au depart, aucune transition a annoncer');
    ipc.stop();
  });
});
