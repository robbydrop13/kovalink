// Géométrie du glisser-déposer : où tombe la carte tenue, et de combien les autres
// s'écartent. Les lignes ne sont pas de hauteur uniforme (ligne de session, carte EN
// ATTENTE, en-tête d'onglet), seul l'espace entre elles l'est. Module pur, testé sous Node.

/** Position et hauteur d'une ligne, mesurées dans le conteneur de la liste. */
export interface Slot {
  y: number;
  h: number;
}

/**
 * Le rang visé après un déplacement `dy` de la ligne `from`, en partant du rang courant.
 * Une ligne est franchie quand le bord avant de la carte tenue dépasse son milieu ; on la
 * refranchit en sens inverse à son milieu déplacé, donc avec un `gap` d'hystérésis. Le
 * rang reste dans `range` (inclusif). À `dy = 0`, rien ne bouge.
 */
export function nextSlot(
  slots: Slot[],
  from: number,
  current: number,
  dy: number,
  gap: number,
  range: [number, number],
): number {
  const held = slots[from];
  if (!held) return current;
  const [lo, hi] = range;
  const H = held.h + gap;
  const top = held.y + dy;
  const bottom = top + held.h;
  let to = Math.max(lo, Math.min(hi, current));
  for (;;) {
    let next = to;
    if (to >= from) {
      const below = slots[to + 1];
      if (to + 1 <= hi && below && bottom > below.y + below.h / 2) next = to + 1;
      else if (to > from) {
        const crossed = slots[to] as Slot;
        if (top < crossed.y - H + crossed.h / 2) next = to - 1;
      }
    }
    if (next === to && to <= from) {
      const above = slots[to - 1];
      if (to - 1 >= lo && above && top < above.y + above.h / 2) next = to - 1;
      else if (to < from) {
        const crossed = slots[to] as Slot;
        if (bottom > crossed.y + H + crossed.h / 2) next = to + 1;
      }
    }
    if (next === to) return to;
    to = next;
  }
}

/** Décalage de chaque ligne quand la ligne `from` vise le rang `to` : la place qu'elle libère. */
export function displacements(slots: Slot[], from: number, to: number, gap: number): number[] {
  const H = (slots[from]?.h ?? 0) + gap;
  return slots.map((_, i) => {
    if (from < i && i <= to) return -H;
    if (to <= i && i < from) return H;
    return 0;
  });
}

/** Où la carte tenue se pose au lâcher, relativement à sa position d'origine. */
export function settleOffset(slots: Slot[], from: number, to: number): number {
  const held = slots[from];
  const target = slots[to];
  if (!held || !target || to === from) return 0;
  return to > from ? target.y + target.h - held.h - held.y : target.y - held.y;
}

/**
 * Où se pose le squelette qui marque la place visée, dans le conteneur de la liste : la
 * place laissée par les lignes écartées. En descendant, la ligne `to` est remontée de
 * `H = h[from] + gap` et le squelette prend la place sous son nouveau bas ; en remontant,
 * elle est descendue de `H` et le squelette prend son ancienne place. À `to = from`, la
 * place d'origine.
 */
export function placeholderY(slots: Slot[], from: number, to: number, gap: number): number {
  const held = slots[from];
  const target = slots[to];
  if (!held || !target || to === from) return held?.y ?? 0;
  const H = held.h + gap;
  return to > from ? target.y + target.h - H + gap : target.y;
}

/** Course autorisée de la carte tenue : du haut de la première ligne au bas de la dernière. */
export function bounds(slots: Slot[], from: number, range: [number, number]): { minDy: number; maxDy: number } {
  const held = slots[from];
  const first = slots[range[0]];
  const last = slots[range[1]];
  if (!held || !first || !last) return { minDy: 0, maxDy: 0 };
  return { minDy: first.y - held.y, maxDy: last.y + last.h - held.h - held.y };
}
