import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Couleurs d'onglet Kova.
 *
 * MESURE sur Kova 1.11.0 : ni `list-tabs` ni `list-panes` ne renvoient la couleur.
 * `set-tab-color` est une commande d'ECRITURE SEULE. La valeur existe pourtant, elle
 * est persistee dans `~/.config/kova/session.json` sous
 * `windows[<index>].tabs[<index>].color`, avec le meme codage que la commande :
 * 0 rouge, 1 orange, 2 jaune, 3 vert, 4 bleu, 5 violet.
 *
 * La jointure se fait donc par POSITION, `(window, tab_index)`, seule cle commune aux
 * deux sources : le fichier ne porte aucun identifiant d'onglet.
 *
 * Consequence assumee : le fichier est ecrit periodiquement par Kova, la couleur peut
 * donc accuser un retard de quelques secondes apres un changement. C'est une pastille
 * decorative, pas une donnee de decision.
 */
function sessionFilePath(): string {
  return resolve(
    process.env['KOVALINK_KOVA_CONFIG'] ?? join(homedir(), '.config', 'kova'),
    'session.json',
  );
}

const MAX_COLOR_INDEX = 5;

export type TabColorMap = Map<string, number>;

const key = (window: number, tabIndex: number): string => `${window}/${tabIndex}`;

export function parseTabColors(json: string): TabColorMap {
  const out: TabColorMap = new Map();
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return out;
  }
  const windows = (data as { windows?: unknown[] })?.windows;
  if (!Array.isArray(windows)) return out;
  windows.forEach((w, windowIndex) => {
    const tabs = (w as { tabs?: unknown[] })?.tabs;
    if (!Array.isArray(tabs)) return;
    tabs.forEach((t, tabIndex) => {
      const color = (t as { color?: unknown })?.color;
      if (typeof color !== 'number' || !Number.isInteger(color)) return;
      if (color < 0 || color > MAX_COLOR_INDEX) return;
      out.set(key(windowIndex, tabIndex), color);
    });
  });
  return out;
}

let cache: { mtimeMs: number; colors: TabColorMap } | null = null;

/** Relu seulement quand le fichier a bouge : la liste ne relit rien pour rien. */
export function tabColors(): TabColorMap {
  const path = sessionFilePath();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return new Map();
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.colors;
  try {
    const colors = parseTabColors(readFileSync(path, 'utf8'));
    cache = { mtimeMs, colors };
    return colors;
  } catch {
    return new Map();
  }
}

export function colorOf(window: number, tabIndex: number): number | null {
  return tabColors().get(key(window, tabIndex)) ?? null;
}

/** Vide le cache. Utile aux tests et apres un reveil de veille. */
export function resetTabColors(): void {
  cache = null;
}
