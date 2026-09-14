// Forme d'onde du mode vocal : niveaux en barres, le plus récent à droite.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WAVE_FLOOR, levelRatio, levelsToBars, pushLevel } from '@/features/chat/waveform';

describe('levelRatio', () => {
  it('mappe -50..0 dB sur 0..1, borné, et un niveau inconnu sur un souffle', () => {
    assert.equal(levelRatio(0), 1);
    assert.equal(levelRatio(-25), 0.5);
    assert.equal(levelRatio(-50), 0);
    assert.equal(levelRatio(-160), 0);
    assert.equal(levelRatio(12), 1);
    assert.equal(levelRatio(null), 0.2);
  });
});

describe('pushLevel', () => {
  it('garde les derniers niveaux seulement, bornes comprises', () => {
    assert.deepEqual(pushLevel([], 0.5, 3), [0.5]);
    assert.deepEqual(pushLevel([0.1, 0.2, 0.3], 0.4, 3), [0.2, 0.3, 0.4]);
    assert.deepEqual(pushLevel([0.1], 7, 3), [0.1, 1]);
    assert.deepEqual(pushLevel([0.1], Number.NaN, 3), [0.1, 0]);
  });
});

describe('levelsToBars', () => {
  it("rend exactement count barres, le plancher à gauche quand l'historique est court", () => {
    const bars = levelsToBars([1], 4);
    assert.equal(bars.length, 4);
    assert.deepEqual(bars.slice(0, 3), [WAVE_FLOOR, WAVE_FLOOR, WAVE_FLOOR]);
    assert.equal(bars[3], 1);
  });
  it("ne montre que la fin d'un historique trop long, le plus récent à droite", () => {
    const bars = levelsToBars([0, 0, 0, 0.5, 1], 2);
    assert.deepEqual(bars, [WAVE_FLOOR + 0.5 * (1 - WAVE_FLOOR), 1]);
  });
  it('un silence reste visible : jamais sous le plancher, jamais au dessus de 1', () => {
    const bars = levelsToBars([0, -3, 9], 3);
    assert.deepEqual(bars, [WAVE_FLOOR, WAVE_FLOOR, 1]);
  });
  it('un historique vide donne une rangée de plancher', () => {
    assert.deepEqual(levelsToBars([], 3), [WAVE_FLOOR, WAVE_FLOOR, WAVE_FLOOR]);
  });
});
