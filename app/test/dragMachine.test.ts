// La machine du glisser-déposer rejouée avec des suites d'événements natifs : lignes de
// 72, 88 et 210 pt (ligne de session, ligne avec sous-titre, carte EN ATTENTE), espace 8.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liftable, reduce, type DragState, type DragStep } from '@/features/sessions/dragMachine';
import type { Slot } from '@/features/sessions/dragSlots';

const GAP = 8;

function stack(heights: number[]): Slot[] {
  let y = 0;
  return heights.map((h) => {
    const slot = { y, h };
    y += h + GAP;
    return slot;
  });
}

/** Ce que `onLayout` a donné : rangs 0..2, y = 0, 80, 176. */
const ROWS = stack([72, 88, 210]);
const range: [number, number] = [0, 2];

function lift(index: number, slots: (Slot | undefined)[] = ROWS): DragStep {
  return reduce(null, { type: 'lift', index, slots, range, gap: GAP });
}

/** Rejoue des déplacements et rend le dernier état, avec le nombre d'images émises. */
function drag(state: DragState, dys: number[]): { state: DragState; frames: number } {
  let s = state;
  let frames = 0;
  for (const dy of dys) {
    const step = reduce(s, { type: 'move', dy });
    if (step.frame) frames += 1;
    s = step.state as DragState;
  }
  return { state: s, frames };
}

describe('lift', () => {
  it('mesure la course et pose le squelette a l origine', () => {
    const step = lift(1);
    assert.ok(step.state);
    assert.equal(step.state.from, 1);
    assert.equal(step.state.to, 1);
    assert.deepEqual(step.state.bounds, { minDy: -80, maxDy: 176 + 210 - 88 - 80 });
    assert.deepEqual(step.frame, { to: 1, moves: [0, 0, 0], placeholderY: 80 });
    assert.equal(step.drop, null);
  });

  it('refuse une ligne non mesuree dans la plage, ou une plage d un seul rang', () => {
    assert.equal(liftable([ROWS[0], undefined, ROWS[2]], 0, range), false);
    assert.equal(lift(0, [ROWS[0], undefined, ROWS[2]]).state, null);
    assert.equal(liftable(ROWS, 0, [0, 0]), false);
    assert.equal(liftable(ROWS, 2, [0, 1]), false);
    // Une ligne hors plage peut manquer : elle n entre pas dans le geste.
    assert.equal(liftable([undefined, ROWS[1], ROWS[2]], 1, [1, 2]), true);
  });

  it('un second leve pendant un geste est ignore', () => {
    const first = lift(0).state;
    const again = reduce(first, { type: 'lift', index: 2, slots: ROWS, range, gap: GAP });
    assert.equal(again.state, first);
    assert.equal(again.frame, null);
  });
});

describe('move', () => {
  it('sans image tant qu aucune ligne n est franchie, puis une image par franchissement', () => {
    const lifted = lift(0).state as DragState;
    // Ligne 1 : y = 80, milieu 124 ; bas de la carte = 72 + dy.
    assert.equal(drag(lifted, [10, 30, 52]).frames, 0);
    const { state, frames } = drag(lifted, [10, 53]);
    assert.equal(frames, 1);
    assert.equal(state.to, 1);
  });

  it('les autres lignes s ecartent de la hauteur tenue plus l espace, le squelette suit', () => {
    const lifted = lift(0).state as DragState;
    const step = reduce(lifted, { type: 'move', dy: 53 });
    assert.deepEqual(step.frame, { to: 1, moves: [0, -80, 0], placeholderY: 96 });
    // Jusqu en bas : ligne 2 (y = 176, h = 210, milieu 281), bas de la carte 72 + dy > 281.
    const bottom = reduce(step.state, { type: 'move', dy: 210 });
    assert.deepEqual(bottom.frame, { to: 2, moves: [0, -80, -80], placeholderY: 176 + 210 - 72 });
  });

  it('la carte haute remonte en tete, les lignes courtes descendent', () => {
    const lifted = lift(2).state as DragState;
    // Ligne 1 : milieu 124 ; haut de la carte = 176 + dy.
    const one = reduce(lifted, { type: 'move', dy: -53 });
    assert.deepEqual(one.frame, { to: 1, moves: [0, 218, 0], placeholderY: 80 });
    const top = reduce(one.state, { type: 'move', dy: -200 });
    assert.deepEqual(top.frame, { to: 0, moves: [218, 218, 0], placeholderY: 0 });
  });

  it('borne au bout de la plage : la fenetre Kova de l onglet', () => {
    const step = reduce(null, { type: 'lift', index: 1, slots: ROWS, range: [1, 2], gap: GAP });
    const up = reduce(step.state, { type: 'move', dy: -500 });
    assert.equal(up.frame, null);
    assert.equal(up.state?.to, 1);
  });
});

describe('release', () => {
  it('rapporte le rang vise et la pose relative a l origine', () => {
    const lifted = lift(0).state as DragState;
    const moved = drag(lifted, [20, 53, 60]).state;
    const step = reduce(moved, { type: 'release' });
    assert.equal(step.state, null);
    assert.deepEqual(step.drop, { from: 0, to: 1, settle: 96, cancelled: false });
  });

  it('relache sans avoir franchi : `to` vaut `from`, aucune demande a envoyer', () => {
    const lifted = lift(1).state as DragState;
    const step = reduce(drag(lifted, [5, -5, 12]).state, { type: 'release' });
    assert.deepEqual(step.drop, { from: 1, to: 1, settle: 0, cancelled: false });
  });
});

describe('cancel', () => {
  it('remet les lignes en place et pose la carte a l origine', () => {
    const lifted = lift(0).state as DragState;
    const moved = drag(lifted, [53, 210]).state;
    const step = reduce(moved, { type: 'cancel' });
    assert.equal(step.state, null);
    assert.deepEqual(step.frame, { to: 0, moves: [0, 0, 0], placeholderY: 0 });
    assert.deepEqual(step.drop, { from: 0, to: 0, settle: 0, cancelled: true });
  });

  it('la classe du bug : ACTIVE puis CANCELLED avant tout deplacement, rien ne part', () => {
    // Le systeme reprend le toucher juste apres l activation (remontage de la ligne, ou
    // defilement) : aucune image a rejouer, un lacher sur place, `to === from`.
    const lifted = lift(1).state as DragState;
    const step = reduce(lifted, { type: 'cancel' });
    assert.equal(step.frame, null);
    assert.deepEqual(step.drop, { from: 1, to: 1, settle: 0, cancelled: true });
    // Et les evenements suivants, sans geste, ne font rien.
    assert.deepEqual(reduce(null, { type: 'move', dy: 40 }), { state: null, frame: null, drop: null });
    assert.deepEqual(reduce(null, { type: 'release' }), { state: null, frame: null, drop: null });
  });
});

describe('relayout', () => {
  it('les lignes changent de taille en plein geste : course et squelette suivent', () => {
    // Repli des onglets au leve : trois en-tetes de 32 pt a la place des groupes.
    const lifted = lift(2).state as DragState;
    const folded = stack([32, 32, 32]);
    const step = reduce(lifted, { type: 'relayout', slots: folded });
    assert.deepEqual(step.state?.bounds, { minDy: -80, maxDy: 0 });
    assert.deepEqual(step.frame, { to: 2, moves: [0, 0, 0], placeholderY: 80 });
    // Puis le doigt, avec la nouvelle geometrie : ligne 1 (y = 40, milieu 56), haut = 80 + dy.
    const moved = reduce(step.state, { type: 'move', dy: -25 });
    assert.deepEqual(moved.frame, { to: 1, moves: [0, 40, 0], placeholderY: 40 });
  });
});
