import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { paths } from './paths.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 5;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Champs redigés, non negociable (C8). Le jeton n'apparait dans AUCUN log, AUCUNE
 * URL, AUCUN message d'erreur. Le test `redaction.test.ts` rejoue un cycle complet
 * et grep le fichier.
 */
const REDACT_KEYS = new Set([
  'authorization',
  'cookie',
  'token',
  'bearer',
  'ticket',
  'pairingcode',
  'code',
  'secret',
  'master',
  'expopushtoken',
  'password',
]);

/** Motifs qui trahissent un secret meme dans une chaine libre. */
const REDACT_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-~+/=]+/gi,
  /kovalink:\/\/pair#[A-Za-z0-9._\-~+/=]+/gi,
  /ExponentPushToken\[[^\]]*\]/gi,
];

function redactString(s: string): string {
  let out = s;
  for (const re of REDACT_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function rotateIfNeeded(file: string): void {
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return;
  }
  if (size < MAX_BYTES) return;
  try {
    unlinkSync(`${file}.${MAX_FILES}`);
  } catch {
    /* pas de fichier le plus ancien, rien a faire */
  }
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    try {
      renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {
      /* absent */
    }
  }
  try {
    renameSync(file, `${file}.1`);
  } catch {
    /* absent */
  }
}

let ready = false;

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: redactString(msg),
    ...(redact(fields) as Record<string, unknown>),
  });
  const file = paths.logFile();
  try {
    if (!ready) {
      mkdirSync(paths.logsDir(), { recursive: true, mode: 0o700 });
      ready = true;
    }
    rotateIfNeeded(file);
    appendFileSync(file, `${line}\n`, { mode: 0o600 });
  } catch {
    /* le journal ne doit jamais faire tomber le daemon */
  }
  if (process.env['KOVALINK_QUIET'] !== '1') process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log('debug', m, f ?? {}),
  info: (m: string, f?: Record<string, unknown>) => log('info', m, f ?? {}),
  warn: (m: string, f?: Record<string, unknown>) => log('warn', m, f ?? {}),
  error: (m: string, f?: Record<string, unknown>) => log('error', m, f ?? {}),
};
