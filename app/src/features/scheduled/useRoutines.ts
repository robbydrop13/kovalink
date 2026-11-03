// Les routines locales (P07). Relues à l'ouverture de l'onglet, puis toutes les 60 s tant
// qu'il est affiché : c'est la cadence du Mac, inutile de la dépasser pour des horaires à
// la minute. Le dernier instantané reste en mémoire quand on quitte l'onglet, pour que le
// point d'échec de la barre basse survive au changement d'onglet sans relancer le réseau.
import { useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';
import type { Routine } from '@/protocol';
import { fetchRoutines } from '@/net/http';
import { needsAttention } from './group';

const POLL_MS = 60_000;

interface RoutinesState {
  routines: Routine[] | null;
  error: string | null;
  refreshing: boolean;
  load: (refresh?: boolean) => Promise<void>;
}

/** Réponse tardive : seule la dernière requête partie a le droit d'écrire l'état. */
let generation = 0;

const useRoutinesStore = create<RoutinesState>((set) => ({
  routines: null,
  error: null,
  refreshing: false,
  load: async (refresh = false) => {
    const mine = ++generation;
    if (refresh) set({ refreshing: true });
    try {
      const res = await fetchRoutines();
      if (mine === generation) set({ routines: res.routines, error: null });
    } catch (e) {
      if (mine === generation) set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (mine === generation) set({ refreshing: false });
    }
  },
}));

interface RoutinesView {
  routines: Routine[] | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

/** Le rafraichissement de l'onglet : montage, retour de la pile, puis un passage par minute. */
export function useRoutines(): RoutinesView {
  const routines = useRoutinesStore((s) => s.routines);
  const error = useRoutinesStore((s) => s.error);
  const refreshing = useRoutinesStore((s) => s.refreshing);
  const load = useRoutinesStore((s) => s.load);
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );
  const refresh = useCallback(() => load(true), [load]);
  const reload = useCallback(() => load(), [load]);
  return { routines, error, refreshing, refresh, reload };
}

/** Le point de l'onglet Scheduled : une routine active dont le dernier passage a échoué.
 *  Une lecture au montage de l'accueil, pour que le point existe avant la première visite. */
export function useScheduledFailed(): boolean {
  const load = useRoutinesStore((s) => s.load);
  useEffect(() => {
    if (useRoutinesStore.getState().routines === null) void load();
  }, [load]);
  return useRoutinesStore((s) => needsAttention(s.routines));
}
