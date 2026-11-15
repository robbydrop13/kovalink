import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sessionsEmpty } from '@/utils/sessionsEmpty';

describe('écran des sessions sans pane à lister', () => {
  it('13/11 : Mac injoignable, liste vide : « Mac unreachable », jamais « No sessions »', () => {
    assert.equal(sessionsEmpty({ kovaDown: false, loading: false, link: 'macUnreachable', paneCount: 0 }), 'unreachable');
    assert.equal(sessionsEmpty({ kovaDown: false, loading: true, link: 'macUnreachable', paneCount: 0 }), 'unreachable');
    assert.equal(sessionsEmpty({ kovaDown: false, loading: false, link: 'offline', paneCount: 0 }), 'unreachable');
  });
  it('tant que le Mac n a pas répondu, on attend au lieu d annoncer une liste vide', () => {
    assert.equal(sessionsEmpty({ kovaDown: false, loading: false, link: 'connecting', paneCount: 0 }), 'loading');
    assert.equal(sessionsEmpty({ kovaDown: false, loading: true, link: 'direct', paneCount: 0 }), 'loading');
  });
  it('« No sessions » seulement quand le Mac joint répond qu il n y en a pas', () => {
    assert.equal(sessionsEmpty({ kovaDown: false, loading: false, link: 'direct', paneCount: 0 }), 'none');
    assert.equal(sessionsEmpty({ kovaDown: false, loading: false, link: 'relayed', paneCount: 0 }), 'none');
  });
  it('Kova arrêté garde son écran, et une liste en cache reste affichée même injoignable', () => {
    assert.equal(sessionsEmpty({ kovaDown: true, loading: false, link: 'macUnreachable', paneCount: 0 }), 'kovaDown');
    assert.equal(sessionsEmpty({ kovaDown: false, loading: false, link: 'macUnreachable', paneCount: 3 }), null);
  });
});
