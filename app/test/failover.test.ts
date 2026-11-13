// Bascule entre Macs (étape 4 du plan M1, décision D6) : automatique avec bandeau depuis le
// principal, interrupteur dans les Réglages, retour jamais automatique.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RETURN_PROBE_MS,
  decideFailover,
  hostBanner,
  primaryToProbe,
  shouldProbeReturn,
  type ProbedHost,
} from '@/net/failover';

const mbp: ProbedHost = { id: 'mbp.ts.net', name: 'MacBook', role: 'primary' };
const m1: ProbedHost = { id: 'm1.ts.net', name: 'M1', role: 'secondary' };
const m2: ProbedHost = { id: 'm2.ts.net', name: 'M2', role: 'secondary' };
const hosts = [mbp, m1];

describe('decideFailover', () => {
  it('Mac actif muet et autre Mac qui répond : bascule', () => {
    assert.deepEqual(
      decideFailover({ activeId: mbp.id, hosts, responds: { [m1.id]: true }, autoSwitch: true }),
      { kind: 'switch', to: m1 },
    );
  });

  it('les deux muets : « hors ligne ou Mac injoignable », pas de bascule', () => {
    assert.deepEqual(
      decideFailover({ activeId: mbp.id, hosts, responds: { [mbp.id]: false, [m1.id]: false }, autoSwitch: true }),
      { kind: 'allSilent' },
    );
  });

  it('un Mac non sondé compte comme muet', () => {
    assert.deepEqual(decideFailover({ activeId: mbp.id, hosts, responds: {}, autoSwitch: true }), {
      kind: 'allSilent',
    });
  });

  it('interrupteur coupé : bandeau à un geste, pas de bascule', () => {
    assert.deepEqual(
      decideFailover({ activeId: mbp.id, hosts, responds: { [m1.id]: true }, autoSwitch: false }),
      { kind: 'offer', to: m1 },
    );
  });

  it('le Mac actif répond à /health : la coupure est ailleurs, on reste', () => {
    assert.deepEqual(
      decideFailover({ activeId: mbp.id, hosts, responds: { [mbp.id]: true, [m1.id]: true }, autoSwitch: true }),
      { kind: 'stay' },
    );
  });

  it('jamais de retour automatique : depuis le secours, le principal est seulement proposé', () => {
    assert.deepEqual(
      decideFailover({ activeId: m1.id, hosts, responds: { [mbp.id]: true }, autoSwitch: true }),
      { kind: 'offer', to: mbp },
    );
  });

  it("deux secours ne se renvoient pas la balle : d'un secours à l'autre, un geste", () => {
    assert.deepEqual(
      decideFailover({ activeId: m1.id, hosts: [mbp, m1, m2], responds: { [m2.id]: true }, autoSwitch: true }),
      { kind: 'offer', to: m2 },
    );
  });

  it('vers un autre Mac qui se dit principal : un geste, jamais seul', () => {
    const other: ProbedHost = { id: 'mini.ts.net', name: 'Mini', role: 'primary' };
    assert.deepEqual(
      decideFailover({ activeId: mbp.id, hosts: [mbp, other], responds: { [other.id]: true }, autoSwitch: true }),
      { kind: 'offer', to: other },
    );
  });

  it("la cible suit l'ordre de préférence du registre", () => {
    assert.deepEqual(
      decideFailover({
        activeId: mbp.id,
        hosts: [mbp, m1, m2],
        responds: { [m1.id]: true, [m2.id]: true },
        autoSwitch: true,
      }),
      { kind: 'switch', to: m1 },
    );
  });
});

describe('sonde de retour', () => {
  it('toutes les 60 s', () => {
    assert.equal(RETURN_PROBE_MS, 60_000);
  });

  it('sur un secours, sonde le principal', () => {
    assert.deepEqual(primaryToProbe(m1.id, hosts), mbp);
    assert.equal(shouldProbeReturn(true, m1.id, hosts), true);
  });

  it('sur le principal, ne sonde rien', () => {
    assert.equal(primaryToProbe(mbp.id, hosts), null);
    assert.equal(shouldProbeReturn(true, mbp.id, hosts), false);
  });

  it("seulement au premier plan", () => {
    assert.equal(shouldProbeReturn(false, m1.id, hosts), false);
  });
});

describe('hostBanner', () => {
  const base = { activeId: m1.id, hosts, failedOverFrom: null, primaryResponds: false, offer: null };

  it('après une bascule automatique : bandeau fixe tant que le principal est muet', () => {
    assert.deepEqual(hostBanner({ ...base, failedOverFrom: 'MacBook' }), {
      kind: 'failedOver',
      from: 'MacBook',
      here: 'M1',
    });
  });

  it('le principal répond : « disponible », retour à un geste', () => {
    assert.deepEqual(hostBanner({ ...base, failedOverFrom: 'MacBook', primaryResponds: true }), {
      kind: 'returnAvailable',
      to: mbp,
    });
  });

  it('secours choisi à la main, principal disponible : le retour est proposé aussi', () => {
    assert.deepEqual(hostBanner({ ...base, primaryResponds: true }), { kind: 'returnAvailable', to: mbp });
  });

  it('interrupteur coupé sur le principal : proposition à un geste', () => {
    assert.deepEqual(hostBanner({ ...base, activeId: mbp.id, offer: m1 }), { kind: 'offer', to: m1 });
  });

  it('sur le principal sans proposition : aucun bandeau, même avec un ancien drapeau', () => {
    assert.equal(hostBanner({ ...base, activeId: mbp.id, failedOverFrom: 'MacBook' }), null);
  });

  it('Mac actif inconnu du registre : aucun bandeau', () => {
    assert.equal(hostBanner({ ...base, activeId: 'gone.ts.net', primaryResponds: true }), null);
  });
});
