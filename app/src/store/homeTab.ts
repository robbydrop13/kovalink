// Onglet de l'accueil (P02). Pas de persistance : on rouvre l'app sur le Cockpit, le
// premier onglet, l'ecran qui repond a « qu'est ce qui m'attend » (choix de Robin du
// 19/11/2026). Rien d'ecrit sur disque, donc rien a migrer.
import { create } from 'zustand';

export type HomeTab = 'cockpit' | 'panes' | 'asks' | 'agents' | 'scheduled';

/** L'ordre de la barre d'onglets : le Cockpit d'abord. */
export const HOME_TABS: readonly HomeTab[] = ['cockpit', 'panes', 'asks', 'agents', 'scheduled'];

/** L'onglet au lancement. */
export const DEFAULT_HOME_TAB: HomeTab = 'cockpit';

interface HomeTabState {
  tab: HomeTab;
  setTab: (tab: HomeTab) => void;
}

export const useHomeTab = create<HomeTabState>((set) => ({
  tab: DEFAULT_HOME_TAB,
  setTab: (tab) => set({ tab }),
}));
