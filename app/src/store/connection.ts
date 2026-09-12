// État de la liaison. Cinq états distincts (P5), jamais confondus : `Hors ligne` est
// actionnable par Robin, `Mac injoignable` ne l'est pas. Les confondre le laisse chercher
// une solution qui n'existe pas.
import { create } from 'zustand';

export type LinkState = 'connecting' | 'direct' | 'relayed' | 'macUnreachable' | 'offline';
export type KovaStatus = 'up' | 'down' | 'reconnecting' | 'unknown';

interface ConnectionState {
  link: LinkState;
  latencyMs: number | null;
  /** Nom du relais DERP, null quand la liaison est directe (A11). */
  relay: string | null;
  kova: KovaStatus;
  daemonVersion: string | null;
  kovaVersion: string | null;
  /** Horodatage du dernier instantané reçu, sert aux bandeaux dégradés. */
  lastSyncAt: number | null;
  lastError: string | null;
  setLink: (link: LinkState, relay?: string | null) => void;
  setLatency: (ms: number) => void;
  setKova: (kova: KovaStatus, version?: string | null) => void;
  setDaemonVersion: (v: string) => void;
  markSynced: () => void;
  setError: (message: string | null) => void;
}

export const useConnection = create<ConnectionState>((set) => ({
  link: 'connecting',
  latencyMs: null,
  relay: null,
  kova: 'unknown',
  daemonVersion: null,
  kovaVersion: null,
  lastSyncAt: null,
  lastError: null,
  setLink: (link, relay) =>
    set((s) => ({ link, relay: relay === undefined ? s.relay : relay })),
  setLatency: (latencyMs) => set({ latencyMs }),
  setKova: (kova, version) =>
    set((s) => ({ kova, kovaVersion: version === undefined ? s.kovaVersion : version })),
  setDaemonVersion: (daemonVersion) => set({ daemonVersion }),
  markSynced: () => set({ lastSyncAt: Date.now(), lastError: null }),
  setError: (lastError) => set({ lastError }),
}));

/** Vrai dès que l'écriture vers le Mac est impossible : la barre de validation disparaît. */
export function isDegraded(link: LinkState): boolean {
  return link === 'macUnreachable' || link === 'offline';
}

export const LINK_LABEL: Record<LinkState, string> = {
  connecting: 'Connexion…',
  direct: 'Direct',
  relayed: 'Relayé',
  macUnreachable: 'Mac injoignable',
  offline: 'Hors ligne',
};
