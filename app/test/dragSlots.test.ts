// Géométrie du glisser-déposer : lignes de hauteurs inégales, espace uniforme de 8 pt.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bounds, displacements, nextSlot, placeholderY, settleOffset, type Slot } from '@/features/sessions/dragSlots';

const GAP = 8;

/** Des lignes empilées avec l'espace de la liste, à partir de `y = 0`. */
function stack(heights: number[]): Slot[] {
  let y = 0;
  return heights.map((h) => {
    const slot = { y, h };
    y += h + GAP;
    return slot;
  });
}

const EQUAL = stack([64, 64, 64, 64]);
const range = (slots: Slot[]): [number, number] => [0, slots.length - 1];

describe('nextSlot', () => {
  it('au repos, rien ne bouge', () => {
    for (let i = 0; i < EQUAL.length; i += 1) assert.equal(nextSlot(EQUAL, i, i, 0, GAP, range(EQUAL)), i);
  });

  it('descend d un rang quand le bas de la carte passe le milieu de la suivante', () => {
    // Suivante : y = 72, milieu à 104 ; bas de la carte tenue = 64 + dy.
    assert.equal(nextSlot(EQUAL, 0, 0, 40, GAP, range(EQUAL)), 0);
    assert.equal(nextSlot(EQUAL, 0, 0, 41, GAP, range(EQUAL)), 1);
    // Deux rangs d un coup : la boucle continue tant qu une ligne est franchie.
    assert.equal(nextSlot(EQUAL, 0, 0, 120, GAP, range(EQUAL)), 2);
  });

  it('remonte d un rang quand le haut de la carte passe le milieu de la précédente', () => {
    // Précédente : y = 72, milieu à 104 ; haut de la carte tenue = 144 + dy.
    assert.equal(nextSlot(EQUAL, 2, 2, -40, GAP, range(EQUAL)), 2);
    assert.equal(nextSlot(EQUAL, 2, 2, -41, GAP, range(EQUAL)), 1);
    assert.equal(nextSlot(EQUAL, 3, 3, -300, GAP, range(EQUAL)), 0);
  });

  it('hystérésis : une ligne franchie ne se refranchit qu au delà de son milieu déplacé', () => {
    // Franchie en descendant à dy = 41 ; en revenant, la ligne 1 est remontée de 72 :
    // son milieu est à 32, le haut de la carte tenue (dy) doit passer sous 32.
    assert.equal(nextSlot(EQUAL, 0, 1, 41, GAP, range(EQUAL)), 1);
    assert.equal(nextSlot(EQUAL, 0, 1, 33, GAP, range(EQUAL)), 1);
    assert.equal(nextSlot(EQUAL, 0, 1, 31, GAP, range(EQUAL)), 0);
    // Même chose en remontant puis redescendant.
    assert.equal(nextSlot(EQUAL, 2, 1, -41, GAP, range(EQUAL)), 1);
    assert.equal(nextSlot(EQUAL, 2, 1, -33, GAP, range(EQUAL)), 1);
    assert.equal(nextSlot(EQUAL, 2, 1, -31, GAP, range(EQUAL)), 2);
  });

  it('une carte haute sous une ligne courte : le milieu de la ligne compte, pas sa hauteur', () => {
    const mixed = stack([64, 220, 64]);
    // Ligne courte 0 vers la carte de 220 : milieu de la carte à 72 + 110 = 182.
    assert.equal(nextSlot(mixed, 0, 0, 118, GAP, range(mixed)), 0);
    assert.equal(nextSlot(mixed, 0, 0, 119, GAP, range(mixed)), 1);
    // La carte haute remonte sur la ligne courte : milieu à 32, haut de la carte = 72 + dy.
    assert.equal(nextSlot(mixed, 1, 1, -40, GAP, range(mixed)), 1);
    assert.equal(nextSlot(mixed, 1, 1, -41, GAP, range(mixed)), 0);
  });

  it('borné en haut et en bas de la liste, et par la plage donnée', () => {
    assert.equal(nextSlot(EQUAL, 0, 0, -500, GAP, range(EQUAL)), 0);
    assert.equal(nextSlot(EQUAL, 3, 3, 500, GAP, range(EQUAL)), 3);
    assert.equal(nextSlot(EQUAL, 0, 0, 500, GAP, range(EQUAL)), 3);
    // Une fenêtre Kova : les onglets 2 et 3 seulement.
    assert.equal(nextSlot(EQUAL, 2, 2, -500, GAP, [2, 3]), 2);
    assert.equal(nextSlot(EQUAL, 2, 2, 500, GAP, [2, 3]), 3);
    assert.equal(nextSlot(EQUAL, 1, 1, 500, GAP, [0, 1]), 1);
  });
});

describe('displacements', () => {
  it('les lignes entre origine et cible s écartent de la hauteur tenue plus l espace', () => {
    assert.deepEqual(displacements(EQUAL, 0, 2, GAP), [0, -72, -72, 0]);
    assert.deepEqual(displacements(EQUAL, 3, 1, GAP), [0, 72, 72, 0]);
    assert.deepEqual(displacements(EQUAL, 1, 1, GAP), [0, 0, 0, 0]);
    const mixed = stack([64, 220, 64]);
    assert.deepEqual(displacements(mixed, 1, 2, GAP), [0, 0, -228]);
  });
});

describe('settleOffset', () => {
  it('se pose au bord de la ligne cible, dans les deux sens', () => {
    assert.equal(settleOffset(EQUAL, 0, 0), 0);
    assert.equal(settleOffset(EQUAL, 0, 2), 144);
    assert.equal(settleOffset(EQUAL, 2, 0), -144);
    const mixed = stack([64, 220, 64]);
    // La ligne courte descend sous la carte haute : bas de la carte (292) moins sa hauteur.
    assert.equal(settleOffset(mixed, 0, 1), 292 - 64);
    // La carte haute remonte en tête.
    assert.equal(settleOffset(mixed, 1, 0), -72);
  });
});

describe('bounds', () => {
  it('du haut de la première ligne de la plage au bas de la dernière', () => {
    assert.deepEqual(bounds(EQUAL, 1, range(EQUAL)), { minDy: -72, maxDy: 144 });
    assert.deepEqual(bounds(EQUAL, 0, range(EQUAL)), { minDy: 0, maxDy: 216 });
    assert.deepEqual(bounds(EQUAL, 2, [2, 3]), { minDy: 0, maxDy: 72 });
    const mixed = stack([64, 220, 64]);
    assert.deepEqual(bounds(mixed, 0, range(mixed)), { minDy: 0, maxDy: 300 + 64 - 64 });
  });
});

describe('placeholderY', () => {
  it('a l origine tant que rien n est franchi', () => {
    assert.equal(placeholderY(EQUAL, 0, 0, GAP), 0);
    assert.equal(placeholderY(EQUAL, 2, 2, GAP), 144);
  });

  it('prend la place libérée par les lignes écartées : la position de pose de la carte', () => {
    // Le squelette est exactement là où la carte se posera (origine plus `settleOffset`).
    for (const slots of [EQUAL, stack([72, 88, 210]), stack([210, 72, 88, 72])]) {
      for (let from = 0; from < slots.length; from += 1) {
        for (let to = 0; to < slots.length; to += 1) {
          assert.equal(placeholderY(slots, from, to, GAP), (slots[from] as Slot).y + settleOffset(slots, from, to));
        }
      }
    }
    // Lignes 72, 88, 210 : la ligne 0 descend sous la 1, remontée de 80 (72 + 8) : la ligne 1
    // occupe 0..88, le squelette commence 8 pt plus bas, à 96.
    const rows = stack([72, 88, 210]);
    assert.equal(placeholderY(rows, 0, 1, GAP), 96);
    // La carte de 210 remonte en tête : la place de la ligne 0.
    assert.equal(placeholderY(rows, 2, 0, GAP), 0);
  });
});
