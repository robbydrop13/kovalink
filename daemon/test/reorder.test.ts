// Reordonner depuis l'app : la chaine d'echanges est pure et testee seule, puis les deux
// operations tournent avec un VRAI `KovaIpc` contre le faux Kova, qui enregistre chaque
// commande recue. Ce qui atteint le faux est exactement ce qui atteindrait le vrai.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-reorder-'));
process.env['KOVALINK_QUIET'] = '1';

const { PaneStore } = await import('../src/kova/panes.js');
const { KovaIpc } = await import('../src/kova/ipc.js');
const { KOVA_EXEC, realDeps } = await import('../src/kova/discover.js');
const { parseIndex, reorderPane, reorderTab, swapChain } = await import('../src/kova/reorder.js');
const { FakeKova } = await import('./helpers/fakeKova.js');

describe('swapChain', () => {
  const ids = [10, 20, 30, 40, 50];

  it('vers la droite : le pane echange avec chaque voisin jusqu au rang vise', () => {
    assert.deepEqual(swapChain(ids, 1, 3), [
      [20, 30],
      [20, 40],
    ]);
  });

  it('vers la gauche : les voisins dans l autre sens', () => {
    assert.deepEqual(swapChain(ids, 4, 1), [
      [50, 40],
      [50, 30],
      [50, 20],
    ]);
  });

  it('meme rang : aucun echange', () => {
    assert.deepEqual(swapChain(ids, 2, 2), []);
  });

  it('rang vise au dela de la liste : borne au dernier rang', () => {
    assert.deepEqual(swapChain(ids, 0, 99), [
      [10, 20],
      [10, 30],
      [10, 40],
      [10, 50],
    ]);
    assert.deepEqual(swapChain(ids, 3, 4), [[40, 50]]);
  });

  it('depart hors de la liste ou liste vide : aucun echange', () => {
    assert.deepEqual(swapChain(ids, -1, 2), []);
    assert.deepEqual(swapChain(ids, 5, 2), []);
    assert.deepEqual(swapChain([], 0, 0), []);
    assert.deepEqual(swapChain([7], 0, 3), []);
  });

  it('parseIndex : entier positif ou nul seulement', () => {
    assert.equal(parseIndex(0), 0);
    assert.equal(parseIndex(3), 3);
    assert.equal(parseIndex(-1), null);
    assert.equal(parseIndex(1.5), null);
    assert.equal(parseIndex('2'), null);
    assert.equal(parseIndex(undefined), null);
  });
});

// --- Les deux operations contre le faux Kova ----------------------------------

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
afterEach(() => {
  fake.respond = null;
  fake.received.length = 0;
});

function rawPane(id: number, tab: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    window: 0,
    tab,
    cwd: '/tmp/projet',
    title: 'zsh',
    pid: 1,
    agent: null,
    working: false,
    awaiting: false,
    launching: false,
    child_processes: [],
    ...extra,
  };
}

function rawTab(id: number, tabIndex: number): Record<string, unknown> {
  return { id, window: 0, tab_index: tabIndex, title: `t${id}`, pane_count: 1, focused_pane_id: -1, active: false };
}

/** Deux onglets ; l'onglet 1 porte trois panes dans l'ordre de Kova, l'onglet 0 un seul. */
function harness() {
  const panes = new PaneStore();
  panes.setTabs([rawTab(100, 0), rawTab(101, 1), rawTab(102, 2)]);
  panes.replaceAll([rawPane(1, 0), rawPane(21, 1), rawPane(22, 1), rawPane(23, 1)]);
  const refreshed: string[] = [];
  const services = {
    ipc,
    panes,
    refreshLayout: async (reason: string) => {
      refreshed.push(reason);
    },
  };
  return { services, panes, refreshed };
}

describe('reorderTab', () => {
  it('envoie move-tab avec l identifiant et le rang, puis relit la mise en page', async () => {
    const { services, refreshed } = harness();
    const out = await reorderTab(services, 102, 0, 'dev');
    assert.deepEqual(out, { ok: true, response: { moved: true } });
    assert.deepEqual(fake.received, [{ cmd: 'move-tab', tab_id: 102, index: 0 }]);
    assert.deepEqual(refreshed, ['tab-reorder']);
  });

  it('onglet inconnu : 404 TAB_NOT_FOUND, rien ne part', async () => {
    const { services } = harness();
    const out = await reorderTab(services, 999, 0, 'dev');
    assert.deepEqual(out, { ok: false, status: 404, code: 'TAB_NOT_FOUND', message: 'unknown tab' });
    assert.equal(fake.received.length, 0);
  });

  it('rang invalide : 400 BAD_REQUEST, rien ne part', async () => {
    const { services } = harness();
    for (const bad of [-1, 1.5, '1', undefined]) {
      const out = await reorderTab(services, 101, bad, 'dev');
      assert.equal(out.ok, false);
      if (!out.ok) assert.deepEqual([out.status, out.code], [400, 'BAD_REQUEST']);
    }
    assert.equal(fake.received.length, 0);
  });

  it('Kova sans move-tab (unknown command) : 501 KOVA_TOO_OLD avec la marche a suivre', async () => {
    const { services, refreshed } = harness();
    fake.respond = (msg) => (msg['cmd'] === 'move-tab' ? { ok: false, error: 'unknown command: move-tab' } : null);
    const out = await reorderTab(services, 101, 2, 'dev');
    assert.deepEqual(out, { ok: false, status: 501, code: 'KOVA_TOO_OLD', message: 'update Kova on the Mac to reorder tabs' });
    assert.equal(refreshed.length, 0);
  });

  it('autre refus de Kova : 502 KOVA_ERROR, message relaye', async () => {
    const { services } = harness();
    fake.respond = () => ({ ok: false, error: 'tab 101 not found' });
    const out = await reorderTab(services, 101, 2, 'dev');
    assert.deepEqual(out, { ok: false, status: 502, code: 'KOVA_ERROR', message: 'move-tab failed: tab 101 not found' });
  });
});

describe('reorderPane', () => {
  it('vers la droite : une chaine de swap-pane voisins, dans l ordre de Kova, puis relecture', async () => {
    const { services, refreshed } = harness();
    const out = await reorderPane(services, 21, 2, 'dev');
    assert.deepEqual(out, { ok: true, response: { moved: true, swaps: 2 } });
    assert.deepEqual(fake.received, [
      { cmd: 'swap-pane', pane_id_a: 21, pane_id_b: 22 },
      { cmd: 'swap-pane', pane_id_a: 21, pane_id_b: 23 },
    ]);
    assert.deepEqual(refreshed, ['pane-reorder']);
  });

  it('vers la gauche, rang borne au nombre de panes de l onglet, jamais un pane d un autre onglet', async () => {
    const { services } = harness();
    const out = await reorderPane(services, 23, 0, 'dev');
    assert.deepEqual(out, { ok: true, response: { moved: true, swaps: 2 } });
    assert.deepEqual(fake.received, [
      { cmd: 'swap-pane', pane_id_a: 23, pane_id_b: 22 },
      { cmd: 'swap-pane', pane_id_a: 23, pane_id_b: 21 },
    ]);
    fake.received.length = 0;
    const clamped = await reorderPane(services, 21, 99, 'dev');
    assert.deepEqual(clamped, { ok: true, response: { moved: true, swaps: 2 } });
    assert.ok(fake.received.every((m) => m['pane_id_b'] !== 1), 'le pane de l onglet 0 n est jamais touche');
  });

  it('meme rang, ou pane seul dans son onglet : aucun echange, moved sans swap', async () => {
    const { services } = harness();
    assert.deepEqual(await reorderPane(services, 22, 1, 'dev'), { ok: true, response: { moved: true, swaps: 0 } });
    assert.deepEqual(await reorderPane(services, 1, 5, 'dev'), { ok: true, response: { moved: true, swaps: 0 } });
    assert.equal(fake.received.length, 0);
  });

  it('pane inconnu : 404 PANE_NOT_FOUND ; rang invalide : 400', async () => {
    const { services } = harness();
    assert.deepEqual(await reorderPane(services, 999, 0, 'dev'), { ok: false, status: 404, code: 'PANE_NOT_FOUND', message: 'unknown pane' });
    const bad = await reorderPane(services, 21, -2, 'dev');
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.deepEqual([bad.status, bad.code], [400, 'BAD_REQUEST']);
    assert.equal(fake.received.length, 0);
  });

  it('un swap refuse arrete la chaine : 502 avec le nombre d echanges appliques, puis relecture', async () => {
    const { services, refreshed } = harness();
    let n = 0;
    fake.respond = (msg) => {
      if (msg['cmd'] !== 'swap-pane') return null;
      n += 1;
      return n === 2 ? { ok: false, error: 'could not swap panes 21 and 23' } : null;
    };
    const out = await reorderPane(services, 21, 2, 'dev');
    assert.deepEqual(out, {
      ok: false,
      status: 502,
      code: 'KOVA_ERROR',
      message: 'swap-pane failed after 1 of 2 swaps: could not swap panes 21 and 23',
    });
    assert.equal(fake.received.length, 2);
    assert.deepEqual(refreshed, ['pane-reorder']);
  });
});

describe('PaneStore.inTab', () => {
  it('suit l ordre de list-panes, meme quand Kova le change apres un swap', () => {
    const panes = new PaneStore();
    panes.replaceAll([rawPane(21, 1), rawPane(22, 1), rawPane(23, 1)]);
    assert.deepEqual(panes.inTab(0, 1).map((p) => p.id), [21, 22, 23]);
    panes.replaceAll([rawPane(22, 1), rawPane(21, 1), rawPane(23, 1)]);
    assert.deepEqual(panes.inTab(0, 1).map((p) => p.id), [22, 21, 23]);
    assert.deepEqual(panes.inTab(0, 0), []);
  });
});
