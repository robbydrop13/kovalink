// Repli de detection d'une session Claude quand Kova n'en voit pas.
//
// Kova lit `~/.claude/sessions/<pid>.json` et n'accepte le fichier que si son `startedAt`
// est a moins de 30 s du demarrage du processus. Or Claude Code n'ecrit `startedAt` qu'au
// moment ou la session commence vraiment : apres l'ecran de confiance du dossier, ou
// apres le choix dans `--resume`. Mesure le 13 septembre 2026 sur le pane « Dollary » :
// processus lance a 11:59:38, `startedAt` a 12:21:00, Kova rend `agent: null` et l'app
// affiche une session perimee alors que Claude tourne et repond sur le Mac.
//
// Ici, l'identite ne repose pas sur l'heure : Kova nous donne les processus enfants du
// pane, et un fichier de session dont le `pid` est l'un d'eux decrit forcement CE pane.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface LiveSession {
  id: string;
  /** Nom choisi par `/rename` uniquement, jamais le nom derive du dossier. */
  name: string | null;
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

interface Cached {
  mtimeMs: number;
  session: LiveSession | null;
}
const cache = new Map<number, Cached>();

export function sessionsDir(): string {
  return join(homedir(), '.claude', 'sessions');
}

/** Lecture pure d'un corps de fichier de session. `null` si inutilisable. */
export function parseSessionFile(data: string, expectedPid: number): LiveSession | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (json['pid'] !== expectedPid) return null;
  const id = json['sessionId'];
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
  const derived = json['nameSource'] === 'derived';
  const rawName = typeof json['name'] === 'string' && !derived ? json['name'].trim() : '';
  return { id, name: rawName.length > 0 ? rawName : null };
}

/** La session Claude portee par l'un de ces processus, si un fichier vivant la decrit. */
export function liveSessionOf(childPids: number[], dir = sessionsDir()): LiveSession | null {
  for (const pid of childPids) {
    const path = join(dir, `${pid}.json`);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    const hit = cache.get(pid);
    if (hit && hit.mtimeMs === mtimeMs) {
      if (hit.session) return hit.session;
      continue;
    }
    let session: LiveSession | null = null;
    try {
      session = parseSessionFile(readFileSync(path, 'utf8'), pid);
    } catch {
      session = null;
    }
    cache.set(pid, { mtimeMs, session });
    if (session) return session;
  }
  return null;
}
