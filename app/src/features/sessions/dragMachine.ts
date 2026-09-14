// La machine d'un glisser-déposer, hors React et hors natif : quatre événements (levé,
// déplacement, lâcher, annulation) et, à chaque pas, ce que l'écran doit montrer (le rang
// visé, l'écart de chaque ligne, la place du squelette) ou rapporter (le lâcher). Le crochet
// `useDragReorder` ne fait que brancher les événements natifs dessus ; la géométrie vient de
// `dragSlots.ts`. Module pur, testé sous Node : la suite d'états d'un geste se rejoue.
import { bounds, displacements, nextSlot, placeholderY, settleOffset, type Slot } from './dragSlots';

export interface DragState {
  /** Toutes les lignes, mesurées dans le conteneur ; celles hors `range` peuvent être vides. */
  slots: Slot[];
  from: number;
  to: number;
  range: [number, number];
  gap: number;
  /** Course de la carte tenue, en pt de translation. */
  bounds: { minDy: number; maxDy: number };
}

export type DragEvent =
  | { type: 'lift'; index: number; slots: (Slot | undefined)[]; range: [number, number]; gap: number }
  /** Déplacement en pt de contenu : doigt plus défilement automatique. */
  | { type: 'move'; dy: number }
  /** Les lignes ont changé de taille en plein geste (repli des onglets). */
  | { type: 'relayout'; slots: Slot[] }
  | { type: 'release' }
  | { type: 'cancel' };

/** Ce que l'écran anime quand le rang visé (ou la géométrie) change. */
export interface DragFrame {
  to: number;
  /** Écart de chaque ligne, dans l'ordre des lignes ; la ligne tenue vaut 0. */
  moves: number[];
  /** Haut du squelette dans le conteneur. */
  placeholderY: number;
}

/** Fin de geste : où la carte se pose, relativement à sa place d'origine, et le rang rapporté. */
export interface DragDrop {
  from: number;
  to: number;
  settle: number;
  cancelled: boolean;
}

export interface DragStep {
  state: DragState | null;
  /** Présent quand quelque chose bouge à l'écran (levé, franchissement, relecture). */
  frame: DragFrame | null;
  /** Présent au lâcher ou à l'annulation. */
  drop: DragDrop | null;
}

const idle: DragStep = { state: null, frame: null, drop: null };

export function frameOf(s: DragState): DragFrame {
  return { to: s.to, moves: displacements(s.slots, s.from, s.to, s.gap), placeholderY: placeholderY(s.slots, s.from, s.to, s.gap) };
}

/** Une ligne de `range` n'est pas mesurée, ou la plage se réduit à un rang : rien à soulever. */
export function liftable(slots: (Slot | undefined)[], index: number, range: [number, number]): boolean {
  if (index < range[0] || index > range[1] || range[0] >= range[1]) return false;
  for (let i = range[0]; i <= range[1]; i += 1) if (!slots[i]) return false;
  return true;
}

export function reduce(state: DragState | null, event: DragEvent): DragStep {
  if (event.type === 'lift') {
    if (state || !liftable(event.slots, event.index, event.range)) return { state, frame: null, drop: null };
    const slots = event.slots.map((s) => s ?? { y: 0, h: 0 });
    const next: DragState = {
      slots,
      from: event.index,
      to: event.index,
      range: event.range,
      gap: event.gap,
      bounds: bounds(slots, event.index, event.range),
    };
    return { state: next, frame: frameOf(next), drop: null };
  }
  if (!state) return idle;
  switch (event.type) {
    case 'move': {
      const to = nextSlot(state.slots, state.from, state.to, event.dy, state.gap, state.range);
      if (to === state.to) return { state, frame: null, drop: null };
      const next = { ...state, to };
      return { state: next, frame: frameOf(next), drop: null };
    }
    case 'relayout': {
      const next = { ...state, slots: event.slots, bounds: bounds(event.slots, state.from, state.range) };
      return { state: next, frame: frameOf(next), drop: null };
    }
    case 'release':
      return { state: null, frame: null, drop: { from: state.from, to: state.to, settle: settleOffset(state.slots, state.from, state.to), cancelled: false } };
    case 'cancel': {
      // Les lignes écartées reviennent : une image au rang d'origine, puis la pose sur place.
      const back = { ...state, to: state.from };
      return { state: null, frame: state.to === state.from ? null : frameOf(back), drop: { from: state.from, to: state.from, settle: 0, cancelled: true } };
    }
  }
}

/**
 * Un CANCELLED dans les 150 ms qui suivent le levé n'est pas un geste de l'utilisateur :
 * c'est le système qui a repris le toucher (défilement, remontage de la ligne). On remet en
 * place sans retour haptique, mais on le DIT dans le journal : cette classe de bug a déjà
 * coûté deux correctifs (le `zIndex` au levé, puis le squelette inséré avant la ligne).
 */
export const STEAL_MS = 150;

export function stolen(drop: DragDrop, elapsedMs: number): boolean {
  return drop.cancelled && elapsedMs < STEAL_MS;
}

/**
 * Un lâcher sur place alors que le doigt a parcouru plus que la hauteur de la ligne tenue :
 * les déplacements n'ont pas atteint la machine (les événements du geste ne remontent pas
 * au JS). Invisible pour l'utilisateur autrement qu'en « rien ne bouge ».
 */
export function deadMove(drop: DragDrop, travel: number, heldHeight: number): boolean {
  return !drop.cancelled && drop.to === drop.from && travel > heldHeight;
}
