import { appendFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIT_RETENTION_DAYS,
  type AuditDiagnostic,
  type AuditDirection,
  type AuditFileEntry,
  type AuditResponse,
} from '@kovalink/protocol';
import { paths } from './paths.js';

export interface AuditEntry {
  deviceId?: string;
  action: string;
  paneId?: number;
  path?: string;
  bytes?: number;
  /** Sens du transfert, pour l'onglet Fichiers de l'ecran Activite (PRD C7). */
  direction?: AuditDirection;
  result: 'ok' | 'denied' | 'error';
  /**
   * Jamais de contenu. Pour une reponse : l'index et la nature de l'option, jamais
   * le libelle. Pour un message libre : la longueur seulement, jamais le texte.
   */
  detail?: string;
}

const RETENTION_DAYS = AUDIT_RETENTION_DAYS;

function todayFile(): string {
  const day = new Date().toISOString().slice(0, 10);
  return join(paths.auditDir(), `${day}.jsonl`);
}

export function audit(entry: AuditEntry): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    mkdirSync(paths.auditDir(), { recursive: true, mode: 0o700 });
    appendFileSync(todayFile(), `${line}\n`, { mode: 0o600 });
  } catch {
    /* jamais bloquant */
  }
}

/** Purge au demarrage, conservation 30 jours (PRD 5.5). */
export function purgeAudit(now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(paths.auditDir());
  } catch {
    return 0;
  }
  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!m) continue;
    const age = now - Date.parse(`${m[1]}T00:00:00Z`);
    if (age > RETENTION_DAYS * 86_400_000) {
      try {
        unlinkSync(join(paths.auditDir(), name));
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

// --- Lecture pour l'ecran Activite (PRD C7) ---------------------------------

interface RawLine {
  ts?: unknown;
  action?: unknown;
  path?: unknown;
  bytes?: unknown;
  direction?: unknown;
  result?: unknown;
  detail?: unknown;
}

/**
 * Actions du bloc C visibles dans l'onglet Fichiers.
 *
 * `fs.upload.chunk` en est ABSENT volontairement : un fichier de 3 Go compte 750
 * morceaux, et 750 lignes pour un seul envoi rendraient le journal illisible. Les
 * morceaux restent dans le JSONL, ils ne remontent simplement pas a l'ecran.
 */
const FILE_ACTIONS = new Set([
  'fs.list',
  'fs.read',
  'fs.text',
  'fs.quickdests',
  'fs.upload.init',
  'fs.upload.complete',
  'fs.upload.abort',
]);

/**
 * Actions qui comptent dans le volume du jour.
 *
 * Un seul point de comptage par transfert : la lecture reelle d'un cote, la publication
 * de l'autre. Compter aussi `init` (qui porte la taille ANNONCEE) et les morceaux
 * doublerait, puis triplerait, le volume affiche.
 */
const VOLUME_ACTIONS = new Set(['fs.read', 'fs.text', 'fs.upload.complete']);

function dayFiles(days: number, now: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    out.push(join(paths.auditDir(), `${d}.jsonl`));
  }
  return out;
}

function parseLines(file: string): RawLine[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: RawLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as RawLine);
    } catch {
      // Ligne tronquee par une rotation : on la saute, on ne vide pas l'ecran pour autant.
    }
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Journal lisible par l'app.
 *
 * Lecture seule et sans aucun contenu de fichier : horodatage, chemin, sens, taille,
 * origine. Le journal sert a repondre a « qu'est-ce qui est sorti de mon Mac », pas a
 * rejouer un transfert.
 */
export function readAudit(o: { limit: number; days: number }, now = Date.now()): AuditResponse {
  const days = Math.min(Math.max(Math.trunc(o.days), 1), AUDIT_RETENTION_DAYS);
  const limit = Math.min(Math.max(Math.trunc(o.limit), 1), 1000);

  const files: AuditFileEntry[] = [];
  const diagnostic: AuditDiagnostic = {
    parseFailed: 0,
    nseFailed: 0,
    lastNotificationAgeMs: null,
    notificationsToday: 0,
    bytesReadToday: 0,
    bytesWrittenToday: 0,
  };
  const today = new Date(now).toISOString().slice(0, 10);
  let lastNotificationMs: number | null = null;

  for (const file of dayFiles(days, now)) {
    for (const line of parseLines(file)) {
      const action = str(line.action);
      const ts = str(line.ts);
      if (!action || !ts) continue;
      const isToday = ts.slice(0, 10) === today;
      const bytes = typeof line.bytes === 'number' ? line.bytes : null;
      const direction =
        line.direction === 'read' || line.direction === 'write' ? line.direction : null;

      if (action === 'prompt.parse' && line.result === 'error') diagnostic.parseFailed += 1;
      if (action === 'prompt.fetch' && line.result !== 'ok') diagnostic.nseFailed += 1;
      if (action === 'push.sent' && line.result === 'ok') {
        const at = Date.parse(ts);
        if (Number.isFinite(at) && (lastNotificationMs === null || at > lastNotificationMs)) {
          lastNotificationMs = at;
        }
        if (isToday) diagnostic.notificationsToday += 1;
      }

      if (isToday && bytes !== null && line.result === 'ok' && VOLUME_ACTIONS.has(action)) {
        if (direction === 'read') diagnostic.bytesReadToday += bytes;
        if (direction === 'write') diagnostic.bytesWrittenToday += bytes;
      }
      if (!FILE_ACTIONS.has(action)) continue;
      files.push({
        ts,
        action,
        path: str(line.path),
        bytes,
        direction,
        result:
          line.result === 'denied' ? 'denied' : line.result === 'error' ? 'error' : 'ok',
        detail: str(line.detail),
      });
    }
  }

  if (lastNotificationMs !== null) diagnostic.lastNotificationAgeMs = now - lastNotificationMs;
  // Le plus recent en tete : c'est ce que Robin vient verifier.
  files.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  return { files: files.slice(0, limit), diagnostic, retentionDays: AUDIT_RETENTION_DAYS };
}
