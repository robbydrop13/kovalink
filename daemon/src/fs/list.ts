import { lstatSync, readdirSync, readlinkSync, type Dirent } from 'node:fs';
import { extname, join } from 'node:path';
import {
  FS_PAGE_SIZE,
  type FsEntry,
  type FsEntryKind,
  type FsListResponse,
  type FsSortDir,
  type FsSortKey,
  mimeForName,
} from '@kovalink/protocol';
import type { KovalinkConfig } from '../config.js';
import { FsError, resolveDirForRead } from './resolve.js';

export interface ListOptions {
  path: unknown;
  offset?: number;
  limit?: number;
  sort?: FsSortKey;
  dir?: FsSortDir;
  showHidden?: boolean;
}

function kindOf(d: Dirent): FsEntryKind {
  if (d.isSymbolicLink()) return 'symlink';
  if (d.isDirectory()) return 'dir';
  if (d.isFile()) return 'file';
  return 'other';
}

/**
 * Une entree du listing.
 *
 * `lstat` et non `stat` : un lien symbolique est rendu COMME un lien, avec sa cible
 * affichee. Suivre en silence donnerait une taille et une date qui ne sont pas celles
 * de ce que Robin voit dans le Finder, et masquerait un lien pointant hors du dossier.
 *
 * Une entree illisible ne fait pas echouer le dossier : elle sort avec `readable: false`
 * et se grise dans la liste. Un dossier de 5 000 entrees dont trois sont protegees doit
 * s'afficher, pas rendre 500.
 */
function toEntry(parent: string, d: Dirent): FsEntry {
  const name = d.name;
  const path = join(parent, name);
  const ext = extname(name).toLowerCase();
  const kind = kindOf(d);
  const base: FsEntry = {
    name,
    path,
    kind,
    size: null,
    mtime: null,
    hidden: name.startsWith('.'),
    ext,
    mime: kind === 'dir' ? null : mimeForName(name, ext),
    linkTarget: null,
    readable: true,
  };

  try {
    const st = lstatSync(path);
    base.size = st.isDirectory() ? null : st.size;
    base.mtime = st.mtime.toISOString();
  } catch {
    base.readable = false;
  }

  if (kind === 'symlink') {
    try {
      base.linkTarget = readlinkSync(path);
    } catch {
      base.linkTarget = null;
    }
  }
  return base;
}

function compare(a: FsEntry, b: FsEntry, sort: FsSortKey, dir: FsSortDir): number {
  // Les dossiers d'abord, toujours, quel que soit le tri (design 4.7). Un tri par
  // taille qui melangerait dossiers et fichiers rendrait la navigation illisible.
  const aDir = a.kind === 'dir' ? 0 : 1;
  const bDir = b.kind === 'dir' ? 0 : 1;
  if (aDir !== bDir) return aDir - bDir;

  let n = 0;
  if (sort === 'size') n = (a.size ?? -1) - (b.size ?? -1);
  else if (sort === 'mtime') n = Date.parse(a.mtime ?? '') - Date.parse(b.mtime ?? '');
  if (sort === 'name' || n === 0) {
    n = a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
    return dir === 'asc' ? n : -n;
  }
  if (Number.isNaN(n)) n = 0;
  return dir === 'asc' ? n : -n;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Listing pagine d'un dossier (PRD C1).
 *
 * Aucune recherche recursive : elle est absente du PRD et ferait travailler le daemon
 * sur tout le disque pour un besoin non exprime. Le filtre du dossier courant vit
 * cote app.
 */
export function listDirectory(cfg: KovalinkConfig, o: ListOptions): FsListResponse {
  const target = resolveDirForRead(o.path, cfg);
  const sort: FsSortKey = o.sort === 'size' || o.sort === 'mtime' ? o.sort : 'name';
  const dir: FsSortDir = o.dir === 'desc' ? 'desc' : 'asc';
  const showHidden = o.showHidden === true;
  const offset = clampInt(o.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(o.limit, FS_PAGE_SIZE, 1, FS_PAGE_SIZE);

  let dirents: Dirent[];
  try {
    dirents = readdirSync(target.realPath, { withFileTypes: true });
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw new FsError(
        'READ_DENIED',
        403,
        `macOS refuse la lecture de ${target.path} (${err.code}). Le daemon tourne sous ton utilisateur : ce dossier ne lui est pas accessible.`,
        target.path,
      );
    }
    throw new FsError(
      'IO_ERROR',
      500,
      `lecture de ${target.path} impossible : ${err.code ?? 'erreur inconnue'}`,
      target.path,
    );
  }

  const all = dirents
    .filter((d) => showHidden || !d.name.startsWith('.'))
    .map((d) => toEntry(target.realPath, d))
    .sort((a, b) => compare(a, b, sort, dir));

  const page = all.slice(offset, offset + limit);
  const parent = parentOf(target.realPath);

  return {
    path: target.realPath,
    parent,
    entries: page,
    total: all.length,
    offset,
    limit,
    hasMore: offset + page.length < all.length,
    sort,
    dir,
    showHidden,
  };
}

/** `/` n'a pas de parent. Tout le reste en a un, et il est absolu. */
export function parentOf(path: string): string | null {
  if (path === '/') return null;
  const cut = path.lastIndexOf('/');
  if (cut <= 0) return '/';
  return path.slice(0, cut);
}
