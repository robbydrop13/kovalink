// Le miroir de Mira : fonctions PURES, testées seules (`test/browser.test.ts`).
//
// L'image reçue est en pixels écran (Retina 2x), les clics de Mira se donnent en pixels
// CSS, et l'image est affichée à la largeur du téléphone. Un tap se convertit donc deux
// fois : de l'écran du téléphone vers l'image, puis de l'image vers le viewport CSS.
import { MIRA_SCROLL_MAX } from '@/protocol';

export interface FrameSize {
  cssWidth: number;
  cssHeight: number;
}

/** Taille d'affichage de l'image : toute la largeur disponible, rapport conservé. */
export function fitFrame(frame: { width: number; height: number }, availableWidth: number): { width: number; height: number } {
  if (frame.width <= 0 || frame.height <= 0 || availableWidth <= 0) return { width: 0, height: 0 };
  const width = availableWidth;
  return { width, height: Math.round((frame.height * width) / frame.width) };
}

/**
 * Un point du téléphone, dans le repère de l'image affichée, vers le viewport CSS de
 * Mira. Borné au viewport : un tap sur le bord ne sort jamais de la page.
 */
export function toCssPoint(
  point: { x: number; y: number },
  shown: { width: number; height: number },
  frame: FrameSize,
): { x: number; y: number } {
  if (shown.width <= 0 || shown.height <= 0) return { x: 0, y: 0 };
  const x = (point.x * frame.cssWidth) / shown.width;
  const y = (point.y * frame.cssHeight) / shown.height;
  return {
    x: Math.round(Math.min(Math.max(x, 0), frame.cssWidth)),
    y: Math.round(Math.min(Math.max(y, 0), frame.cssHeight)),
  };
}

/**
 * Un glissement vertical sur le téléphone vers un `scrollBy` en pixels CSS. Le doigt qui
 * monte fait défiler la page vers le bas, comme partout sur iOS. Borné comme le daemon.
 */
export function toCssScroll(dyPhone: number, shown: { height: number }, frame: FrameSize): number {
  if (shown.height <= 0) return 0;
  const dy = Math.round((-dyPhone * frame.cssHeight) / shown.height);
  return Math.max(-MIRA_SCROLL_MAX, Math.min(MIRA_SCROLL_MAX, dy));
}

/** L'hôte d'une URL, pour la liste et l'en-tête. Une URL illisible rend la chaîne telle quelle, coupée. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.host;
    return `${u.protocol}${u.pathname}`.slice(0, 40);
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * Ce que Robin tape dans la feuille URL : `example.com` devient `https://example.com`,
 * un schéma autre que http(s) est refusé ici, avant le daemon qui le refuserait aussi.
 */
export function normalizeUrlInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Âge d'une image en secondes entières, jamais négatif. */
export function frameAgeSeconds(capturedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - capturedAt) / 1000));
}
