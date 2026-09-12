// Brouillons du composer, PAR PANE. Robin commence à taper, quitte la session, revient :
// le texte est là. Gardé dans le store pour la navigation, persisté dans le `kv` SQLite
// pour survivre à une fermeture de l'app, effacé à l'envoi réussi. Un brouillon vide
// n'est jamais stocké.
import { create } from 'zustand';
import { kvGet, kvSet } from '@/db';

const DRAFTS_KEY = 'composer.drafts';
/** Une écriture par demi-seconde suffit : on tape plus vite que l'on ne quitte l'app. */
const PERSIST_DELAY_MS = 500;

export interface DraftPersistence {
  load: () => Promise<Record<number, string> | null>;
  save: (drafts: Record<number, string>) => Promise<void>;
}

let persistence: DraftPersistence = {
  load: () => kvGet<Record<number, string>>(DRAFTS_KEY),
  save: (drafts) => kvSet(DRAFTS_KEY, drafts),
};

/** Tests : remplace SQLite par une mémoire. `null` remet le défaut. */
export function setDraftPersistence(next: DraftPersistence | null): void {
  persistence = next ?? {
    load: () => kvGet<Record<number, string>>(DRAFTS_KEY),
    save: (drafts) => kvSet(DRAFTS_KEY, drafts),
  };
}

interface DraftsState {
  byPane: Record<number, string>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: (paneId: number, text: string) => void;
  clear: (paneId: number) => void;
  /** Pour les tests : vide le délai d'écriture en attente. */
  flush: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite: Promise<void> | null = null;

function schedulePersist(get: () => DraftsState): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    pendingWrite = persistence.save(get().byPane).catch(() => undefined);
  }, PERSIST_DELAY_MS);
}

export const useDrafts = create<DraftsState>((set, get) => ({
  byPane: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const stored = (await persistence.load().catch(() => null)) ?? {};
    // Ce qui a été tapé pendant le chargement l'emporte sur ce qui vient du disque.
    set((s) => ({ byPane: { ...stored, ...s.byPane }, hydrated: true }));
  },

  set: (paneId, text) => {
    set((s) => {
      if (text.length === 0) {
        if (!(paneId in s.byPane)) return s;
        const { [paneId]: _gone, ...rest } = s.byPane;
        return { byPane: rest };
      }
      if (s.byPane[paneId] === text) return s;
      return { byPane: { ...s.byPane, [paneId]: text } };
    });
    schedulePersist(get);
  },

  clear: (paneId) => get().set(paneId, ''),

  flush: async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      pendingWrite = persistence.save(get().byPane).catch(() => undefined);
    }
    await pendingWrite;
  },
}));

/** Brouillon d'un pane, chaîne vide s'il n'y en a pas. */
export function draftOf(byPane: Record<number, string>, paneId: number): string {
  return byPane[paneId] ?? '';
}
