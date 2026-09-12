// Cinq réglages interactifs et cinq compteurs en lecture seule (design 4.10).
// Tout le reste est en dur : thème sombre (A9), main droite, code 13 pt, terminal 12 pt,
// outils repliés, plage calme 23h-07h non réglable.
import { kvGet, kvSet } from '@/db';
import { create } from 'zustand';

const PREFS_KEY = 'prefs';
const COUNTERS_KEY = 'counters';

export interface Prefs {
  /** OFF par défaut : depuis D1, la notification qui compte est la fin de tour. */
  onlyValidations: boolean;
  /** Heures calmes 23h00 à 07h00, plage non réglable. */
  quietHours: boolean;
  /** Assertion IOKit côté daemon tant qu'un pane travaille, 4 h max (A1, A13). */
  keepMacAwake: boolean;
  /**
   * Ouvrir une session depuis l'iPhone bascule l'onglet sur le Mac (`focus-pane`), comme
   * Cmd+P. À couper quand quelqu'un travaille sur le Mac pendant que Robin lit.
   */
  followOnMac: boolean;
}

const DEFAULT_PREFS: Prefs = {
  onlyValidations: false,
  quietHours: true,
  keepMacAwake: true,
  followOnMac: true,
};

export interface Counters {
  /** Questions illisibles sur 7 jours (état `unparsable`). */
  parseFailed: number;
  /** Bannières non récupérées sur 7 jours (NSE en échec). */
  nseFailed: number;
  notificationsToday: number;
  notificationsDay: string | null;
  lastNotificationAt: number | null;
}

const DEFAULT_COUNTERS: Counters = {
  parseFailed: 0,
  nseFailed: 0,
  notificationsToday: 0,
  notificationsDay: null,
  lastNotificationAt: null,
};

interface PrefsState {
  prefs: Prefs;
  counters: Counters;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  bumpCounter: (key: 'parseFailed' | 'nseFailed') => void;
  noteNotification: () => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  prefs: DEFAULT_PREFS,
  counters: DEFAULT_COUNTERS,
  hydrated: false,

  hydrate: async () => {
    const [p, c] = await Promise.all([kvGet<Prefs>(PREFS_KEY), kvGet<Counters>(COUNTERS_KEY)]);
    set({
      prefs: { ...DEFAULT_PREFS, ...(p ?? {}) },
      counters: { ...DEFAULT_COUNTERS, ...(c ?? {}) },
      hydrated: true,
    });
  },

  setPref: (key, value) => {
    const prefs = { ...get().prefs, [key]: value };
    set({ prefs });
    void kvSet(PREFS_KEY, prefs);
  },

  bumpCounter: (key) => {
    const counters = { ...get().counters, [key]: get().counters[key] + 1 };
    set({ counters });
    void kvSet(COUNTERS_KEY, counters);
  },

  noteNotification: () => {
    const today = new Date().toISOString().slice(0, 10);
    const prev = get().counters;
    const counters: Counters = {
      ...prev,
      notificationsToday: prev.notificationsDay === today ? prev.notificationsToday + 1 : 1,
      notificationsDay: today,
      lastNotificationAt: Date.now(),
    };
    set({ counters });
    void kvSet(COUNTERS_KEY, counters);
  },
}));
