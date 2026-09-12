// Instantané des panes. Le serveur pousse, le client REMPLACE, il ne fusionne jamais un
// instantané (docs/03-architecture.md 2.8).
import type { Pane, PaneEvent, Tab } from '@/protocol';
import { kvGet, kvSet } from '@/db';
import { create } from 'zustand';

const SNAPSHOT_KEY = 'panes.snapshot';

export interface PanesSnapshotCache {
  panes: Pane[];
  tabs: Tab[];
  etag: string | null;
  fetchedAt: number;
}

interface PanesState {
  panes: Pane[];
  tabs: Tab[];
  etag: string | null;
  fetchedAt: number | null;
  /** Vrai tant qu'aucun instantané, même en cache, n'a été chargé : squelettes. */
  loading: boolean;
  appActive: boolean;
  focusPaneId: number | null;
  /**
   * Début du travail en cours, par pane, en ms epoch. Kova ne transporte pas cette date :
   * on la pose au front montant de `pane-working`, et à l'arrivée d'un instantané pour un
   * pane déjà en travail dont on ne savait rien. Sert au bandeau `Travaille · 1 min 12 s`.
   */
  workingSince: Record<number, number>;
  hydrate: () => Promise<void>;
  applySnapshot: (s: {
    panes: Pane[];
    tabs: Tab[];
    etag: string;
    appActive?: boolean;
    focusPaneId?: number | null;
  }) => void;
  applyEvent: (ev: PaneEvent) => void;
  reset: () => void;
}

function persist(panes: Pane[], tabs: Tab[], etag: string | null, fetchedAt: number): void {
  void kvSet(SNAPSHOT_KEY, { panes, tabs, etag, fetchedAt } satisfies PanesSnapshotCache);
}

export const usePanes = create<PanesState>((set, get) => ({
  panes: [],
  tabs: [],
  etag: null,
  fetchedAt: null,
  loading: true,
  appActive: false,
  focusPaneId: null,
  workingSince: {},

  hydrate: async () => {
    const cached = await kvGet<PanesSnapshotCache>(SNAPSHOT_KEY);
    if (cached && get().etag === null) {
      set({
        panes: cached.panes,
        tabs: cached.tabs,
        etag: cached.etag,
        fetchedAt: cached.fetchedAt,
        loading: false,
      });
    } else {
      set({ loading: false });
    }
  },

  applySnapshot: (s) => {
    const fetchedAt = Date.now();
    set({
      panes: s.panes,
      tabs: s.tabs,
      etag: s.etag,
      fetchedAt,
      loading: false,
      workingSince: reconcileWorkingSince(get().workingSince, s.panes, fetchedAt),
      ...(s.appActive !== undefined ? { appActive: s.appActive } : {}),
      ...(s.focusPaneId !== undefined ? { focusPaneId: s.focusPaneId } : {}),
    });
    persist(s.panes, s.tabs, s.etag, fetchedAt);
  },

  applyEvent: (ev) => {
    const state = get();
    let panes = state.panes;
    switch (ev.ev) {
      case 'focus':
        set({ appActive: ev.appActive, focusPaneId: ev.pane ? ev.pane.id : null });
        return;
      case 'pane-status':
        panes = panes.map((p) =>
          p.id === ev.paneId
            ? { ...p, awaiting: ev.awaiting, awaiting_since: ev.awaitingSince }
            : p,
        );
        break;
      case 'pane-working': {
        // Front descendant de `pane-working` : c'est le déclencheur de fin de tour (D1).
        panes = panes.map((p) => (p.id === ev.paneId ? { ...p, working: ev.working } : p));
        const { [ev.paneId]: previous, ...rest } = state.workingSince;
        set({
          workingSince: ev.working
            ? { ...rest, [ev.paneId]: previous ?? Date.now() }
            : rest,
        });
        break;
      }
      case 'pane-open':
        panes = [...panes.filter((p) => p.id !== ev.pane.id), ev.pane];
        break;
      case 'pane-close':
        panes = panes.filter((p) => p.id !== ev.paneId);
        break;
      default:
        // Tout événement inconnu est ignoré silencieusement, jamais une erreur bloquante.
        return;
    }
    const fetchedAt = Date.now();
    set({ panes, fetchedAt });
    persist(panes, state.tabs, state.etag, fetchedAt);
  },

  reset: () =>
    set({ panes: [], tabs: [], etag: null, fetchedAt: null, loading: true, workingSince: {} }),
}));

/** Garde les débuts connus des panes encore en travail, en pose un pour les nouveaux. */
function reconcileWorkingSince(
  known: Record<number, number>,
  panes: Pane[],
  now: number,
): Record<number, number> {
  const next: Record<number, number> = {};
  for (const p of panes) {
    if (p.working) next[p.id] = known[p.id] ?? now;
  }
  return next;
}

export function paneById(panes: Pane[], id: number): Pane | undefined {
  return panes.find((p) => p.id === id);
}

export interface PaneSections {
  awaiting: Pane[];
  working: Pane[];
  idle: Pane[];
}

/** Ordre fixe : EN ATTENTE, TRAVAILLE, INACTIF. `awaiting` l'emporte sur `working`. */
export function sectionize(panes: Pane[]): PaneSections {
  const awaiting: Pane[] = [];
  const working: Pane[] = [];
  const idle: Pane[] = [];
  for (const p of panes) {
    if (p.awaiting) awaiting.push(p);
    else if (p.working) working.push(p);
    else idle.push(p);
  }
  const byAge = (a: Pane, b: Pane): number => (b.awaiting_since ?? '').localeCompare(a.awaiting_since ?? '');
  awaiting.sort(byAge);
  return { awaiting, working, idle };
}

export function awaitingCount(panes: Pane[]): number {
  return panes.reduce((n, p) => n + (p.awaiting ? 1 : 0), 0);
}
