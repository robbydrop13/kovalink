// Recollage du défilement automatique : « en bas » se décide sur les métriques du ScrollView.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOTTOM_STICK_PX, distanceFromBottom, isNearBottom } from '@/features/chat/autoScroll';

const metrics = (offsetY: number, contentHeight: number, viewportHeight = 600) => ({
  contentOffset: { y: offsetY },
  contentSize: { height: contentHeight },
  layoutMeasurement: { height: viewportHeight },
});

describe('distanceFromBottom', () => {
  it('mesure ce qui reste sous la fenêtre visible', () => {
    assert.equal(distanceFromBottom(metrics(0, 1000)), 400);
    assert.equal(distanceFromBottom(metrics(400, 1000)), 0);
  });

  it('négative pendant un rebond sous le contenu ou quand le contenu est plus court que la fenêtre', () => {
    assert.equal(distanceFromBottom(metrics(420, 1000)), -20);
    assert.equal(distanceFromBottom(metrics(0, 300)), -300);
  });
});

describe('isNearBottom', () => {
  it('exactement en bas, ou dans la marge : on recolle', () => {
    assert.equal(isNearBottom(metrics(400, 1000)), true);
    assert.equal(isNearBottom(metrics(400 - BOTTOM_STICK_PX, 1000)), true);
  });

  it('un point au delà de la marge : on reste décollé', () => {
    assert.equal(isNearBottom(metrics(400 - BOTTOM_STICK_PX - 1, 1000)), false);
    assert.equal(isNearBottom(metrics(0, 1000)), false);
  });

  it('rebond iOS et contenu court comptent comme « en bas »', () => {
    assert.equal(isNearBottom(metrics(430, 1000)), true);
    assert.equal(isNearBottom(metrics(0, 300)), true);
  });

  it('le seuil est paramétrable', () => {
    assert.equal(isNearBottom(metrics(300, 1000), 100), true);
    assert.equal(isNearBottom(metrics(300, 1000), 99), false);
  });
});
