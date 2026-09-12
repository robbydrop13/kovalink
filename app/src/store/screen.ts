// Dernier écran capturé par pane, pour le repli monospace (lot 1, design 4.6).
//
// Ce n'est pas un flux : c'est l'instantané de `get-pane-content` en mode visible, demandé
// par l'écran de session tant que la vue Term est affichée, et gardé ici pour que revenir
// sur la vue ne reparte pas d'un écran vide.
import type { PaneScreen } from '@/protocol';
import { create } from 'zustand';

interface ScreenState {
  byPane: Record<number, PaneScreen>;
  set: (screen: PaneScreen) => void;
  forget: (paneId: number) => void;
}

export const useScreens = create<ScreenState>((set) => ({
  byPane: {},
  set: (screen) => set((s) => ({ byPane: { ...s.byPane, [screen.paneId]: screen } })),
  forget: (paneId) =>
    set((s) => {
      const { [paneId]: _gone, ...rest } = s.byPane;
      return { byPane: rest };
    }),
}));
