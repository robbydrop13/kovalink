// État de l'écran Fichiers : dossier courant, tri, pagination, cache hors ligne.
//
// Le cache n'est pas un confort décoratif : hors ligne, les dossiers déjà visités restent
// consultables avec une pastille « en cache · il y a 4 min », et les autres disent
// « Indisponible hors ligne ». Toutes les écritures sont alors désactivées, jamais mises
// en file : écrire à l'aveugle sur un disque distant est trop risqué (design 4.7).
import { create } from 'zustand';
import type { FsEntry, FsListResponse, FsSortDir, FsSortKey } from '@/protocol';
import { kvGet, kvSet } from '@/db';
import { listDirectory } from '@/net/files';
import { HttpError } from '@/net/http';

const PREFS_KEY = 'files.prefs';
const CACHE_KEY = 'files.cache';
const RECENT_KEY = 'files.recentDests';

/** Nombre de dossiers gardés en cache. Au delà, les plus anciens sortent. */
const CACHE_MAX = 30;
const RECENT_DESTS_MAX = 3;

export interface CachedDir {
  path: string;
  entries: FsEntry[];
  total: number;
  parent: string | null;
  fetchedAt: number;
}

export interface RecentDest {
  path: string;
  label: string;
  usedAt: number;
}

interface FilesState {
  path: string | null;
  parent: string | null;
  entries: FsEntry[];
  total: number;
  hasMore: boolean;
  sort: FsSortKey;
  dir: FsSortDir;
  showHidden: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** Message d'erreur du daemon, tel quel. Jamais reformulé. */
  error: string | null;
  /** Code d'erreur : il décide de l'écran affiché (cadenas, absent, refus d'écriture). */
  errorCode: string | null;
  /** Non nul quand les entrées viennent du cache et non du Mac. */
  servedFromCacheAt: number | null;
  /** Filtre du dossier COURANT uniquement. Aucune recherche récursive (design 4.7). */
  filter: string;

  hydrate: () => Promise<void>;
  open: (path: string) => Promise<void>;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  setSort: (sort: FsSortKey) => void;
  toggleHidden: () => void;
  setFilter: (filter: string) => void;
}

interface Prefs {
  sort: FsSortKey;
  dir: FsSortDir;
  showHidden: boolean;
  lastPath: string | null;
}

let cache: CachedDir[] = [];

async function persistCache(): Promise<void> {
  await kvSet(CACHE_KEY, cache.slice(-CACHE_MAX));
}

function remember(res: FsListResponse): void {
  if (res.offset !== 0) return;
  cache = [
    ...cache.filter((c) => c.path !== res.path),
    {
      path: res.path,
      entries: res.entries,
      total: res.total,
      parent: res.parent,
      fetchedAt: Date.now(),
    },
  ].slice(-CACHE_MAX);
  void persistCache();
}

export const useFiles = create<FilesState>((set, get) => ({
  path: null,
  parent: null,
  entries: [],
  total: 0,
  hasMore: false,
  sort: 'name',
  dir: 'asc',
  showHidden: false,
  loading: false,
  loadingMore: false,
  error: null,
  errorCode: null,
  servedFromCacheAt: null,
  filter: '',

  hydrate: async () => {
    const [prefs, cached] = await Promise.all([
      kvGet<Prefs>(PREFS_KEY),
      kvGet<CachedDir[]>(CACHE_KEY),
    ]);
    if (Array.isArray(cached)) cache = cached;
    if (prefs) set({ sort: prefs.sort, dir: prefs.dir, showHidden: prefs.showHidden });
  },

  open: async (path) => {
    set({ path, loading: true, error: null, errorCode: null, filter: '', entries: [], total: 0 });
    await load(set, get, path, 0);
  },

  reload: async () => {
    const path = get().path;
    if (!path) return;
    set({ loading: true, error: null, errorCode: null });
    await load(set, get, path, 0);
  },

  loadMore: async () => {
    const { path, hasMore, loadingMore, entries } = get();
    if (!path || !hasMore || loadingMore) return;
    set({ loadingMore: true });
    await load(set, get, path, entries.length);
  },

  setSort: (sort) => {
    const state = get();
    // Deuxième tap sur la même colonne : on inverse le sens, comme partout ailleurs.
    const dir: FsSortDir = state.sort === sort && state.dir === 'asc' ? 'desc' : 'asc';
    set({ sort, dir });
    void kvSet(PREFS_KEY, { sort, dir, showHidden: state.showHidden, lastPath: state.path });
    void get().reload();
  },

  toggleHidden: () => {
    const showHidden = !get().showHidden;
    set({ showHidden });
    void kvSet(PREFS_KEY, {
      sort: get().sort,
      dir: get().dir,
      showHidden,
      lastPath: get().path,
    });
    void get().reload();
  },

  setFilter: (filter) => set({ filter }),
}));

type SetState = (partial: Partial<FilesState>) => void;

async function load(
  set: SetState,
  get: () => FilesState,
  path: string,
  offset: number,
): Promise<void> {
  const { sort, dir, showHidden } = get();
  try {
    const res = await listDirectory(path, { offset, sort, dir, showHidden });
    remember(res);
    set({
      path: res.path,
      parent: res.parent,
      entries: offset === 0 ? res.entries : [...get().entries, ...res.entries],
      total: res.total,
      hasMore: res.hasMore,
      loading: false,
      loadingMore: false,
      error: null,
      errorCode: null,
      servedFromCacheAt: null,
    });
    void kvSet(PREFS_KEY, { sort, dir, showHidden, lastPath: res.path });
  } catch (e) {
    // Hors ligne ou Mac endormi : on sert le cache si on l'a, en le DISANT. Servir du
    // cache en silence ferait croire à Robin qu'il regarde l'état réel de son disque.
    const hit = cache.find((c) => c.path === path);
    const code = e instanceof HttpError ? e.code : 'NETWORK';
    const message = e instanceof Error ? e.message : String(e);
    if (hit && offset === 0) {
      set({
        path: hit.path,
        parent: hit.parent,
        entries: hit.entries,
        total: hit.total,
        hasMore: false,
        loading: false,
        loadingMore: false,
        error: null,
        errorCode: null,
        servedFromCacheAt: hit.fetchedAt,
      });
      return;
    }
    set({
      loading: false,
      loadingMore: false,
      error: message,
      errorCode: code,
      servedFromCacheAt: null,
      ...(offset === 0 ? { entries: [], total: 0 } : {}),
    });
  }
}

/** Filtre du dossier courant. Insensible à la casse et aux accents. */
export function applyFilter(entries: FsEntry[], filter: string): FsEntry[] {
  const needle = normalize(filter);
  if (needle.length === 0) return entries;
  return entries.filter((e) => normalize(e.name).includes(needle));
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// --- Destinations récentes (mémorisées sur l'iPhone, pas sur le Mac) -------------

/**
 * Les 3 dernières destinations utilisées.
 *
 * Elles vivent côté app et non côté daemon : ce sont les habitudes de CET appareil, pas
 * un état du Mac. Le daemon n'a pas à suivre l'historique de l'iPhone.
 */
export async function loadRecentDests(): Promise<RecentDest[]> {
  return (await kvGet<RecentDest[]>(RECENT_KEY)) ?? [];
}

export async function rememberDest(path: string, label: string): Promise<void> {
  const current = await loadRecentDests();
  const next = [
    { path, label, usedAt: Date.now() },
    ...current.filter((d) => d.path !== path),
  ].slice(0, RECENT_DESTS_MAX);
  await kvSet(RECENT_KEY, next);
}

// --- Dossier choisi par le mini navigateur ---------------------------------------

interface PickedDirState {
  path: string | null;
  pick: (path: string) => void;
  consume: () => string | null;
}

/**
 * Canal de retour du mode « choisir un dossier ».
 *
 * Pourquoi un état plutôt que des paramètres de route : `router.back()` ne transporte
 * rien, et un chemin Unix passé dans une URL se fait écorcher par l'encodage. Le chemin
 * est CONSOMMÉ à la lecture, pour qu'un retour ultérieur ne le réapplique pas.
 */
export const usePickedDir = create<PickedDirState>((set, get) => ({
  path: null,
  pick: (path) => set({ path }),
  consume: () => {
    const path = get().path;
    if (path !== null) set({ path: null });
    return path;
  },
}));
