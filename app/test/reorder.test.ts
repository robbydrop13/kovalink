// Ordres en attente après un glisser-déposer : posés tout de suite, confirmés par un
// instantané, retirés sinon (délai ou erreur), avec la cause rendue à l écran.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Pane, Tab } from '@/protocol';
import { reduce, type DragDrop, type DragState } from '@/features/sessions/dragMachine';
import { REORDER_CONFIRM_MS, setReorderTransport, useReorder, type ReorderFailure } from '@/store/reorder';

function pane(id: number, tabId: number): Pane {
  return {
    id,
    tab: 0,
    tabId,
    window: 0,
    cwd: '/x',
    title: 'claude',
    focused: false,
    pid: 1,
    child_processes: [],
    is_idle: false,
    working: false,
    awaiting: false,
    awaiting_since: null,
    awaiting_seen: false,
    minimized: false,
    agent: 'claude',
    agent_session_id: null,
    agent_session_name: null,
    claude_session_id: null,
    claude_session_name: null,
    projectName: 'x',
    hasTranscript: false,
    chatCapable: true,
    permissionMode: null,
    color: null,
    launching: false,
    liveState: 'idle',
  };
}

function tab(id: number, tabIndex: number, window = 0): Tab {
  return {
    id,
    tab_index: tabIndex,
    window,
    title: null,
    pane_count: 1,
    focused_pane_id: 0,
    active: false,
    has_bell: false,
    has_completion: false,
    has_running: false,
    color: null,
  };
}

/** Instantané où les onglets sont dans `tabOrder` et les panes de l onglet 3 dans `paneOrder`. */
function snapshot(tabOrder: number[], paneOrder: number[] = [1, 2, 3]) {
  return {
    tabs: tabOrder.map((id, i) => tab(id, i)),
    panes: paneOrder.map((id) => pane(id, 3)),
  };
}

class FakeHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Réseau simulé : `next` est ce que la relecture renvoie, `fail` ce que l envoi lève. */
function network(next: ReturnType<typeof snapshot>, fail: unknown = null) {
  const calls: [string, number, number][] = [];
  setReorderTransport({
    reorderTab: async (tabId, index) => {
      calls.push(['tab', tabId, index]);
      if (fail) throw fail;
      return { moved: true };
    },
    reorderPane: async (paneId, index) => {
      calls.push(['pane', paneId, index]);
      if (fail) throw fail;
      return { moved: true, swaps: 1 };
    },
    refresh: async () => next,
  });
  return calls;
}

const failures: ReorderFailure[] = [];
const onFailure = (kind: ReorderFailure) => failures.push(kind);

describe('réordonnancement en attente', () => {
  beforeEach(() => {
    useReorder.getState().clear();
    failures.length = 0;
    mock.timers.enable({ apis: ['setTimeout'] });
  });
  afterEach(() => {
    mock.timers.reset();
    setReorderTransport(null);
  });

  it('pose l ordre visé tout de suite, envoie le rang, et l instantané qui le montre le retire', async () => {
    const calls = network(snapshot([11, 3, 18]));
    const done = useReorder.getState().moveTab(0, [3, 11, 18], 0, 1, onFailure);
    assert.deepEqual(useReorder.getState().tabs?.order, [11, 3, 18]);
    await done;
    assert.deepEqual(calls, [['tab', 3, 1]]);
    assert.equal(useReorder.getState().tabs, null, 'confirmé par la relecture');
    assert.deepEqual(failures, []);
  });

  it('sans instantané conforme dans les 6 s, retire l ordre et signale « non confirmé »', async () => {
    network(snapshot([3, 11, 18]));
    await useReorder.getState().moveTab(0, [3, 11, 18], 0, 2, onFailure);
    assert.deepEqual(useReorder.getState().tabs?.order, [11, 18, 3]);
    mock.timers.tick(REORDER_CONFIRM_MS - 1);
    assert.notEqual(useReorder.getState().tabs, null);
    mock.timers.tick(1);
    assert.equal(useReorder.getState().tabs, null);
    assert.deepEqual(failures, ['unconfirmed']);
  });

  it('un instantané du socket qui montre l ordre le confirme avant le délai, sans signal', async () => {
    network(snapshot([3, 11, 18]));
    await useReorder.getState().moveTab(0, [3, 11, 18], 2, 0, onFailure);
    useReorder.getState().reconcile(snapshot([18, 3, 11]).tabs, []);
    assert.equal(useReorder.getState().tabs, null);
    mock.timers.tick(REORDER_CONFIRM_MS);
    assert.deepEqual(failures, []);
  });

  it('501 : Kova trop ancien, retiré tout de suite avec « unsupported »', async () => {
    network(snapshot([3, 11, 18]), new FakeHttpError(501));
    await useReorder.getState().moveTab(0, [3, 11, 18], 0, 1, onFailure);
    assert.equal(useReorder.getState().tabs, null);
    assert.deepEqual(failures, ['unsupported']);
  });

  it('toute autre erreur HTTP ou réseau : retiré avec « unconfirmed »', async () => {
    network(snapshot([3, 11, 18]), new FakeHttpError(502));
    await useReorder.getState().moveTab(0, [3, 11, 18], 0, 1, onFailure);
    assert.deepEqual(failures, ['unconfirmed']);
    network(snapshot([3, 11, 18]), new Error('network request failed'));
    await useReorder.getState().moveTab(0, [3, 11, 18], 0, 1, onFailure);
    assert.deepEqual(failures, ['unconfirmed', 'unconfirmed']);
  });

  it('les panes : par onglet, même cycle', async () => {
    const calls = network(snapshot([3], [3, 1, 2]));
    const done = useReorder.getState().movePane(3, [1, 2, 3], 2, 0, onFailure);
    assert.deepEqual(useReorder.getState().panes[3]?.order, [3, 1, 2]);
    await done;
    assert.deepEqual(calls, [['pane', 3, 0]]);
    assert.deepEqual(useReorder.getState().panes, {});
  });

  it('un pane fermé entre temps ne bloque pas la confirmation', async () => {
    network(snapshot([3], [2, 1]));
    await useReorder.getState().movePane(3, [1, 2, 3], 1, 0, onFailure);
    assert.deepEqual(useReorder.getState().panes, {});
    assert.deepEqual(failures, []);
  });

  it('un déplacement plus récent sur le même onglet remplace l ancien, sans faux signal', async () => {
    network(snapshot([3], [1, 2, 3]), new FakeHttpError(502));
    const first = useReorder.getState().movePane(3, [1, 2, 3], 0, 2, onFailure);
    network(snapshot([3], [1, 2, 3]));
    const second = useReorder.getState().movePane(3, [1, 2, 3], 2, 0, onFailure);
    await Promise.all([first, second]);
    assert.deepEqual(useReorder.getState().panes[3]?.order, [3, 1, 2], 'le second reste en attente');
    assert.deepEqual(failures, [], 'l échec du premier ne retire pas le second');
    mock.timers.tick(REORDER_CONFIRM_MS);
    assert.deepEqual(failures, ['unconfirmed']);
  });

  it('le lâcher poste l identifiant du pane TENU et son rang FINAL dans l ordre affiché de l onglet', async () => {
    // L'onglet RunCoach (9) tel que le daemon le liste depuis le 14 septembre 2026 : l'ordre
    // de Kova, 11 puis 12, quel que soit leur état. La machine rapporte (1, 0) pour la
    // seconde ligne remontée en tête : c'est 12 qui part, au rang 0, et l'instantané qui
    // montre [12, 11] confirme.
    const shown = [11, 12];
    const slots = [{ y: 0, h: 160 }, { y: 168, h: 200 }];
    let state = reduce(null, { type: 'lift', index: 1, slots, range: [0, 1], gap: 8 }).state as DragState;
    for (const dy of [-20, -95, -168]) state = reduce(state, { type: 'move', dy }).state as DragState;
    const drop = reduce(state, { type: 'release' }).drop as DragDrop;
    assert.deepEqual([drop.from, drop.to], [1, 0]);
    const calls = network({ tabs: [tab(9, 0)], panes: [pane(12, 9), pane(11, 9)] });
    await useReorder.getState().movePane(9, shown, drop.from, drop.to, onFailure);
    assert.deepEqual(calls, [['pane', 12, 0]]);
    assert.deepEqual(useReorder.getState().panes, {}, 'confirmé par la relecture');
    assert.deepEqual(failures, []);
  });

  it('rien à faire quand le rang ne change pas', async () => {
    const calls = network(snapshot([3, 11, 18]));
    await useReorder.getState().moveTab(0, [3, 11, 18], 1, 1, onFailure);
    assert.deepEqual(calls, []);
    assert.equal(useReorder.getState().tabs, null);
  });
});
