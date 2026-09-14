// Tri de la liste des onglets sur l'écran Sessions : l'ordre de Kova (le défaut, celui de la
// barre d'onglets du Mac) ou par activité (les onglets qui travaillent d'abord, puis ceux
// qui attendent, puis les autres). Persisté dans le `kv` SQLite, comme le repli des onglets.
import { create } from 'zustand';
import { kvGet, kvSet } from '@/db';
import type { TabSortMode } from '@/features/sessions/tabGroups';

const SORT_KEY = 'tabs.sort';

export interface TabSortPersistence {
  load: () => Promise<TabSortMode | null>;
  save: (mode: TabSortMode) => Promise<void>;
}

const kvPersistence: TabSortPersistence = {
  load: () => kvGet<TabSortMode>(SORT_KEY),
  save: (mode) => kvSet(SORT_KEY, mode),
};

let persistence: TabSortPersistence = kvPersistence;

/** Tests : remplace SQLite par une mémoire. `null` remet le défaut. */
export function setTabSortPersistence(next: TabSortPersistence | null): void {
  persistence = next ?? kvPersistence;
}

interface TabSortState {
  mode: TabSortMode;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  toggle: () => void;
}

export const useTabSort = create<TabSortState>((set, get) => ({
  mode: 'kova',
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const stored = await persistence.load().catch(() => null);
    // Un tap pendant le chargement l'emporte sur ce qui vient du disque.
    set((s) => ({ mode: s.hydrated ? s.mode : stored === 'activity' ? 'activity' : s.mode, hydrated: true }));
  },

  toggle: () => {
    const mode: TabSortMode = get().mode === 'kova' ? 'activity' : 'kova';
    set({ mode, hydrated: true });
    void persistence.save(mode).catch(() => undefined);
  },
}));
