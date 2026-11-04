// Ce que le panneau lateral de Kova a ouvert, servi au telephone : pages, fichiers
// markdown et HTML, fiches de decisions.
//
// Le fichier est celui de Kova (`window/panel_history.rs`) : un tableau d'entrees
// `{kind, target, title, opened_at}`, la plus recente d'abord, 50 au plus. Le daemon le
// LIT seulement, jamais il ne l'ecrit. Il peut etre absent (Kova n'a encore rien ouvert),
// tronque pendant une ecriture, ou edite a la main : chacun de ces cas donne une liste
// plus courte, jamais une erreur.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { PANEL_HISTORY_MAX, type PanelHistoryEntry, type PanelKind } from '@kovalink/protocol';
import { isPanelUrl } from './asks.js';

/** Fichier d'historique du panneau de Kova. Surchargeable pour les tests. */
export function panelHistoryFile(): string {
  return process.env['KOVALINK_KOVA_PANEL_HISTORY'] ?? join(homedir(), '.config', 'kova', 'panel-history.json');
}

const KINDS: readonly PanelKind[] = ['web', 'markdown', 'html', 'sheet'];

/** Un id de question tel que `kova ask` le fabrique (UUID), la regle de Kova. */
const QUESTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Une entree du fichier, traduite (`opened_at` en secondes vers `openedAtMs`). Les memes
 * gardes que Kova a la lecture : seulement ce que le panneau ouvrirait de toute facon.
 */
export function mapPanelEntry(raw: unknown): PanelHistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = r['kind'];
  const target = r['target'];
  if (typeof kind !== 'string' || !KINDS.includes(kind as PanelKind)) return null;
  if (typeof target !== 'string' || target.length === 0) return null;
  const valid =
    kind === 'web'
      ? isPanelUrl(target)
      : kind === 'sheet'
        ? QUESTION_ID.test(target)
        : isAbsolute(target) && !target.includes('\0');
  if (!valid) return null;
  const openedAt = r['opened_at'];
  return {
    kind: kind as PanelKind,
    target,
    title: typeof r['title'] === 'string' ? r['title'].trim() : '',
    openedAtMs: typeof openedAt === 'number' && Number.isFinite(openedAt) && openedAt > 0 ? Math.round(openedAt * 1000) : 0,
  };
}

/** L'historique du panneau, dans l'ordre du fichier (le plus recent d'abord). */
export function readPanelHistory(file = panelHistoryFile()): PanelHistoryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // Absent, ou lu pendant une ecriture de Kova : on relira au prochain appel.
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(mapPanelEntry)
    .filter((e): e is PanelHistoryEntry => e !== null)
    .slice(0, PANEL_HISTORY_MAX);
}
