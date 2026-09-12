import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isLockAlive, readLock, realLockDeps, type LockDeps } from './lock.js';
import { paths } from './paths.js';
import { readRuntimeState } from './state.js';

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
    ...(stale ? ['ATTENTION : etat publie perime, le daemon ne repond peut-etre plus'] : []),
  ].join(', ');
}

export function runStatus(): void {
  process.stdout.write(`${statusLine()}\n`);
}
