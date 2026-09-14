// Forme d'onde du mode vocal (refonte du 14 septembre, disposition de l'app Claude) :
// l'historique des niveaux du micro devient une rangée de barres fines, le plus récent à
// droite, qui défile vers la gauche au rythme du sondage (10 Hz). Fonctions pures, testées.

/** Nombre de barres de la rangée. */
export const WAVE_BARS = 28;
/** Hauteur minimale d'une barre (ratio de la hauteur pleine) : le silence reste visible. */
export const WAVE_FLOOR = 0.12;
/** Au-dessus de ce ratio, la barre prend l'accent : la voix porte. */
export const WAVE_LOUD = 0.6;

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/** Niveau `expo-audio` (dB négatifs, 0 = plein, `null` inconnu) en ratio 0..1. */
export function levelRatio(db: number | null): number {
  if (db === null) return 0.2;
  return clamp((db + 50) / 50);
}

/** Ajoute un niveau au tampon circulaire, qui ne garde que les `count` derniers. */
export function pushLevel(levels: readonly number[], level: number, count: number): number[] {
  const next = [...levels, clamp(level)];
  return next.length > count ? next.slice(next.length - count) : next;
}

/**
 * Les `count` hauteurs de barres (ratios `WAVE_FLOOR`..1) pour un historique de niveaux,
 * le plus récent en dernier. Un historique plus court est complété à gauche par le plancher ;
 * un plus long ne montre que la fin.
 */
export function levelsToBars(levels: readonly number[], count: number): number[] {
  const bars = new Array<number>(count).fill(WAVE_FLOOR);
  const shown = levels.slice(Math.max(0, levels.length - count));
  const offset = count - shown.length;
  shown.forEach((level, i) => {
    bars[offset + i] = WAVE_FLOOR + clamp(level) * (1 - WAVE_FLOOR);
  });
  return bars;
}
