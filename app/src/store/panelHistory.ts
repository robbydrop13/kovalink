// Ce que le panneau du TELEPHONE a ouvert. Persiste dans le `kv` SQLite, 50 au plus.
//
// Le fichier de Kova (`panel-history.json`) n'est jamais ecrit depuis l'iPhone : le daemon
// le lit seulement. Les deux listes se fusionnent a l'affichage (`features/panel/history`).
import { create } from 'zustand';
import type { PanelHistoryEntry } from '@/protocol';
import { kvGet, kvSet } from '@/db';
import { recordEntry, retitleEntry } from '@/features/panel/history';
import type { PanelTarget } from '@/features/panel/target';

const KEY = 'panel.history';

interface PanelHistoryState {
  entries: PanelHistoryEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  record: (target: PanelTarget, title: string) => void;
  retitle: (target: string, title: string) => void;
}

export const usePanelHistory = create<PanelHistoryState>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const stored = await kvGet<PanelHistoryEntry[]>(KEY).catch(() => null);
    if (get().hydrated) return;
    set({ entries: Array.isArray(stored) ? stored : [], hydrated: true });
  },

  // Apres la lecture du disque : sinon la premiere ouverture ecraserait la liste gardee.
  record: (target, title) => {
    const now = Date.now();
    void get()
      .hydrate()
      .then(() => {
        const entries = recordEntry(get().entries, target, title, now);
        set({ entries });
        return kvSet(KEY, entries);
      })
      .catch(() => undefined);
  },

  retitle: (target, title) => {
    const entries = retitleEntry(get().entries, target, title);
    if (entries === get().entries) return;
    set({ entries });
    void kvSet(KEY, entries).catch(() => undefined);
  },
}));
