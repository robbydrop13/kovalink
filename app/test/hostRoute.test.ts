// Notification d'un autre Mac que l'actif (plan M1, étape 5) : l'ouvrir change de Mac puis
// ouvre le pane, une action rapide n'agit pas et dit d'ouvrir l'app.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PENDING_ROUTE_TTL_MS,
  parsePendingRoute,
  pendingPathFor,
  routeForHost,
  serializePendingRoute,
  showSystemBannerInForeground,
} from '@/notifications/hostRoute';

const mbp = { id: 'mbp.ts.net', name: 'MacBook' };
const m1 = { id: 'm1.ts.net', name: 'M1' };
const hosts = [mbp, m1];

describe('routeForHost', () => {
  it('charge sans host (daemon plus ancien) : comportement inchangé', () => {
    for (const payloadHost of [undefined, null, '', 42]) {
      assert.deepEqual(routeForHost({ payloadHost, activeId: mbp.id, hosts, gesture: 'open' }), { kind: 'here' });
      assert.deepEqual(routeForHost({ payloadHost, activeId: mbp.id, hosts, gesture: 'action' }), { kind: 'here' });
    }
  });

  it('charge du Mac actif : comportement inchangé, ouverture comme action', () => {
    assert.deepEqual(routeForHost({ payloadHost: mbp.id, activeId: mbp.id, hosts, gesture: 'open' }), { kind: 'here' });
    assert.deepEqual(routeForHost({ payloadHost: mbp.id, activeId: mbp.id, hosts, gesture: 'action' }), { kind: 'here' });
  });

  it('ouverture pour un autre Mac connu : changer de Mac', () => {
    assert.deepEqual(routeForHost({ payloadHost: m1.id, activeId: mbp.id, hosts, gesture: 'open' }), {
      kind: 'switch',
      hostId: m1.id,
    });
  });

  it("action rapide pour un autre Mac : ouvrir l'app, avec son nom", () => {
    assert.deepEqual(routeForHost({ payloadHost: m1.id, activeId: mbp.id, hosts, gesture: 'action' }), {
      kind: 'openApp',
      hostName: 'M1',
    });
  });

  it('Mac retiré du registre : ouverture sans pane, action sans nom', () => {
    const gone = 'old.ts.net';
    assert.deepEqual(routeForHost({ payloadHost: gone, activeId: mbp.id, hosts, gesture: 'open' }), { kind: 'openRoot' });
    assert.deepEqual(routeForHost({ payloadHost: gone, activeId: mbp.id, hosts, gesture: 'action' }), {
      kind: 'openApp',
      hostName: null,
    });
  });

  it("pas de Mac actif lisible (trousseau verrouillé) : ouverture inchangée, action qui n'agit pas", () => {
    assert.deepEqual(routeForHost({ payloadHost: m1.id, activeId: null, hosts, gesture: 'open' }), { kind: 'here' });
    assert.deepEqual(routeForHost({ payloadHost: m1.id, activeId: null, hosts, gesture: 'action' }), {
      kind: 'openApp',
      hostName: null,
    });
    // Charge sans host : le chemin d'origine, même verrouillé.
    assert.deepEqual(routeForHost({ payloadHost: undefined, activeId: null, hosts, gesture: 'action' }), { kind: 'here' });
  });
});

describe('showSystemBannerInForeground', () => {
  it("bannière système au premier plan seulement pour un autre Mac", () => {
    assert.equal(showSystemBannerInForeground(m1.id, mbp.id), true);
    assert.equal(showSystemBannerInForeground(mbp.id, mbp.id), false);
    assert.equal(showSystemBannerInForeground(undefined, mbp.id), false);
    assert.equal(showSystemBannerInForeground('', mbp.id), false);
    assert.equal(showSystemBannerInForeground(m1.id, null), false);
  });
});

describe('route en attente', () => {
  const now = 1_000_000;
  const route = { host: m1.id, path: '/session/12', at: now };

  it('aller retour par le trousseau', () => {
    assert.deepEqual(parsePendingRoute(serializePendingRoute(route)), route);
  });

  it('lecture tolérante : illisible donne null', () => {
    for (const raw of [null, undefined, '', 'nope', 'null', '[]', '{"host":"x","path":"/"}', '{"host":1,"path":"/","at":0}']) {
      assert.equal(parsePendingRoute(raw), null, String(raw));
    }
  });

  it('ouverte sur le Mac visé, récente', () => {
    assert.equal(pendingPathFor(route, m1.id, now + 1500), '/session/12');
    assert.equal(pendingPathFor(route, m1.id, now + PENDING_ROUTE_TTL_MS), '/session/12');
  });

  it('jamais sur un autre Mac : le changement a échoué ou une bascule a croisé', () => {
    assert.equal(pendingPathFor(route, mbp.id, now + 1500), null);
    assert.equal(pendingPathFor(route, null, now + 1500), null);
  });

  it('trop vieille ou datée du futur : oubliée', () => {
    assert.equal(pendingPathFor(route, m1.id, now + PENDING_ROUTE_TTL_MS + 1), null);
    assert.equal(pendingPathFor(route, m1.id, now - 1), null);
  });

  it('chemin interne seulement', () => {
    assert.equal(pendingPathFor({ ...route, path: 'https://evil.example' }, m1.id, now), null);
    assert.equal(pendingPathFor({ ...route, path: '//evil.example' }, m1.id, now), null);
    assert.equal(pendingPathFor(null, m1.id, now), null);
  });
});
