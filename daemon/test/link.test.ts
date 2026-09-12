import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  currentLink,
  knownPeers,
  linkFor,
  parsePeers,
  setKnownPeers,
  type PeerLink,
} from '../src/net/tailscale.js';
import { PaneStore } from '../src/kova/panes.js';

/** Sortie reelle de `tailscale status --json`, reduite aux champs utilises. */
const REAL_STATUS = JSON.stringify({
  Self: { Relay: 'mad' },
  Peer: {
    'nodekey:aaa': {
      HostName: 'iphone-15-plus',
      TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1234:abcd'],
      CurAddr: '',
      Relay: 'lhr',
      Online: true,
    },
  },
});

describe('etat de la liaison Tailscale (A11)', () => {
  const peers = parsePeers(REAL_STATUS);

  it('lit les pairs de la sortie reelle', () => {
    assert.equal(peers.length, 1);
    assert.deepEqual(peers[0]?.addresses, ['100.101.102.103', 'fd7a:115c:a1e0::1234:abcd']);
    assert.equal(peers[0]?.relay, 'lhr');
  });

  it('signale une liaison relayee et nomme le relais', () => {
    // Mesure du 2026-09-10 : l'iPhone de Robin passe par le relais de Londres.
    assert.deepEqual(linkFor('100.101.102.103', peers), { relay: 'lhr' });
  });

  it('signale une liaison directe quand CurAddr est renseigne', () => {
    const direct: PeerLink[] = [
      { addresses: ['100.101.102.103'], curAddr: '192.168.1.20:41641', relay: 'lhr' },
    ];
    assert.deepEqual(linkFor('100.101.102.103', direct), { relay: null });
  });

  it('traite la loopback comme directe', () => {
    assert.deepEqual(linkFor('127.0.0.1', peers), { relay: null });
    assert.deepEqual(linkFor('::1', peers), { relay: null });
  });

  it('demappe une adresse IPv4 presentee sur une socket IPv6', () => {
    assert.deepEqual(linkFor('::ffff:100.101.102.103', peers), { relay: 'lhr' });
  });

  it('repond direct plutot que de mentir quand le pair est inconnu', () => {
    assert.deepEqual(linkFor('100.99.99.99', peers), { relay: null });
    assert.deepEqual(linkFor(undefined, peers), { relay: null });
  });

  it('ne tombe pas sur une sortie illisible', () => {
    assert.deepEqual(parsePeers('pas du json'), []);
    assert.deepEqual(parsePeers('{}'), []);
  });

  it('la lecture est immediate et ne lance aucun processus externe', () => {
    // `tailscale status --json` est un processus externe : l'appeler en synchrone sur
    // le chemin d'une requete bloquerait toute la boucle d'evenements du daemon.
    setKnownPeers(peers);
    const t0 = process.hrtime.bigint();
    const link = currentLink('100.101.102.103');
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.deepEqual(link, { relay: 'lhr' });
    assert.ok(elapsedMs < 5, `lecture en ${elapsedMs.toFixed(2)} ms`);
    assert.equal(knownPeers().length, 1);
    setKnownPeers([]);
    assert.deepEqual(currentLink('100.101.102.103'), { relay: null });
  });
});

describe('etag de reprise', () => {
  it('porte l identifiant de l instance, donc deux daemons ne collisionnent pas', () => {
    const a = new PaneStore();
    const b = new PaneStore();
    // Meme nombre de revisions des deux cotes : seuls les identifiants d'instance
    // empechent l'app de croire que son cache est encore valable.
    a.replaceAll([]);
    b.replaceAll([]);
    assert.notEqual(a.etag, b.etag);
    assert.match(a.etag, /^[A-Za-z0-9_-]+-\d+$/);
  });

  it('change a chaque modification de la liste', () => {
    const store = new PaneStore();
    const before = store.etag;
    store.upsertRaw({ id: 1, window: 0, tab: 0, cwd: '/tmp', child_processes: [] });
    assert.notEqual(store.etag, before);
  });
});
