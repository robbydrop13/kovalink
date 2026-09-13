// Onglets repliés sur l'écran Sessions : par identifiant Kova d'onglet, seuls les onglets
// repliés sont stockés (un onglet absent est déplié). Persisté dans le `kv` SQLite pour
// survivre à un relancement de l'app, comme les préférences. L'identifiant Kova est stable
// à travers les réordonnancements d'onglets, contrairement à `tab_index`.
import { create } from 'zustand';
import { kvGet, kvSet } from '@/db';

const COLLAPSE_KEY = 'tabs.collapsed';

export type Collapsed = Record<number, true>;

export interface TabCollapsePersistence {
  load: () => Promise<Collapsed | null>;
  save: (collapsed: Collapsed) => Promise<void>;
}

const kvPersistence: TabCollapsePersistence = {
  load: () => kvGet<Collapsed>(COLLAPSE_KEY),
  save: (collapsed) => kvSet(COLLAPSE_KEY, collapsed),
};

let persistence: TabCollapsePersistence = kvPersistence;

/** Tests : remplace SQLite par une mémoire. `null` remet le défaut. */
export function setTabCollapsePersistence(next: TabCollapsePersistence | null): void {
  persistence = next ?? kvPersistence;
}

interface TabCollapseState {
  collapsed: Collapsed;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  toggle: (tabId: number) => void;
  isCollapsed: (tabId: number) => boolean;
}

export const useTabCollapse = create<TabCollapseState>((set, get) => ({
  collapsed: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const stored = (await persistence.load().catch(() => null)) ?? {};
    // Un tap pendant le chargement l'emporte sur ce qui vient du disque.
    set((s) => ({ collapsed: { ...stored, ...s.collapsed }, hydrated: true }));
  },

  toggle: (tabId) => {
    const collapsed = { ...get().collapsed };
    if (collapsed[tabId]) delete collapsed[tabId];
    else collapsed[tabId] = true;
    set({ collapsed });
    void persistence.save(collapsed).catch(() => undefined);
  },

  isCollapsed: (tabId) => get().collapsed[tabId] === true,
}));
