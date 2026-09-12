import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import type { FsQuickDestsResponse, Pane, QuickDest, RecentProject } from '@kovalink/protocol';
import type { KovalinkConfig } from '../config.js';
import { checkWrite } from '../security/denylist.js';

/** Fichier de projets recents de Kova. Surchargeable pour les tests. */
function recentProjectsFile(): string {
  return (
    process.env['KOVALINK_KOVA_RECENTS'] ?? join(homedir(), '.config', 'kova', 'recent_projects.json')
  );
}

interface RawProject {
  path?: unknown;
  last_opened?: unknown;
}

/**
 * Projets recents de Kova.
 *
 * Le fichier est ecrit par Kova, pas par nous : il peut etre absent, tronque pendant
 * une ecriture, ou contenir des chemins de projets supprimes depuis. Chacun de ces cas
 * donne une liste plus courte, jamais une erreur : la liste de destinations est un
 * confort, son echec ne doit pas empecher un envoi.
 *
 * Le fichier de Robin contient des doublons (le meme chemin ouvert plusieurs fois) :
 * on deduplique sur le chemin en gardant le `last_opened` le plus recent.
 */
export function readRecentProjects(limit = 20): { path: string; lastOpenedMs: number }[] {
  let raw: string;
  try {
    raw = readFileSync(recentProjectsFile(), 'utf8');
  } catch {
    return [];
  }

  let parsed: { projects?: RawProject[] };
  try {
    parsed = JSON.parse(raw) as { projects?: RawProject[] };
  } catch {
    // Lecture pendant une ecriture de Kova : on reessaiera au prochain appel.
    return [];
  }
  if (!Array.isArray(parsed.projects)) return [];

  const best = new Map<string, number>();
  for (const p of parsed.projects) {
    if (typeof p.path !== 'string' || p.path.length === 0) continue;
    // `last_opened` est un horodatage UNIX en SECONDES dans le fichier de Kova.
    const seconds = typeof p.last_opened === 'number' ? p.last_opened : 0;
    const ms = seconds * 1000;
    const known = best.get(p.path);
    if (known === undefined || ms > known) best.set(p.path, ms);
  }

  return [...best.entries()]
    .map(([path, lastOpenedMs]) => ({ path, lastOpenedMs }))
    .filter((p) => isDirectory(p.path))
    .sort((a, b) => b.lastOpenedMs - a.lastOpenedMs)
    .slice(0, limit);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `~/dev/link/docs` devient `link / docs` : deux segments suffisent a identifier. */
export function shortLabel(path: string, home: string): string {
  if (path === home) return 'Dossier personnel';
  if (path === '/') return '/';
  const parent = dirname(path);
  const name = basename(path);
  if (parent === '/' || parent === home) return name;
  return `${basename(parent)} ${sep} ${name}`;
}

const SYSTEM_DIRS = [
  { name: 'Desktop', label: 'Bureau' },
  { name: 'Downloads', label: 'Telechargements' },
  { name: 'Documents', label: 'Documents' },
];

/**
 * Destinations proposees, dans l'ordre impose par le design 4.8 et le PRD S7 :
 * le `cwd` du pane focalise en TETE, puis les autres panes ouverts, puis les projets
 * recents de Kova, puis les dossiers systeme.
 *
 * Mettre le pane focalise en tete est litteralement le « directement dans le bon
 * dossier » demande par Robin : l'app qu'il regarde sur son Mac est celle vers
 * laquelle il veut envoyer sa photo.
 *
 * Les trois dernieres destinations utilisees sont memorisees COTE APP : elles dependent
 * de l'appareil, pas du Mac, et le daemon n'a pas a suivre l'historique de l'iPhone.
 */
export function buildQuickDests(panes: Pane[], cfg: KovalinkConfig): FsQuickDestsResponse {
  const home = homedir();
  const seen = new Set<string>();
  const dests: QuickDest[] = [];

  const push = (path: string, kind: QuickDest['kind'], badge: string, lastOpenedMs: number | null): void => {
    if (seen.has(path)) return;
    if (!isDirectory(path)) return;
    seen.add(path);
    dests.push({
      path,
      label: shortLabel(path, home),
      kind,
      badge,
      // La ligne reste VISIBLE mais grisee : « pourquoi ce dossier n'est pas propose »
      // est une question plus couteuse que « pourquoi il est barre ».
      writable: checkWrite(join(path, 'sonde'), cfg).allowed,
      lastOpenedMs,
    });
  };

  const focused = panes.find((p) => p.focused) ?? null;
  if (focused?.cwd) push(focused.cwd, 'pane', 'pane actif', null);

  for (const pane of panes) {
    if (pane.cwd) push(pane.cwd, 'pane', pane.projectName || 'pane', null);
  }

  for (const project of readRecentProjects()) {
    push(project.path, 'project', 'recent', project.lastOpenedMs);
  }

  for (const d of SYSTEM_DIRS) push(join(home, d.name), 'system', 'systeme', null);
  push(home, 'system', 'systeme', null);

  return { dests, focusedCwd: focused?.cwd ?? null, home };
}

/**
 * Projets recents pour l'ecran « Nouvelle session » (PRD A9, Cmd+O de Kova). L'index est
 * la position dans CETTE liste : `new-tab` le relit par `resolveRecentProject` au moment
 * d'agir, jamais un chemin envoye par l'app.
 */
export function listRecentProjects(): RecentProject[] {
  const home = homedir();
  return readRecentProjects().map((p, index) => ({
    index,
    path: p.path,
    label: shortLabel(p.path, home),
    lastOpenedMs: p.lastOpenedMs,
  }));
}

/**
 * Resout un index de projet recent en chemin. `expectedPath` est la confirmation de
 * l'app : si la liste a bouge entre les deux appels (Kova a ouvert un autre projet),
 * l'index designe un autre dossier et on refuse plutot que d'ouvrir le mauvais.
 */
export function resolveRecentProject(index: number, expectedPath: string): string | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const project = readRecentProjects()[index];
  if (!project || project.path !== expectedPath) return null;
  return project.path;
}
