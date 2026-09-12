import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { paths } from './paths.js';

/** Une autre instance vivante detient deja le verrou, ou le port. */
export const EXIT_ALREADY_RUNNING = 4;
/** Aucun ecouteur n'a pu etre ouvert : un daemon sans ecoute ne sert a rien. */
export const EXIT_NO_LISTENER = 5;

export interface LockFile {
  pid: number;
  /** Chemin absolu du script, informatif. La comparaison porte sur `scriptTail`. */
  script: string;
  /**
   * Trois derniers segments du chemin, par exemple `dist/src/main.js`.
   *
   * `ps -o command=` rend la commande TELLE QU'INVOQUEE : absolue si on l'a lancee
   * ainsi, relative si on l'a lancee depuis la racine du projet. Comparer le chemin
   * absolu complet echouait donc systematiquement sur une invocation relative, et un
   * verrou vivant passait pour perime. Un verrou qui echoue en s'ouvrant est le pire
   * mode de defaillance possible : la queue de chemin est commune aux deux formes.
   */
  scriptTail: string;
  startedAt: string;
}

export function lockPath(): string {
  return join(paths.home(), 'kovalinkd.lock');
}

/** `/a/b/dist/src/main.js` et `daemon/dist/src/main.js` partagent `dist/src/main.js`. */
export function scriptTailOf(script: string): string {
  return script.split('/').filter(Boolean).slice(-3).join('/');
}

export interface LockDeps {
  /** Sortie de `ps -p <pid> -o command=`, ou null si le PID ne tourne pas. */
  commandOf(pid: number): string | null;
  selfPid(): number;
  selfScript(): string;
}

export const realLockDeps: LockDeps = {
  commandOf: (pid) => {
    try {
      return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 2000,
      });
    } catch {
      return null;
    }
  },
  selfPid: () => process.pid,
  selfScript: () => process.argv[1] ?? 'kovalinkd',
};

export function readLock(): LockFile | null {
  try {
    const raw = JSON.parse(readFileSync(lockPath(), 'utf8')) as LockFile;
    if (typeof raw.pid !== 'number' || typeof raw.script !== 'string') return null;
    // Verrou ecrit par une version anterieure : on recalcule la queue de chemin.
    if (typeof raw.scriptTail !== 'string') raw.scriptTail = scriptTailOf(raw.script);
    return raw;
  } catch {
    return null;
  }
}

/**
 * Le verrou est-il tenu par un processus REELLEMENT vivant ?
 *
 * Deux conditions cumulatives, aucune ne repose sur `kill(pid, 0)`, qui est un test
 * faux puisque les PID sont recycles (V9, meme regle que pour les sockets Kova) :
 *
 * 1. la ligne de commande du PID porte encore la queue du chemin du script, ce qui
 *    resiste a une invocation relative comme absolue ;
 * 2. le programme execute est bien un `node`, ce qui ecarte un PID recycle par un
 *    autre programme dont la ligne de commande citerait par hasard le meme suffixe.
 */
export function isLockAlive(lock: LockFile, deps: LockDeps = realLockDeps): boolean {
  const command = deps.commandOf(lock.pid);
  if (command === null) return false;
  const tail = lock.scriptTail || scriptTailOf(lock.script);
  if (!command.includes(tail)) return false;
  const program = command.trim().split(/\s+/)[0] ?? '';
  return /(^|\/)node(\d+)?$/.test(program);
}

/**
 * Second signal, INDEPENDANT du fichier de verrou : le port est-il deja pris ?
 *
 * Un `EADDRINUSE` prouve a lui seul qu'une autre instance vit, meme si le fichier de
 * verrou a ete supprime, corrompu, ou ecrit par une version anterieure. Les deux
 * signaux se cumulent, comme `awaitingSince` complete le `promptHash`.
 */
export function portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (e: NodeJS.ErrnoException) => {
      probe.close();
      resolve(e.code === 'EADDRINUSE');
    });
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, host);
  });
}

export type LiveInstance =
  | { kind: 'lock'; lock: LockFile }
  | { kind: 'port'; port: number }
  | null;

/**
 * Detection avant tout effet de bord. N'ECRIT RIEN : le verrou n'est pose qu'une fois
 * l'ecoute reellement etablie, sans quoi une instance qui echoue sur `EADDRINUSE`
 * ecraserait le verrou de celle qui fonctionne.
 */
export async function detectLiveInstance(
  port: number,
  deps: LockDeps = realLockDeps,
): Promise<LiveInstance> {
  const existing = readLock();
  if (existing && existing.pid !== deps.selfPid() && isLockAlive(existing, deps)) {
    return { kind: 'lock', lock: existing };
  }
  if (await portInUse(port)) return { kind: 'port', port };
  return null;
}

export interface InstanceLock {
  release: () => void;
}

/**
 * Pose le verrou. A n'appeler QU'APRES avoir reussi a ouvrir au moins un ecouteur.
 *
 * Un verrou existant n'est ecrase que s'il est franchement perime : meme PID que nous,
 * processus mort, ou PID recycle. Au moindre doute on n'ecrase pas, on echoue.
 */
export function writeInstanceLock(deps: LockDeps = realLockDeps): InstanceLock | { heldBy: LockFile } {
  const existing = readLock();
  if (existing && existing.pid !== deps.selfPid() && isLockAlive(existing, deps)) {
    return { heldBy: existing };
  }

  const script = deps.selfScript();
  const lock: LockFile = {
    pid: deps.selfPid(),
    script,
    scriptTail: scriptTailOf(script),
    startedAt: new Date().toISOString(),
  };
  mkdirSync(paths.home(), { recursive: true, mode: 0o700 });
  writeFileSync(lockPath(), `${JSON.stringify(lock)}\n`, { mode: 0o600 });

  let released = false;
  return {
    release: (): void => {
      if (released) return;
      released = true;
      const current = readLock();
      // On ne supprime que SON propre verrou : sinon un arret tardif effacerait celui
      // d'une instance qui vient de prendre la releve.
      if (current && current.pid === lock.pid) {
        try {
          unlinkSync(lockPath());
        } catch {
          /* deja supprime */
        }
      }
    },
  };
}
