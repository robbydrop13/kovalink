// Défilement automatique du fil (docs/13) : l'écran suit ce qui arrive tant que Robin est
// en bas, décolle quand il remonte, et recolle de lui-même quand il revient en bas.
// Arithmétique pure sur les métriques du `ScrollView`, testée sous Node.

/** Marge, en points, sous laquelle on considère que le fil est « en bas ». */
export const BOTTOM_STICK_PX = 24;

/** Le sous-ensemble de `NativeScrollEvent` dont l'arithmétique a besoin. */
export type ScrollMetrics = {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
};

/**
 * Distance entre le bas de la fenêtre visible et le bas du contenu. Négative pendant un
 * rebond iOS sous le contenu, ou quand le contenu est plus court que la fenêtre.
 */
export function distanceFromBottom(metrics: ScrollMetrics): number {
  return metrics.contentSize.height - (metrics.contentOffset.y + metrics.layoutMeasurement.height);
}

/** Vrai quand le fil est à `threshold` points ou moins du bas : le collage peut reprendre. */
export function isNearBottom(metrics: ScrollMetrics, threshold: number = BOTTOM_STICK_PX): boolean {
  return distanceFromBottom(metrics) <= threshold;
}
