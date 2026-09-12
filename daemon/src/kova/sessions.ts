// Index des sessions, ouvertes et fermees : ce que les palettes Cmd+P et Cmd+O de Kova
// listent, et que l'app doit lister aussi (PRD 3.4, design 4.11).
//
// Deux sources, fusionnees par `session_id` :
//  - les transcripts Claude Code sur disque (`~/.claude/projects/<slug>/<id>.jsonl`) :
//    c'est la source de verite, `claude --resume` en a besoin. La tete du fichier donne
//    le `cwd` et le premier prompt, la queue l'`ai-title`, le `mtime` la derniere activite ;
//  - `~/.config/kova/claude_history.json`, l'index de Kova, pour son `title` et ses
//    compteurs. Mesure sur la machine : il date (deux jours de retard au 12 septembre),
//    et ses `cwd` pointent parfois vers des dossiers deplaces. Il enrichit, il ne decide pas.
//
// Lecture INCREMENTALE : jamais un transcript entier (1,3 Go au total ici). 64 Ko de tete,
// 64 Ko de queue, et un cache par fichier sur `(mtime, taille)`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { KovaSessionEntry, Pane, Tab } from '@kovalink/protocol';
import { paths } from '../paths.js';
import { aiTitleOf, type RawLine } from '../transcript/jsonl.js';
import { readTailLines } from '../transcript/session.js';

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 64 * 1024;
/** Libelle tronque, comme Kova affiche le premier prompt. */
const TITLE_MAX = 80;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

export interface DiskSession {
  sessionId: string;
  cwd: string;
  /** Premier prompt humain, tronque. Vide si la session n'a aucun message de Robin. */
  firstPrompt: string;
  aiTitle: string | null;
  lastActiveMs: number;
  promptCount: number;
}

const diskCache = new Map<string, { mtimeMs: number; size: number; entry: DiskSession | null }>();

function kovaHistoryFile(): string {
  return process.env['KOVALINK_KOVA_HISTORY'] ?? join(homedir(), '.config', 'kova', 'claude_history.json');
}

/** Texte d'un prompt humain, ou `null` si la ligne n'en est pas un (retour d'outil, systeme). */
function humanPromptOf(line: RawLine): string | null {
  if (line.type !== 'user' || !line.message || line.isSidechain) return null;
  const content = line.message.content;
  let text: string | null = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const parts = content
      .filter((b): b is { type: string; text?: unknown } => !!b && typeof b === 'object')
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string);
    if (parts.length === 0) return null;
    text = parts.join('\n');
  }
  if (text === null) return null;
  const trimmed = text.replace(/\[Image #\d+\]\s*/g, '').trim();
  // Injections de Claude Code (`<command-name>`, `<task-notification>`, `<local-command-stdout>`).
  if (trimmed === '' || trimmed.startsWith('<')) return null;
  return trimmed;
}

/** Tete du fichier, sans le charger : `readTailLines` borne par `end`, ici l'octet 64 Ko. */
function readTranscriptHead(path: string): RawLine[] {
  return readTailLines(path, HEAD_BYTES, HEAD_BYTES);
}

function indexFile(path: string): DiskSession | null {
  const sessionId = basename(path, '.jsonl');
  if (!isSessionId(sessionId)) return null;
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  const hit = diskCache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.entry;

  const head = readTranscriptHead(path);
  let cwd = '';
  let firstPrompt = '';
  let promptCount = 0;
  for (const line of head) {
    if (!cwd && typeof line.cwd === 'string' && line.cwd.length > 0) cwd = line.cwd;
    const prompt = humanPromptOf(line);
    if (prompt !== null) {
      promptCount += 1;
      if (!firstPrompt) firstPrompt = prompt.length > TITLE_MAX ? `${prompt.slice(0, TITLE_MAX - 1)}…` : prompt;
    }
  }
  const tail = st.size <= HEAD_BYTES ? head : readTailLines(path, TAIL_BYTES);
  for (const line of tail) {
    if (!cwd && typeof line.cwd === 'string' && line.cwd.length > 0) cwd = line.cwd;
  }
  const entry: DiskSession | null =
    cwd && firstPrompt
      ? { sessionId, cwd, firstPrompt, aiTitle: aiTitleOf(tail), lastActiveMs: st.mtimeMs, promptCount }
      : null;
  diskCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, entry });
  return entry;
}

/** Tous les transcripts sur disque, un niveau sous `claudeProjects()` : jamais les sous-agents. */
export function scanTranscripts(): DiskSession[] {
  const root = paths.claudeProjects();
  let projects: string[];
  try {
    projects = readdirSync(root);
  } catch {
    return [];
  }
  const out: DiskSession[] = [];
  for (const project of projects) {
    const dir = join(root, project);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const entry = indexFile(join(dir, f));
      if (entry) out.push(entry);
    }
  }
  return out;
}

export interface KovaHistoryEntry {
  id?: unknown;
  cwd?: unknown;
  title?: unknown;
  label?: unknown;
  last_active?: unknown;
  prompts?: unknown;
  resumes?: unknown;
}

let historyCache: { mtimeMs: number; byId: Map<string, KovaHistoryEntry> } | null = null;

/** L'index de Kova, par `session_id`, cache sur `mtime`. Absent ou illisible : vide. */
export function readKovaHistory(): Map<string, KovaHistoryEntry> {
  const file = kovaHistoryFile();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return new Map();
  }
  if (historyCache && historyCache.mtimeMs === mtimeMs) return historyCache.byId;
  const byId = new Map<string, KovaHistoryEntry>();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: unknown };
    const sessions = parsed.sessions;
    const list: KovaHistoryEntry[] = Array.isArray(sessions)
      ? (sessions as KovaHistoryEntry[])
      : sessions && typeof sessions === 'object'
        ? Object.values(sessions as Record<string, KovaHistoryEntry>)
        : [];
    for (const e of list) if (isSessionId(e.id)) byId.set(e.id, e);
  } catch {
    // Ecriture de Kova en cours, ou format inattendu : on reessaiera au prochain appel.
  }
  historyCache = { mtimeMs, byId };
  return byId;
}

function labelOf(disk: DiskSession, kova: KovaHistoryEntry | undefined): string {
  const label = typeof kova?.label === 'string' && kova.label.trim() !== '' ? kova.label.trim() : null;
  if (label) return label;
  if (disk.aiTitle) return disk.aiTitle;
  const title = typeof kova?.title === 'string' && kova.title.trim() !== '' ? kova.title.trim() : null;
  return title ?? disk.firstPrompt;
}

/**
 * La liste fusionnee : ouvertes d'abord, dans l'ordre des onglets du Mac, puis fermees par
 * derniere activite decroissante. Une session ouverte dans un pane n'apparait jamais
 * aussi comme fermee. Pure a partir de ses entrees : c'est ce que le test verifie.
 */
export function mergeSessions(
  disk: DiskSession[],
  kova: Map<string, KovaHistoryEntry>,
  panes: Pane[],
  tabs: Tab[],
): KovaSessionEntry[] {
  const order = new Map<string, number>();
  tabs.forEach((t) => order.set(`${t.window}-${t.tab_index}`, t.tab_index));
  const rank = (p: Pane): number => (order.get(`${p.window}-${p.tab}`) ?? Number.MAX_SAFE_INTEGER) * 10_000 + p.id;
  const openPanes = panes
    .filter((p) => isSessionId(p.agent_session_id ?? p.claude_session_id))
    .sort((a, b) => a.window - b.window || rank(a) - rank(b));

  const byId = new Map(disk.map((d) => [d.sessionId, d] as const));
  const out: KovaSessionEntry[] = [];
  const seen = new Set<string>();
  for (const p of openPanes) {
    const sessionId = (p.agent_session_id ?? p.claude_session_id) as string;
    if (seen.has(sessionId)) continue;
    seen.add(sessionId);
    const d = byId.get(sessionId);
    const k = kova.get(sessionId);
    out.push({
      sessionId,
      cwd: p.cwd,
      projectName: p.projectName,
      title: d ? labelOf(d, k) : (p.agent_session_name ?? p.title ?? p.projectName),
      lastActiveMs: d?.lastActiveMs ?? Date.now(),
      promptCount: d?.promptCount ?? 0,
      state: 'open',
      paneId: p.id,
    });
  }
  const closed = disk
    .filter((d) => !seen.has(d.sessionId))
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs)
    .map((d): KovaSessionEntry => ({
      sessionId: d.sessionId,
      cwd: d.cwd,
      projectName: basename(d.cwd) || d.cwd,
      title: labelOf(d, kova.get(d.sessionId)),
      lastActiveMs: d.lastActiveMs,
      promptCount: d.promptCount,
      state: 'closed',
      paneId: null,
    }));
  return [...out, ...closed];
}

export function listSessions(panes: Pane[], tabs: Tab[]): KovaSessionEntry[] {
  return mergeSessions(scanTranscripts(), readKovaHistory(), panes, tabs);
}

/** Une session de l'index, par identifiant valide. `null` sinon. */
export function findSession(sessionId: unknown, panes: Pane[], tabs: Tab[]): KovaSessionEntry | null {
  if (!isSessionId(sessionId)) return null;
  return listSessions(panes, tabs).find((s) => s.sessionId === sessionId) ?? null;
}
