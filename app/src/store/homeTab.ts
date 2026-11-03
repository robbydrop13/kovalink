// Onglet de l'accueil (P02). Pas de persistance : on rouvre l'app sur Panes, l'ecran qui
// repond a « qu'est ce qui m'attend ». Asks, Agents et Scheduled remplacent le contenu plus
// tard (P05, P06, P07) sans toucher a ce magasin.
import { create } from 'zustand';

export type HomeTab = 'panes' | 'asks' | 'agents' | 'scheduled';

interface HomeTabState {
  tab: HomeTab;
  setTab: (tab: HomeTab) => void;
}

export const useHomeTab = create<HomeTabState>((set) => ({
  tab: 'panes',
  setTab: (tab) => set({ tab }),
}));
