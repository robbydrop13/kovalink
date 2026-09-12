import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import type { PermissionMode, SessionMeta } from '@kovalink/protocol';
import { transcriptPath } from '../paths.js';
import { aiTitleOf, permissionModeOf, safeParseLine, type RawLine } from './jsonl.js';

const META_TAIL_BYTES = 256 * 1024;

/** Lit les derniers octets d'un JSONL. Jamais le fichier entier (1,4 Mo mesure ici). */
export function readTailLines(path: string, maxBytes = META_TAIL_BYTES): RawLine[] {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return [];
  }
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const buf = Buffer.allocUnsafe(length);
  const fd = openSync(path, 'r');
  try {
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buf, got, length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    let text = buf.subarray(0, got).toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text
      .split('\n')
      .map(safeParseLine)
      .filter((l): l is RawLine => l !== null);
  } finally {
    closeSync(fd);
  }
}

export interface CachedMeta {
  permissionMode: PermissionMode | null;
  title: string | null;
  mtimeMs: number;
}

const metaCache = new Map<string, CachedMeta>();

/** Meta d'une session, mise en cache sur `mtime` : le badge de liste ne relit rien pour rien. */
export function sessionMeta(cwd: string, sessionId: string): CachedMeta {
  const path = transcriptPath(cwd, sessionId);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return { permissionMode: null, title: null, mtimeMs: 0 };
  }
  const hit = metaCache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  const lines = readTailLines(path);
  const meta: CachedMeta = {
    permissionMode: permissionModeOf(lines),
    title: aiTitleOf(lines),
    mtimeMs,
  };
  metaCache.set(path, meta);
  return meta;
}

export function hasTranscript(cwd: string, sessionId: string | null): boolean {
  if (!sessionId) return false;
  return existsSync(transcriptPath(cwd, sessionId));
}

export function buildSessionMeta(
  sessionId: string,
  paneId: number | null,
  cwd: string,
  lines: RawLine[],
  lastSeq: number,
): SessionMeta {
  const modeLine = [...lines].reverse().find((l) => l.type === 'mode');
  const branch = [...lines].reverse().find((l) => typeof l.gitBranch === 'string');
  return {
    sessionId,
    paneId,
    title: aiTitleOf(lines),
    cwd,
    gitBranch: (branch?.gitBranch as string | undefined) ?? null,
    mode: (modeLine?.mode as string | undefined) ?? null,
    permissionMode: permissionModeOf(lines),
    lastSeq,
  };
}
