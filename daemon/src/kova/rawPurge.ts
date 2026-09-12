import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { audit } from '../audit.js';
import { logger } from '../logger.js';
import { discoverKovaSockets, KOVA_EXEC, realDeps, type DiscoverDeps } from './discover.js';

/** Dossier ou Kova ecrit ses captures de pty, `pty-capture-<pid>-<pane>.raw`. */
const KOVA_LOGS_DIR = join(homedir(), 'Library', 'Logs', 'Kova');
const RAW_RE = /^pty-capture-(\d+)-(\d+)\.raw$/;

/**
 * Marge de securite sur la date de modification : un fichier touche il y a moins d'une
 * heure n'est jamais deplace, meme orphelin. Kova ecrit le `.raw` AVANT de poser son
 * socket ; une heure couvre largement ce demarrage et une horloge qui recule.
 */
export const RAW_PURGE_MIN_AGE_MS = 60 * 60_000;

/** Une fois par jour, en plus du demarrage (CA-129). */
export const RAW_PURGE_INTERVAL_MS = 24 * 60 * 60_000;

export interface RawPurgeDeps extends DiscoverDeps {
  logsDir: string;
  trashDir: string;
  readLogs(dir: string): string[];
  statFile(path: string): { size: number; mtimeMs: number } | null;
  moveToTrash(from: string, to: string): void;
  now(): number;
}

export interface RawPurgeResult {
  /** Fichiers deplaces (ou qui l'auraient ete en simulation). */
  purged: { name: string; pid: number; bytes: number }[];
  /** Fichiers gardes parce que leur PID est un Kova vivant. */
  keptLive: number;
  /** Fichiers gardes par la marge d'age. */
  keptRecent: number;
  bytes: number;
}

/**
 * Purge des captures `.raw` orphelines (PRD A15, CA-129, architecture 2.6).
 *
 * Un `.raw` est orphelin quand son PID n'est celui d'AUCUN socket Kova vivant, ET que
 * `ps -p <pid> -o comm=` ne repond pas l'executable de Kova. `kill(pid, 0)` seul est
 * interdit : les PID sont recycles (le 488 de la machine de Robin est `sociallayerd`),
 * et un PID mort dont le numero a ete repris par un autre processus doit etre purge
 * quand meme. A l'inverse, un Kova vivant sans socket (demarrage en cours) est garde.
 *
 * Deplacement vers `~/.Trash`, jamais de suppression : 1,1 Go en jeu, l'erreur doit
 * rester reversible. `dryRun` journalise sans rien deplacer.
 */
export function purgeOrphanRaws(deps: RawPurgeDeps, dryRun = false): RawPurgeResult {
  const result: RawPurgeResult = { purged: [], keptLive: 0, keptRecent: 0, bytes: 0 };
  let names: string[];
  try {
    names = deps.readLogs(deps.logsDir);
  } catch {
    return result;
  }

  const liveSockets = new Set(discoverKovaSockets(deps).map((s) => s.pid));
  /** Verdict par PID, `ps` n'est appele qu'une fois par PID. */
  const alive = new Map<number, boolean>();
  const isKovaAlive = (pid: number): boolean => {
    if (liveSockets.has(pid)) return true;
    let verdict = alive.get(pid);
    if (verdict === undefined) {
      const comm = deps.commOf(pid);
      verdict = comm !== null && comm.trim() === KOVA_EXEC;
      alive.set(pid, verdict);
    }
    return verdict;
  };

  const now = deps.now();
  for (const name of names) {
    const m = RAW_RE.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    if (isKovaAlive(pid)) {
      result.keptLive++;
      continue;
    }
    const from = join(deps.logsDir, name);
    const st = deps.statFile(from);
    if (!st) continue;
    if (now - st.mtimeMs < RAW_PURGE_MIN_AGE_MS) {
      result.keptRecent++;
      continue;
    }
    const entry = { name, pid, bytes: st.size };
    if (!dryRun) {
      try {
        deps.moveToTrash(from, join(deps.trashDir, name));
      } catch (e) {
        logger.warn('purge .raw : deplacement en echec', { name, err: (e as Error).message });
        audit({ action: 'maintenance.purge', path: from, bytes: st.size, result: 'error', detail: (e as Error).message });
        continue;
      }
      audit({ action: 'maintenance.purge', path: from, bytes: st.size, result: 'ok', detail: `pid ${pid} mort` });
    }
    result.purged.push(entry);
    result.bytes += st.size;
  }

  logger.info(dryRun ? 'purge .raw simulee' : 'purge .raw orphelins', {
    dryRun,
    purged: result.purged.length,
    bytes: result.bytes,
    keptLive: result.keptLive,
    keptRecent: result.keptRecent,
    liveKovaPids: [...liveSockets],
    deadPids: [...new Set(result.purged.map((p) => p.pid))],
  });
  return result;
}

export const realRawPurgeDeps: RawPurgeDeps = {
  ...realDeps,
  logsDir: KOVA_LOGS_DIR,
  trashDir: join(homedir(), '.Trash'),
  readLogs: (dir) => readdirSync(dir),
  statFile: (path) => {
    try {
      const st = statSync(path);
      return st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
    } catch {
      return null;
    }
  },
  moveToTrash: (from, to) => {
    const dir = join(to, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Un homonyme deja dans la corbeille n'est jamais ecrase.
    let target = to;
    for (let i = 1; existsSync(target); i++) target = `${to}.${i}`;
    renameSync(from, target);
  },
  now: () => Date.now(),
};
