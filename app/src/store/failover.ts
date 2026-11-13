// État visible de la bascule entre Macs. Écrit par `features/hosts/failoverWatch.ts`, lu
// par le bandeau d'hôte de l'accueil et par l'interrupteur des Réglages.
import { create } from 'zustand';
import type { HostBanner } from '@/net/failover';

interface FailoverState {
  /** Un seul bandeau d'hôte à la fois (`hostBanner` dans `net/failover.ts`). */
  banner: HostBanner;
  /** Aucun Mac ne répond à `/health` : « hors ligne ou Mac injoignable », pas de bascule. */
  allSilent: boolean;
  /** Interrupteur « Switch on my own if the Mac does not respond ». */
  autoSwitch: boolean;
  setBanner: (banner: HostBanner) => void;
  setAllSilent: (allSilent: boolean) => void;
  setAutoSwitch: (autoSwitch: boolean) => void;
}

export const useFailover = create<FailoverState>((set) => ({
  banner: null,
  allSilent: false,
  autoSwitch: true,
  setBanner: (banner) => set({ banner }),
  setAllSilent: (allSilent) => set({ allSilent }),
  setAutoSwitch: (autoSwitch) => set({ autoSwitch }),
}));
