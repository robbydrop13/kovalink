// Le trombinoscope des agents (P06). Relu a l'ouverture de l'onglet, puis toutes les 60 s
// tant qu'il est affiche, comme les routines : `team list` lit le disque du Mac pour
// quelques noms, la minute suffit. Le dernier instantane reste en memoire quand on quitte
// l'onglet, pour que le retour soit immediat.
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';
import type { AgentsRosterResponse } from '@/protocol';
import { fetchAgentsRoster } from '@/net/http';

const POLL_MS = 60_000;

interface RosterState {
  roster: AgentsRosterResponse | null;
  error: string | null;
  refreshing: boolean;
  load: (refresh?: boolean) => Promise<void>;
}

/** Reponse tardive : seule la derniere requete partie a le droit d'ecrire l'etat. */
let generation = 0;

const useRosterStore = create<RosterState>((set) => ({
  roster: null,
  error: null,
  refreshing: false,
  load: async (refresh = false) => {
    const mine = ++generation;
    if (refresh) set({ refreshing: true });
    try {
      const res = await fetchAgentsRoster();
      if (mine === generation) set({ roster: res, error: null });
    } catch (e) {
      if (mine === generation) set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (mine === generation) set({ refreshing: false });
    }
  },
}));

interface RosterView {
  roster: AgentsRosterResponse | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

/** Le rafraichissement de l'onglet : montage, retour de la pile, puis un passage par minute. */
export function useRoster(): RosterView {
  const roster = useRosterStore((s) => s.roster);
  const error = useRosterStore((s) => s.error);
  const refreshing = useRosterStore((s) => s.refreshing);
  const load = useRosterStore((s) => s.load);
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );
  const refresh = useCallback(() => load(true), [load]);
  const reload = useCallback(() => load(), [load]);
  return { roster, error, refreshing, refresh, reload };
}
