// Marques de lecture de Cmd+J (docs/16, 6.4) : par pane, la référence (`promptRef`) du
// dernier prompt que Robin a LU sur ce téléphone. Une référence, jamais une horloge :
// aucun décalage Mac / iPhone ne fait apparaître ou disparaître un non lu. Persisté dans
// `kv`, purgé quand le pane ferme ou disparaît d'un instantané.
import { create } from 'zustand';
import { kvGet, kvSet } from '@/db';

const READS_KEY = 'reads.byPane';

interface ReadsState {
  byPane: Record<number, string>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  markRead: (paneId: number, promptRef: string) => void;
  forget: (paneIds: readonly number[]) => void;
}

function persist(byPane: Record<number, string>): void {
  void kvSet(READS_KEY, byPane);
}

export const useReads = create<ReadsState>((set, get) => ({
  byPane: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const stored = (await kvGet<Record<number, string>>(READS_KEY).catch(() => null)) ?? {};
    set((s) => ({ byPane: { ...stored, ...s.byPane }, hydrated: true }));
  },

  markRead: (paneId, promptRef) => {
    if (get().byPane[paneId] === promptRef) return;
    const byPane = { ...get().byPane, [paneId]: promptRef };
    set({ byPane });
    persist(byPane);
  },

  forget: (paneIds) => {
    if (paneIds.length === 0) return;
    const byPane = { ...get().byPane };
    let changed = false;
    for (const id of paneIds) {
      if (id in byPane) {
        delete byPane[id];
        changed = true;
      }
    }
    if (!changed) return;
    set({ byPane });
    persist(byPane);
  },
}));
