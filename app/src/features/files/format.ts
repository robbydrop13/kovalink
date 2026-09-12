// Mise en forme propre à l'écran Fichiers. Aucune de ces fonctions ne décide quoi que ce
// soit : elles habillent des valeurs que le daemon a déjà tranchées.
import type { FsEntry } from '@/protocol';

/**
 * Taille lisible. Base 1000 et unités françaises (`Ko`, `Mo`, `Go`), comme le Finder :
 * afficher `1,0 Kio` pour un fichier que macOS annonce à `1 Ko` ferait douter Robin de
 * ce qu'il regarde.
 */
export function humanSize(bytes: number | null): string {
  if (bytes === null) return '--';
  if (bytes < 1000) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1000;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  const shown = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${shown.replace('.', ',')} ${units[i]}`;
}

/** `~` remplace le dossier personnel. Affichage seulement, jamais une comparaison. */
export function abbreviate(path: string, home: string | null): string {
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Segments cliquables du fil d'Ariane, racine comprise. */
export function breadcrumb(path: string, home: string | null): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  const shown = abbreviate(path, home);
  if (shown.startsWith('~')) {
    out.push({ label: '~', path: home as string });
    const rest = shown.slice(1).split('/').filter(Boolean);
    let acc = home as string;
    for (const segment of rest) {
      acc = `${acc}/${segment}`;
      out.push({ label: segment, path: acc });
    }
    return out;
  }
  out.push({ label: '/', path: '/' });
  let acc = '';
  for (const segment of path.split('/').filter(Boolean)) {
    acc = `${acc}/${segment}`;
    out.push({ label: segment, path: acc });
  }
  return out;
}

/** Troncature au MILIEU : le début et l'extension portent le sens, pas le centre. */
export function truncateMiddle(name: string, max = 30): string {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
}

/** Date courte, telle que le Finder l'affiche : heure aujourd'hui, date au delà. */
export function shortDate(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const days = Math.floor((now - t) / 86_400_000);
  if (days < 7) return `${days} j`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export type PreviewKind = 'image' | 'pdf' | 'text' | 'markdown' | 'none';

/** Ce que l'aperçu sait rendre (PRD C2). Tout le reste montre ses métadonnées. */
export function previewKind(entry: Pick<FsEntry, 'mime' | 'ext' | 'kind'>): PreviewKind {
  if (entry.kind !== 'file') return 'none';
  const mime = entry.mime ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/markdown') return 'markdown';
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/x-ndjson'
  ) {
    return 'text';
  }
  return 'none';
}

/** Glyphe de ligne. Un caractère, pas une bibliothèque d'icônes. */
export function glyphFor(entry: FsEntry): string {
  if (entry.kind === 'dir') return '▸';
  if (entry.kind === 'symlink') return '↳';
  switch (previewKind(entry)) {
    case 'image':
      return '▣';
    case 'pdf':
      return '▤';
    case 'markdown':
    case 'text':
      return '▢';
    default:
      return '▫';
  }
}
