import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';

export const KOVA_EXEC = '/Applications/Kova.app/Contents/MacOS/kova';
const SOCKET_DIR = '/tmp';
const SOCKET_RE = /^kova-(\d+)\.sock$/;

export interface SocketStat {
  isSocket: boolean;
  uid: number;
  /** Bits de permission, `st.mode & 0o777`. */
  mode: number;
  mtimeMs: number;
}

export interface DiscoverDeps {
  /** Repertoire scanne. Surchargeable pour les tests uniquement. */
  socketDir?: string;
  readDir(dir: string): string[];
  statSocket(path: string): SocketStat | null;
  /** Sortie de `ps -p <pid> -o comm=`, ou null si le PID ne tourne pas. */
  commOf(pid: number): string | null;
  currentUid(): number;
}

export interface KovaSocket {
  pid: number;
  path: string;
  mtimeMs: number;
}

/**
 * Decouverte du socket Kova par glob `/tmp/kova-*.sock`.
 *
 * V9 : les PID sont recycles, `kill(pid, 0)` est un test FAUX (le PID 488 observe sur
 * la machine de Robin est `sociallayerd`, et `kill(488,0)` reussit). On croise donc
 * systematiquement avec `ps -p <pid> -o comm=`, qui doit repondre exactement le
 * chemin de l'executable de Kova.
 *
 * `/tmp` etant accessible en ecriture a tous, on refuse aussi tout socket qui ne nous
 * appartient pas ou dont le mode n'est pas 0600 : sinon n'importe quel compte local
 * pourrait poser un faux socket et intercepter nos commandes.
 */
export function discoverKovaSockets(deps: DiscoverDeps): KovaSocket[] {
  const uid = deps.currentUid();
  const dir = deps.socketDir ?? SOCKET_DIR;
  const found: KovaSocket[] = [];

  let names: string[];
  try {
    names = deps.readDir(dir);
  } catch {
    return [];
  }

  for (const name of names) {
    const m = SOCKET_RE.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;

    const path = `${dir}/${name}`;
    const st = deps.statSocket(path);
    if (!st || !st.isSocket) continue;
    if (st.uid !== uid) continue;
    if ((st.mode & 0o077) !== 0) continue;

    const comm = deps.commOf(pid);
    if (comm === null || comm.trim() !== KOVA_EXEC) continue;

    found.push({ pid, path, mtimeMs: st.mtimeMs });
  }

  // Le plus recemment actif d'abord : c'est l'instance vivante la plus probable.
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export const realDeps: DiscoverDeps = {
  readDir: (dir) => readdirSync(dir),
  statSocket: (path) => {
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (!st) return null;
    return {
      isSocket: st.isSocket(),
      uid: st.uid,
      mode: st.mode & 0o777,
      mtimeMs: st.mtimeMs,
    };
  },
  commOf: (pid) => {
    try {
      return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], {
        encoding: 'utf8',
        timeout: 2000,
      });
    } catch {
      return null;
    }
  },
  currentUid: () => process.getuid?.() ?? -1,
};

export function discoverKovaSocket(deps: DiscoverDeps = realDeps): KovaSocket | null {
  return discoverKovaSockets(deps)[0] ?? null;
}
