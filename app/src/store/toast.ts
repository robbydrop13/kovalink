// Un mot à l'écran, deux secondes, depuis n'importe quel composant (« Copied »). L'écran
// de session l'affiche dans son toast existant ; ailleurs, personne ne l'écoute et il
// s'efface seul.
import { create } from 'zustand';

interface ToastState {
  text: string | null;
  seq: number;
  show: (text: string) => void;
  clear: () => void;
}

export const useToast = create<ToastState>((set) => ({
  text: null,
  seq: 0,
  show: (text) => set((s) => ({ text, seq: s.seq + 1 })),
  clear: () => set({ text: null }),
}));
