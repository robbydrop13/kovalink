// Refus rencontrés par la vidange de la file, PAR NONCE. La vidange tourne hors de tout
// écran (à la reconnexion, au lancement) : sans ce relais, une bulle « en file » dont le
// travail venait d'être refusé passait pour envoyée, et Robin ne savait rien. L'écran de
// session le consulte quand une bulle quitte la file : refusée, ou partie.
import { create } from 'zustand';

interface OutboxNoticesState {
  refused: Record<string, string>;
  refuse: (nonce: string, cause: string) => void;
  /** Consommé par l'écran une fois affiché sur la bulle. */
  forget: (nonce: string) => void;
}

export const useOutboxNotices = create<OutboxNoticesState>((set) => ({
  refused: {},
  refuse: (nonce, cause) => set((s) => ({ refused: { ...s.refused, [nonce]: cause } })),
  forget: (nonce) =>
    set((s) => {
      if (!(nonce in s.refused)) return s;
      const { [nonce]: _gone, ...rest } = s.refused;
      return { refused: rest };
    }),
}));
