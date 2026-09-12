import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.js';
import { mintPairingCode, PAIRING_TTL_MS } from './security/token.js';

export interface PairingFile {
  code: string;
  expiresAt: number;
}

function file(): string {
  return join(paths.home(), 'pairing.json');
}

/**
 * L'appairage se fait en deux processus : `kovalinkd pair` affiche le QR, le daemon
 * lance par launchd sert la route. Un fichier JSON en 0600 suffit a les relier, pas
 * besoin d'un canal de controle.
 */
export function writePairing(): PairingFile {
  const { code, expiresAt } = mintPairingCode();
  mkdirSync(paths.home(), { recursive: true, mode: 0o700 });
  writeFileSync(file(), JSON.stringify({ code, expiresAt }), { mode: 0o600 });
  return { code, expiresAt };
}

export function readPairing(now = Date.now()): PairingFile | null {
  try {
    const p = JSON.parse(readFileSync(file(), 'utf8')) as PairingFile;
    if (typeof p.code !== 'string' || typeof p.expiresAt !== 'number') return null;
    if (p.expiresAt <= now) {
      consumePairing();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/** Usage unique : consomme des la premiere revendication, reussie ou non. */
export function consumePairing(): void {
  try {
    unlinkSync(file());
  } catch {
    /* deja consomme */
  }
}

export { PAIRING_TTL_MS };
