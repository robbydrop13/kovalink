// Le miroir de Mira : conversion des taps et des glissements vers le viewport CSS, hôte
// et URL saisie, verrou Face ID. Fonctions pures, sans React Native.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MIRA_SCROLL_MAX } from '@/protocol';
import { fitFrame, frameAgeSeconds, hostOf, normalizeUrlInput, toCssPoint, toCssScroll } from '@/features/browser/geometry';
import { UNLOCK_TTL_MS, gate, isUnlocked, lock, markUnlocked } from '@/features/browser/unlockGate';

// Une capture Retina 2x d'un viewport de 1280 x 720, affichée sur 390 pt de large.
const frame = { width: 2560, height: 1440, cssWidth: 1280, cssHeight: 720 };
const shown = fitFrame(frame, 390);

describe('fitFrame', () => {
  it('toute la largeur, rapport conservé', () => {
    assert.deepEqual(shown, { width: 390, height: 219 });
  });
  it('une image sans dimension ne s affiche pas', () => {
    assert.deepEqual(fitFrame({ width: 0, height: 0 }, 390), { width: 0, height: 0 });
  });
});

describe('toCssPoint', () => {
  it('un tap au centre du téléphone est un clic au centre du viewport CSS', () => {
    assert.deepEqual(toCssPoint({ x: 195, y: 109.5 }, shown, frame), { x: 640, y: 360 });
  });
  it('le coin haut gauche et le coin bas droit', () => {
    assert.deepEqual(toCssPoint({ x: 0, y: 0 }, shown, frame), { x: 0, y: 0 });
    assert.deepEqual(toCssPoint({ x: 390, y: 219 }, shown, frame), { x: 1280, y: 720 });
  });
  it('borné au viewport, jamais négatif ni au delà', () => {
    assert.deepEqual(toCssPoint({ x: -20, y: 500 }, shown, frame), { x: 0, y: 720 });
  });
  it('sans image affichée : l origine, sans division par zéro', () => {
    assert.deepEqual(toCssPoint({ x: 10, y: 10 }, { width: 0, height: 0 }, frame), { x: 0, y: 0 });
  });
});

describe('toCssScroll', () => {
  it('le doigt qui monte fait défiler vers le bas, à l échelle du viewport', () => {
    // 219 pt de téléphone couvrent 720 px CSS : -100 pt de doigt font +329 px de page.
    assert.equal(toCssScroll(-100, shown, frame), 329);
    assert.equal(toCssScroll(50, shown, frame), -164);
  });
  it('borné comme le daemon', () => {
    assert.equal(toCssScroll(-5000, shown, frame), MIRA_SCROLL_MAX);
    assert.equal(toCssScroll(5000, shown, frame), -MIRA_SCROLL_MAX);
  });
  it('zéro sans image', () => {
    assert.equal(toCssScroll(-100, { height: 0 }, frame), 0);
  });
});

describe('hostOf', () => {
  it('l hôte, port compris, d une URL http(s)', () => {
    assert.equal(hostOf('https://accounts.google.com/signin?x=1'), 'accounts.google.com');
    assert.equal(hostOf('http://localhost:8000/app'), 'localhost:8000');
  });
  it('un autre schéma ou une chaîne illisible : rendus courts, jamais une exception', () => {
    assert.equal(hostOf('about:blank'), 'about:blank');
    assert.equal(hostOf('not a url'), 'not a url');
    assert.equal(hostOf(''), '');
  });
});

describe('normalizeUrlInput', () => {
  it('ajoute https:// quand le schéma manque', () => {
    assert.equal(normalizeUrlInput('example.com'), 'https://example.com/');
    assert.equal(normalizeUrlInput('  example.com/a?b=c  '), 'https://example.com/a?b=c');
  });
  it('garde http:// et https:// tels quels', () => {
    assert.equal(normalizeUrlInput('http://localhost:3000'), 'http://localhost:3000/');
  });
  it('refuse le vide et tout autre schéma', () => {
    assert.equal(normalizeUrlInput(''), null);
    assert.equal(normalizeUrlInput('   '), null);
    assert.equal(normalizeUrlInput('file:///etc/hosts'), null);
    assert.equal(normalizeUrlInput('javascript:alert(1)'), null);
    assert.equal(normalizeUrlInput('chrome://settings'), null);
  });
});

describe('frameAgeSeconds', () => {
  it('secondes entières, jamais négatif', () => {
    assert.equal(frameAgeSeconds(10_000, 12_900), 2);
    assert.equal(frameAgeSeconds(10_000, 9_000), 0);
  });
});

describe('verrou Face ID', () => {
  it('verrouillé au départ, dix minutes après un déverrouillage, plus après', () => {
    lock();
    assert.equal(isUnlocked(gate.unlockedAt, 1000), false);
    markUnlocked(1000);
    assert.equal(isUnlocked(gate.unlockedAt, 1000 + UNLOCK_TTL_MS - 1), true);
    assert.equal(isUnlocked(gate.unlockedAt, 1000 + UNLOCK_TTL_MS), false);
  });
  it('le passage en arrière-plan verrouille tout de suite', () => {
    markUnlocked(5000);
    lock();
    assert.equal(isUnlocked(gate.unlockedAt, 5001), false);
  });
});
