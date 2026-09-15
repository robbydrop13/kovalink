// Le verrou du défilement pendant un glisser-déposer : il revient toujours, au lâcher, à
// l'annulation, au démontage, et une liste ne rend jamais le verrou d'une autre.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reduce, type DragState } from '@/features/sessions/dragMachine';
import { createScrollLock } from '@/features/sessions/scrollLock';

function harness() {
  const applied: boolean[] = [];
  const lock = createScrollLock((locked) => applied.push(locked));
  return { lock, applied };
}

const SLOTS = [
  { y: 0, h: 72 },
  { y: 80, h: 88 },
];

describe('scrollLock', () => {
  it('coupe au premier deplacement et rend a l annulation du geste', () => {
    const { lock, applied } = harness();
    const pane = {};
    // Comme le crochet : lever, premier deplacement (verrou), annulation (rendu).
    const lifted = reduce(null, { type: 'lift', index: 0, slots: SLOTS, range: [0, 1], gap: 8 }).state as DragState;
    const moved = reduce(lifted, { type: 'move', dy: 60 }).state as DragState;
    lock.set(pane, true);
    assert.equal(lock.locked(), true);
    const end = reduce(moved, { type: 'cancel' });
    assert.equal(end.state, null);
    assert.equal(end.drop?.cancelled, true);
    lock.set(pane, false);
    assert.equal(lock.locked(), false);
    assert.deepEqual(applied, [true, false]);
  });

  it('prendre ou rendre deux fois ne change rien', () => {
    const { lock, applied } = harness();
    const pane = {};
    lock.set(pane, true);
    lock.set(pane, true);
    lock.set(pane, false);
    lock.set(pane, false);
    assert.deepEqual(applied, [true, false]);
  });

  it('une liste ne rend pas le verrou d une autre', () => {
    const { lock } = harness();
    const tabs = {};
    const panes = {};
    lock.set(tabs, true);
    lock.set(panes, false);
    assert.equal(lock.locked(), true);
    lock.set(tabs, false);
    assert.equal(lock.locked(), false);
  });

  it('releaseAll rend le defilement meme si une liste a oublie (geste perdu, demontage)', () => {
    const { lock, applied } = harness();
    lock.set({}, true);
    lock.set({}, true);
    lock.releaseAll();
    assert.equal(lock.locked(), false);
    assert.deepEqual(applied, [true, false]);
    // Sans verrou, rien a appliquer.
    lock.releaseAll();
    assert.deepEqual(applied, [true, false]);
  });
});
