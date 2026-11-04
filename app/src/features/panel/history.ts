// « Recently opened » : ce que le panneau de Kova a ouvert sur le Mac, et ce que le
// panneau du telephone a ouvert, en une seule liste. Pur, teste sous Node.
//
// La cle est la cible (une URL, un chemin absolu, un id de question) : la meme page
// ouverte sur les deux appareils est UNE ligne, a la date la plus recente. Le titre le
// plus recent qui n'est pas vide l'emporte, comme `History::record` de Kova.
import { PANEL_HISTORY_MAX, type PanelHistoryEntry } from '@/protocol';
import { t } from '@/i18n/en';
import { abbreviateHome, baseName, hostOf, type PanelTarget } from './target';

export function mergeHistory(
  mac: readonly PanelHistoryEntry[],
  phone: readonly PanelHistoryEntry[],
  max = PANEL_HISTORY_MAX,
): PanelHistoryEntry[] {
  const byTarget = new Map<string, PanelHistoryEntry>();
  const sorted = [...mac, ...phone].sort((a, b) => b.openedAtMs - a.openedAtMs);
  for (const e of sorted) {
    const known = byTarget.get(e.target);
    if (!known) byTarget.set(e.target, { ...e });
    else if (known.title.length === 0 && e.title.length > 0) known.title = e.title;
  }
  return [...byTarget.values()].slice(0, max);
}

/** `target` ouvert a `now` : en tete, une seule fois, avec son titre (garde si vide). */
export function recordEntry(
  list: readonly PanelHistoryEntry[],
  target: PanelTarget,
  title: string,
  now: number,
  max = PANEL_HISTORY_MAX,
): PanelHistoryEntry[] {
  const old = list.find((e) => e.target === target.target);
  const kept = title.trim() || old?.title || '';
  const rest = list.filter((e) => e.target !== target.target);
  return [{ kind: target.kind, target: target.target, title: kept, openedAtMs: now }, ...rest].slice(0, max);
}

/** La page a dit son nom : l'entree le garde. Meme liste si rien ne change. */
export function retitleEntry(list: PanelHistoryEntry[], target: string, title: string): PanelHistoryEntry[] {
  const clean = title.trim();
  const i = list.findIndex((e) => e.target === target);
  if (i < 0 || clean.length === 0 || list[i]?.title === clean) return list;
  return list.map((e, j) => (j === i ? { ...e, title: clean } : e));
}

/** Le nom d'une entree : son titre, sinon le nom du fichier ou l'hote de la page. */
export function entryName(e: PanelHistoryEntry): string {
  if (e.title.trim().length > 0) return e.title;
  if (e.kind === 'web') return hostOf(e.target);
  if (e.kind === 'sheet') return t.panelSheetEntry;
  return baseName(e.target);
}

/** La seconde ligne : l'hote d'une page, le chemin d'un fichier (`~/`). */
export function entryDetail(e: PanelHistoryEntry, home: string | null): string {
  if (e.kind === 'web') return hostOf(e.target);
  if (e.kind === 'sheet') return t.panelSheetEntry;
  return abbreviateHome(e.target, home);
}
