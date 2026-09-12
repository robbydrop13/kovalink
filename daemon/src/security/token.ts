import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { paths } from '../paths.js';
import { PAIRING_TTL_MS } from '@kovalink/protocol';

const KEYCHAIN_SERVICE = 'io.claap.kovalinkd';
const KEYCHAIN_ACCOUNT = 'master';
const SECURITY_BIN = '/usr/bin/security';

const TOKEN_TTL_DAYS = 90;
/** Renouvellement silencieux a moins de 15 jours de l'expiration. */
export const TOKEN_RENEW_DAYS = 15;

let cached: Buffer | null = null;

/**
 * Secret maitre dans le TROUSSEAU macOS, jamais dans un fichier en clair (C8).
 *
 * Motif aggravant : cinq sessions Claude Code tournent en permanence sous cet uid et
 * peuvent lire n'importe quel fichier lisible par lui. Un fichier de secret serait
 * lisible par le premier agent qui passe.
 */
export function loadMasterSecret(): Buffer {
  if (cached) return cached;
  try {
    const out = execFileSync(
      SECURITY_BIN,
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { encoding: 'utf8' },
    );
    cached = Buffer.from(out.trim(), 'base64');
    if (cached.length >= 32) return cached;
  } catch {
    // Aucune entree : on en cree une.
  }
  const secret = randomBytes(32);
  execFileSync(
    SECURITY_BIN,
    [
      'add-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      KEYCHAIN_ACCOUNT,
      '-w',
      secret.toString('base64'),
      // L'ACL doit designer le programme qui LIT reellement le secret, c'est a dire
      // `/usr/bin/security` que ce module invoque, et non l'executable node appelant.
      // Avec `process.execPath`, macOS redemande l'autorisation a CHAQUE demarrage et
      // attend un clic : un daemon lance par launchd resterait bloque indefiniment.
      '-T',
      '/usr/bin/security',
      '-U',
    ],
    { encoding: 'utf8' },
  );
  cached = secret;
  return secret;
}

export interface DeviceRecord {
  deviceId: string;
  name: string;
  pairedAt: string;
  exp: number;
  revoked: boolean;
  expoPushToken?: string;
  prefs?: { onlyValidations: boolean; quietHours: boolean };
}

export function loadDevices(): Record<string, DeviceRecord> {
  try {
    return JSON.parse(readFileSync(paths.devices(), 'utf8')) as Record<string, DeviceRecord>;
  } catch {
    return {};
  }
}

/** `devices.json` ne contient AUCUN materiel sensible : le jeton est recalculable. */
export function saveDevices(devices: Record<string, DeviceRecord>): void {
  mkdirSync(paths.home(), { recursive: true, mode: 0o700 });
  writeFileSync(paths.devices(), `${JSON.stringify(devices, null, 2)}\n`, { mode: 0o600 });
}

export function signToken(master: Buffer, deviceId: string, exp: number): string {
  return createHmac('sha256', master).update(`v1|${deviceId}|${exp}`).digest('base64url');
}

export function mintToken(master: Buffer, now = Date.now()): {
  deviceId: string;
  exp: number;
  bearer: string;
} {
  const deviceId = randomBytes(9).toString('base64url');
  const exp = Math.floor(now / 1000) + TOKEN_TTL_DAYS * 86_400;
  return { deviceId, exp, bearer: `${deviceId}.${exp}.${signToken(master, deviceId, exp)}` };
}

/** Comparaison a temps constant partout. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // `timingSafeEqual` leve une RangeError si les longueurs different, ce qui
  // transformerait un jeton malforme en 500 et divulguerait la longueur attendue.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type VerifyResult =
  | { ok: true; deviceId: string; exp: number; shouldRenew: boolean }
  | { ok: false; code: 'UNAUTHORIZED' | 'TOKEN_EXPIRED' };

export function verifyBearer(
  bearer: string | undefined,
  master: Buffer,
  devices: Record<string, DeviceRecord>,
  now = Date.now(),
): VerifyResult {
  if (!bearer) return { ok: false, code: 'UNAUTHORIZED' };
  const raw = bearer.startsWith('Bearer ') ? bearer.slice(7) : bearer;
  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, code: 'UNAUTHORIZED' };
  const [deviceId, expStr, presented] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp)) return { ok: false, code: 'UNAUTHORIZED' };
  if (exp * 1000 < now) return { ok: false, code: 'TOKEN_EXPIRED' };
  if (!timingSafeEqualStr(presented, signToken(master, deviceId, exp))) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }
  if (devices[deviceId]?.revoked) return { ok: false, code: 'UNAUTHORIZED' };
  const shouldRenew = exp * 1000 - now < TOKEN_RENEW_DAYS * 86_400_000;
  return { ok: true, deviceId, exp, shouldRenew };
}

/** Code d'appairage : 24 octets, usage unique, TTL `PAIRING_TTL_MS` (5 min, C8). */
export { PAIRING_TTL_MS };

export interface PairingCode {
  code: string;
  expiresAt: number;
}

export function mintPairingCode(now = Date.now()): PairingCode {
  return { code: randomBytes(24).toString('base64url'), expiresAt: now + PAIRING_TTL_MS };
}
