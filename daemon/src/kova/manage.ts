// Gestion d'un pane depuis l'app, les memes actions que sur le Mac : fermer, mettre en
// favori, renommer l'onglet. Trois operations, chacune bornee :
//  - fermer : `close-tab` si le pane est seul dans son onglet, `close-pane` sinon. Le seul
//    geste destructeur de l'app, confirme cote app avec l'etat reel du pane ;
//  - favori : `~/.config/kova/bookmarks.json`, ecriture atomique (fichier temporaire puis
//    renommage), format de Kova preserve (`items: [{agent, session_id, cwd, label}]`) ;
//  - renommer : `set-tab-title`, titre assaini (60 caracteres, aucun caractere de
//    controle), `null` pour revenir au titre automatique.
// Aucune ecriture terminale ici : `KeyGate` reste le seul point d'ecriture de touches.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ActionResponse, KovaBookmark, Pane, Tab } from '@kovalink/protocol';
import { audit } from '../audit.js';
import type { KovaIpc } from './ipc.js';
import { isSessionId } from './ids.js';

export const TAB_TITLE_MAX = 60;

export class ManageError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'PANE_NOT_FOUND' | 'SESSION_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ManageError';
  }
}

/**
 * Titre d'onglet assaini : NFC, sans caractere de controle ni C1, espaces reduits,
 * 60 caracteres au plus. Vide ou `null` : retour au titre automatique de Kova.
 */
export function sanitizeTabTitle(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new ManageError('BAD_REQUEST', 'invalid title');
  const clean = raw
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length === 0) return null;
  return clean.length > TAB_TITLE_MAX ? clean.slice(0, TAB_TITLE_MAX) : clean;
}

/** `close-tab` quand le pane est seul dans son onglet, `close-pane` sinon. */
export function closeCommandFor(pane: Pane, panes: readonly Pane[], tabs: readonly Tab[]): Record<string, unknown> {
  const siblings = panes.filter((p) => p.window === pane.window && p.tab === pane.tab).length;
  const tab = tabs.find((t) => t.window === pane.window && t.tab_index === pane.tab);
  const alone = siblings <= 1 && (tab === undefined || tab.pane_count <= 1);
  if (alone && tab) return { cmd: 'close-tab', tab_id: tab.id };
  return { cmd: 'close-pane', pane_id: pane.id };
}

export interface ManageDeps {
  ipc: Pick<KovaIpc, 'request'>;
  panes: { get(id: number): Pane | undefined; all(): Pane[]; allTabs(): Tab[] };
}

export async function closePane(deps: ManageDeps, paneId: number, deviceId: string): Promise<ActionResponse> {
  const pane = deps.panes.get(paneId);
  if (!pane) {
    audit({ deviceId, action: 'pane.close', paneId, result: 'denied', detail: 'pane_gone' });
    return { applied: false, reason: 'pane_gone' };
  }
  const payload = closeCommandFor(pane, deps.panes.all(), deps.panes.allTabs());
  const res = await deps.ipc.request(payload);
  if (!res.ok) {
    audit({ deviceId, action: 'pane.close', paneId, result: 'error', detail: res.error ?? 'erreur IPC' });
    throw new ManageError('PANE_NOT_FOUND', res.error ?? 'close refused by Kova');
  }
  audit({ deviceId, action: 'pane.close', paneId, result: 'ok', detail: String(payload['cmd']) });
  return { applied: true };
}

export async function renameTab(deps: ManageDeps, paneId: number, rawTitle: unknown, deviceId: string): Promise<{ title: string | null }> {
  const pane = deps.panes.get(paneId);
  if (!pane) throw new ManageError('PANE_NOT_FOUND', 'unknown pane');
  const title = sanitizeTabTitle(rawTitle);
  const res = await deps.ipc.request({ cmd: 'set-tab-title', pane_id: paneId, title });
  if (!res.ok) throw new ManageError('BAD_REQUEST', res.error ?? 'rename refused by Kova');
  // Jamais le titre dans le journal : c'est du texte de Robin.
  audit({ deviceId, action: 'pane.rename', paneId, result: 'ok', detail: title === null ? 'auto' : `len=${title.length}` });
  return { title };
}

// --- Favoris -----------------------------------------------------------------

function bookmarksFile(): string {
  return process.env['KOVALINK_KOVA_BOOKMARKS'] ?? join(homedir(), '.config', 'kova', 'bookmarks.json');
}

interface BookmarksFile {
  items: KovaBookmark[];
  [k: string]: unknown;
}

/** Lit le fichier de Kova tel quel. Absent : liste vide. Illisible : erreur, on n'ecrase pas. */
export function readBookmarks(file = bookmarksFile()): BookmarksFile {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { items: [] };
    throw new ManageError('BAD_REQUEST', `bookmarks unreadable: ${(e as Error).message}`);
  }
  const parsed = JSON.parse(raw) as Partial<BookmarksFile>;
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return { ...parsed, items: items.filter((b) => b && typeof b === 'object') as KovaBookmark[] };
}

/**
 * Ecriture ATOMIQUE : fichier temporaire a cote, puis renommage. Kova ne lit jamais un
 * fichier a moitie ecrit. Le format est celui de Kova, indentation de deux espaces, et
 * les cles inconnues du fichier sont conservees.
 */
export function writeBookmarks(data: BookmarksFile, file = bookmarksFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  let mode = 0o600;
  try {
    mode = statSync(file).mode & 0o777;
  } catch {
    // Nouveau fichier : mode prive, comme celui de Kova (0600 mesure).
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  renameSync(tmp, file);
}

export function isBookmarked(sessionId: string, file = bookmarksFile()): boolean {
  try {
    return readBookmarks(file).items.some((b) => b.session_id === sessionId);
  } catch {
    return false;
  }
}

/** Ensemble des sessions en favori, pour marquer les listes. */
export function bookmarkedIds(file = bookmarksFile()): Set<string> {
  try {
    return new Set(readBookmarks(file).items.map((b) => b.session_id));
  } catch {
    return new Set();
  }
}

/**
 * Ajoute ou retire un favori. `add` prend le `cwd` et un libelle (nom du dossier par
 * defaut, comme Kova) ; l'identifiant est valide par forme. Idempotent.
 */
export function setBookmark(
  op: 'add' | 'remove',
  entry: { sessionId: string; cwd: string; label: string | null },
  deviceId: string,
  file = bookmarksFile(),
): { bookmarked: boolean } {
  if (!isSessionId(entry.sessionId)) throw new ManageError('BAD_REQUEST', 'invalid session id');
  const data = readBookmarks(file);
  const others = data.items.filter((b) => b.session_id !== entry.sessionId);
  if (op === 'remove') {
    if (others.length !== data.items.length) writeBookmarks({ ...data, items: others }, file);
    audit({ deviceId, action: 'kova.bookmark', result: 'ok', detail: 'remove' });
    return { bookmarked: false };
  }
  if (others.length === data.items.length) {
    const label = sanitizeTabTitle(entry.label) ?? basename(entry.cwd) ?? 'claude';
    writeBookmarks(
      { ...data, items: [...data.items, { agent: 'claude', session_id: entry.sessionId, cwd: entry.cwd, label }] },
      file,
    );
  }
  audit({ deviceId, action: 'kova.bookmark', result: 'ok', detail: 'add' });
  return { bookmarked: true };
}
