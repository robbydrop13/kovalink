import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isLockAlive, readLock, realLockDeps, type LockDeps } from './lock.js';
import { paths } from './paths.js';
import { readRuntimeState, type RuntimeState } from './state.js';
import { tailnetWarning } from './net/tailnet.js';

function certExpiry(): string | null {
  try {
    return new X509Certificate(readFileSync(paths.certFile())).validTo;
  } catch {
    return null;
  }
}

/** Une ligne, lisible d'un coup d'oeil. C'est tout ce que `status` doit faire. */
export function statusLine(now = new Date(), deps: LockDeps = realLockDeps): string {
  const lock = readLock();
  if (!lock || !isLockAlive(lock, deps)) return 'kovalinkd ne tourne pas.';

  const state = readRuntimeState();
  if (!state || state.pid !== lock.pid) {
    return `kovalinkd tourne (pid ${lock.pid}), etat non encore publie.`;
  }

  const stale = now.getTime() - Date.parse(state.updatedAt) > 5 * 60_000;
  const binds = state.binds.length > 0 ? state.binds.join(', ') : 'aucune adresse';
  const kova =
    state.kova.status === 'up'
      ? `kova up (pid ${state.kova.pid ?? '?'})`
      : `kova ${state.kova.status}`;
  const cert = certExpiry() ?? state.certExpiresAt;
  const certPart = cert ? `certificat valide jusqu'au ${cert}` : 'aucun certificat';

  return [
    `kovalinkd tourne (pid ${state.pid}, v${state.version})`,
    `ecoute sur ${binds} port ${state.port}`,
    kova,
    certPart,
    ...(state.sleep ? [sleepPart(state.sleep)] : []),
    ...(stale ? ['ATTENTION : etat publie perime, le daemon ne repond peut-etre plus'] : []),
    ...[tailnetWarning(state.tailnet, now.getTime())].filter((w): w is string => w !== null),
  ].join(', ');
}

/** L'anti-veille en clair : tenue ou non, et pourquoi. */
export function sleepPart(sleep: NonNullable<RuntimeState['sleep']>): string {
  const power = sleep.power === 'ac' ? 'secteur' : sleep.power === 'battery' ? 'batterie' : 'alimentation inconnue';
  const stuck = ', ATTENTION : disablesleep reste a 1, le Mac ne dormira pas capot ferme';
  const lid =
    sleep.lid === 'held'
      ? ', capot ferme compris'
      : sleep.lid === 'unavailable'
        ? ', ATTENTION : capot ferme non tenu, regle sudoers absente'
        : sleep.lid === 'stuck'
          ? stuck
          : '';
  if (!sleep.held) return `Mac libre de dormir (${power})${sleep.lid === 'stuck' || sleep.lid === 'held' ? stuck : ''}`;
  const why = sleep.reason === 'ac' ? 'secteur' : `agent au travail, ${power}`;
  const sys =
    typeof sleep.systemSleepMin === 'number'
      ? `, veille macOS ${sleep.systemSleepMin === 0 ? 'jamais' : `apres ${sleep.systemSleepMin} min`}`
      : '';
  return `Mac tenu eveille (${why}${lid}${sys}) depuis ${sleep.since ?? '?'}`;
}

export function runStatus(): void {
  process.stdout.write(`${statusLine()}\n`);
}
