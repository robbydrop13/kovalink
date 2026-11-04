// Ce que le panneau ouvre, et comment on le reconnait dans un message. Pur, teste sous
// Node : le rendu vit dans `app/panel.tsx`.
//
// Le panneau est l'equivalent telephone du panneau lateral de Kova : une page web, un
// fichier markdown ou HTML du Mac, une fiche de decisions. Memes quatre genres que Kova
// (`PanelTarget`), pour que les deux historiques se fusionnent sur la meme cle.
import type { PanelKind } from '@/protocol';

export interface PanelTarget {
  kind: PanelKind;
  /** Une URL http(s), un chemin absolu du Mac (ou en `~/`), l'id d'une question. */
  target: string;
}

/** Les parametres de la route `/panel` : `kind=history` ouvre la liste des recents. */
export interface PanelParams {
  kind?: string;
  target?: string;
}

const KINDS: readonly PanelKind[] = ['web', 'markdown', 'html', 'sheet'];

export function isWebUrl(href: string): boolean {
  return /^https?:\/\/\S+$/i.test(href);
}

/** `markdown` pour `.md`, `html` pour `.html` ou `.htm`, sinon `null`. */
export function panelKindOfPath(path: string): 'markdown' | 'html' | null {
  if (/\.md$/i.test(path)) return 'markdown';
  if (/\.html?$/i.test(path)) return 'html';
  return null;
}

/** La cible que portent les parametres de la route, `null` si elle n'en est pas une. */
export function targetOfParams(params: PanelParams): PanelTarget | null {
  const kind = params.kind as PanelKind | undefined;
  const target = params.target ?? '';
  if (!kind || !KINDS.includes(kind) || target.length === 0) return null;
  if (kind === 'web' && !isWebUrl(target)) return null;
  return { kind, target };
}

/** Le chemin d'un fichier du Mac en absolu : `~/` devient le dossier personnel du Mac. */
export function expandHome(path: string, home: string | null): string | null {
  if (path.startsWith('/')) return path;
  if (path === '~' || path.startsWith('~/')) return home ? `${home.replace(/\/$/, '')}${path.slice(1)}` : null;
  return null;
}

/** L'inverse, pour l'affichage : `~/` pour le dossier personnel. */
export function abbreviateHome(path: string, home: string | null): string {
  if (!home) return path;
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** L'hote d'une URL, sans `www.`. La chaine entiere si elle ne se lit pas. */
export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return m?.[1] ? m[1].replace(/^www\./i, '') : url;
}

/** Le nom d'un fichier, dernier segment du chemin. */
export function baseName(path: string): string {
  return path.split('/').filter((s) => s.length > 0).pop() ?? path;
}

/**
 * Un chemin de fichier du panneau dans du texte : absolu ou en `~/`, termine par `.md`,
 * `.html` ou `.htm`. CONSERVATEUR : il doit commencer apres un debut de ligne, une espace
 * ou une ouverture (parenthese, guillemet), sinon `docs/foo.md` ou `a/b.html` dans un mot
 * passeraient pour des chemins. Sans espace : un chemin qui en contient ne se reconnait
 * que dans un code en ligne, ou il est entier (`codePanelPath`).
 */
const PATH_IN_TEXT =
  /(^|[\s([{"'“«])((?:~\/|\/)[^\s"'`<>()[\]{}]*?\.(?:md|html?))(?=$|[\s)\]}"'”».,;:!?])/gi;

/** `/.md` ou `//x.md` ne nomment pas un fichier : une extension seule, une URL sans schema. */
function namesAFile(path: string): boolean {
  return !path.startsWith('//') && !/^\.(?:md|html?)$/i.test(baseName(path));
}

export interface PathMatch {
  start: number;
  end: number;
  path: string;
}

export function findPanelPaths(text: string): PathMatch[] {
  const out: PathMatch[] = [];
  PATH_IN_TEXT.lastIndex = 0;
  for (let m = PATH_IN_TEXT.exec(text); m !== null; m = PATH_IN_TEXT.exec(text)) {
    const path = m[2] ?? '';
    if (!namesAFile(path)) continue;
    const start = m.index + (m[1]?.length ?? 0);
    out.push({ start, end: start + path.length, path });
  }
  return out;
}

/** Un code en ligne qui n'est QUE un chemin du panneau (espaces permises) : ce chemin. */
export function codePanelPath(code: string): string | null {
  const trimmed = code.trim();
  if (!/^(?:~\/|\/)[^\n`<>]*\.(?:md|html?)$/i.test(trimmed)) return null;
  if (!namesAFile(trimmed)) return null;
  return trimmed;
}

/** La cible d'un chemin tape dans un message, `null` si ce n'est pas un fichier du panneau. */
export function pathTarget(path: string): PanelTarget | null {
  const kind = panelKindOfPath(path);
  return kind ? { kind, target: path } : null;
}
