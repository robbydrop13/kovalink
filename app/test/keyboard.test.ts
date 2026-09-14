// Padding bas de l'écran de session face au clavier : la hauteur annoncée par iOS, moins
// l'inset déjà réservé sous le composer, jamais négatif.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keyboardPadding } from '@/utils/keyboard';

describe('keyboardPadding', () => {
  it('retranche une fois l inset bas quand le clavier est ouvert', () => {
    // iPhone à indicateur d'accueil, clavier français avec barre de prédiction.
    assert.equal(keyboardPadding(344, 34), 310);
    // Sans indicateur d'accueil (bouton physique) : tout le clavier.
    assert.equal(keyboardPadding(260, 0), 260);
  });

  it('vaut 0 clavier fermé, quel que soit l inset', () => {
    assert.equal(keyboardPadding(0, 34), 0);
    assert.equal(keyboardPadding(0, 0), 0);
  });

  it('ne descend jamais sous 0 et arrondit au point', () => {
    assert.equal(keyboardPadding(20, 34), 0);
    assert.equal(keyboardPadding(343.6667, 34), 310);
  });
});
