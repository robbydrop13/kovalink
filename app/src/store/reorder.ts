// Ordres en attente après un glisser-déposer sur l'écran Sessions. L'app montre tout de
// suite l'ordre visé, envoie la demande au daemon, puis attend que le Mac le confirme par
// un instantané (le daemon relit la disposition juste après la commande, et toutes les 5 s).
// Sans confirmation dans les 6 s, ou sur erreur, l'ordre en attente est retiré : la liste
// revient à celui du Mac, et l'écran le dit. Le transport est injectable pour les tests,
// comme la persistance de `tabCollapse.ts`.
import { create } from 'zustand';
import type { Pane, Tab } from '@/protocol';
import { moveIndex, type PendingPanes, type PendingTabs } from '@/features/sessions/tabGroups';
import { usePanes } from '@/store/panes';

export type { PendingPanes, PendingTabs };

/** Le poll de disposition du daemon est à 5 s : un instantané doit être passé avant. */
export const REORDER_CONFIRM_MS = 6_000;

export type ReorderFailure = 'unconfirmed' | 'unsupported';

export interface ReorderTransport {
  reorderTab: (tabId: number, index: number) => Promise<unknown>;
  reorderPane: (paneId: number, index: number) => Promise<unknown>;
  /** Relit l'instantané sans attendre le socket, pour confirmer au plus tôt. */
  refresh: () => Promise<{ tabs: Tab[]; panes: Pane[] }>;
}

// `@/net/http` touche le trousseau : importé à l'appel, pour rester testable sous Node.
const httpTransport: ReorderTransport = {
  reorderTab: async (tabId, index) => (await import('@/net/http')).postTabReorder(tabId, index),
  reorderPane: async (paneId, index) => (await import('@/net/http')).postPaneReorder(paneId, index),
  refresh: async () => {
    const snapshot = await (await import('@/net/http')).fetchPanes();
    usePanes.getState().applySnapshot(snapshot);
    return snapshot;
  },
};

let transport: ReorderTransport = httpTransport;

/** Tests : remplace le réseau. `null` remet le défaut. */
export function setReorderTransport(next: ReorderTransport | null): void {
  transport = next ?? httpTransport;
}

type PendingKey = 'tabs' | `panes:${number}`;
const timers = new Map<PendingKey, ReturnType<typeof setTimeout>>();

function clearTimer(key: PendingKey): void {
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

function is501(e: unknown): boolean {
  return e instanceof Error && (e as { status?: unknown }).status === 501;
}

/** Même suite, en ne comparant que les identifiants connus des deux côtés. */
function sameOrder(server: number[], pending: number[]): boolean {
  const a = server.filter((id) => pending.includes(id));
  const b = pending.filter((id) => server.includes(id));
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

interface ReorderState {
  /** Un seul déplacement d'onglet à la fois. */
  tabs: PendingTabs | null;
  /** Par onglet : le dernier déplacement de pane demandé dedans. */
  panes: Record<number, PendingPanes>;
  moveTab: (
    window: number,
    currentOrder: number[],
    from: number,
    to: number,
    onFailure: (kind: ReorderFailure) => void,
  ) => Promise<void>;
  movePane: (
    tabId: number,
    currentOrder: number[],
    from: number,
    to: number,
    onFailure: (kind: ReorderFailure) => void,
  ) => Promise<void>;
  /** À appeler après chaque instantané appliqué : retire les ordres que le Mac montre déjà. */
  reconcile: (tabs: Tab[], panes: Pane[]) => void;
  clear: () => void;
}

export const useReorder = create<ReorderState>((set, get) => {
  const drop = (key: PendingKey): void => {
    clearTimer(key);
    if (key === 'tabs') {
      if (get().tabs) set({ tabs: null });
      return;
    }
    const tabId = Number(key.slice('panes:'.length));
    if (get().panes[tabId]) {
      const panes = { ...get().panes };
      delete panes[tabId];
      set({ panes });
    }
  };
  const pendingOf = (key: PendingKey): PendingTabs | PendingPanes | undefined =>
    key === 'tabs' ? (get().tabs ?? undefined) : get().panes[Number(key.slice('panes:'.length))];

  /**
   * Envoie, relit tout de suite, puis laisse 6 s au Mac pour montrer le nouvel ordre.
   * `mine` est l'ordre posé par cet appel : un déplacement plus récent sur la même clé
   * l'a peut-être remplacé, auquel cas cet appel n'a plus rien à retirer ni à signaler.
   */
  const settle = async (
    key: PendingKey,
    mine: PendingTabs | PendingPanes,
    send: () => Promise<unknown>,
    onFailure: (kind: ReorderFailure) => void,
  ) => {
    clearTimer(key);
    try {
      await send();
    } catch (e) {
      if (pendingOf(key) !== mine) return;
      drop(key);
      onFailure(is501(e) ? 'unsupported' : 'unconfirmed');
      return;
    }
    try {
      const snapshot = await transport.refresh();
      get().reconcile(snapshot.tabs, snapshot.panes);
    } catch {
      // Le socket ou le poll du daemon confirmera, ou le délai tranchera.
    }
    if (pendingOf(key) !== mine || timers.has(key)) return;
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        if (pendingOf(key) !== mine) return;
        drop(key);
        onFailure('unconfirmed');
      }, REORDER_CONFIRM_MS),
    );
  };

  return {
    tabs: null,
    panes: {},

    moveTab: async (window, currentOrder, from, to, onFailure) => {
      const tabId = currentOrder[from];
      if (tabId === undefined || from === to) return;
      const pending: PendingTabs = { window, order: moveIndex(currentOrder, from, to), since: Date.now() };
      set({ tabs: pending });
      await settle('tabs', pending, () => transport.reorderTab(tabId, to), onFailure);
    },

    movePane: async (tabId, currentOrder, from, to, onFailure) => {
      const paneId = currentOrder[from];
      if (paneId === undefined || from === to) return;
      const pending: PendingPanes = { tabId, order: moveIndex(currentOrder, from, to), since: Date.now() };
      set({ panes: { ...get().panes, [tabId]: pending } });
      await settle(`panes:${tabId}`, pending, () => transport.reorderPane(paneId, to), onFailure);
    },

    reconcile: (tabs, panes) => {
      const pendingTabs = get().tabs;
      if (pendingTabs) {
        const server = tabs
          .filter((t) => t.window === pendingTabs.window)
          .sort((a, b) => a.tab_index - b.tab_index)
          .map((t) => t.id);
        if (sameOrder(server, pendingTabs.order)) drop('tabs');
      }
      for (const pending of Object.values(get().panes)) {
        const server = panes.filter((p) => p.tabId === pending.tabId).map((p) => p.id);
        if (sameOrder(server, pending.order)) drop(`panes:${pending.tabId}`);
      }
    },

    clear: () => {
      for (const key of [...timers.keys()]) clearTimer(key);
      set({ tabs: null, panes: {} });
    },
  };
});
