import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { LinkInfo } from '@kovalink/protocol';

const TAILSCALE_BINS = [
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

const CACHE_MS = 20_000;

export function tailscaleBin(): string | null {
  return TAILSCALE_BINS.find((p) => existsSync(p)) ?? null;
}

export interface PeerLink {
  /** Adresses Tailscale du pair, telles qu'elles apparaissent cote serveur. */
  addresses: string[];
  /** Non vide quand la liaison est directe. */
  curAddr: string;
  /** Code du relais DERP, par exemple `lhr`. */
  relay: string;
}

export function parsePeers(json: string): PeerLink[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const peers = (data as { Peer?: Record<string, unknown> }).Peer;
  if (!peers || typeof peers !== 'object') return [];
  return Object.values(peers).map((p) => {
    const peer = p as { TailscaleIPs?: unknown; CurAddr?: unknown; Relay?: unknown };
    return {
      addresses: Array.isArray(peer.TailscaleIPs) ? (peer.TailscaleIPs as string[]) : [],
      curAddr: typeof peer.CurAddr === 'string' ? peer.CurAddr : '',
      relay: typeof peer.Relay === 'string' ? peer.Relay : '',
    };
  });
}

/**
 * Etat de la liaison vers UNE adresse cliente (A11).
 *
 * Tailscale etablit une connexion directe quand il le peut et retombe sur un relais
 * DERP sinon. Le pair est identifie par l'adresse distante de la connexion, qui est
 * son adresse Tailscale : c'est la seule facon exacte de repondre pour ce client la,
 * plutot que pour le tailnet en general.
 *
 * `relay: null` signifie direct. Une adresse de loopback est directe par definition.
 */
export function linkFor(remoteAddress: string | undefined, peers: PeerLink[]): LinkInfo {
  if (!remoteAddress) return { relay: null };
  // `::ffff:100.x.x.x` pour une connexion IPv4 sur une socket IPv6.
  const addr = remoteAddress.replace(/^::ffff:/i, '');
  if (addr === '127.0.0.1' || addr === '::1') return { relay: null };
  const peer = peers.find((p) => p.addresses.includes(addr));
  if (!peer) return { relay: null };
  return { relay: peer.curAddr === '' && peer.relay !== '' ? peer.relay : null };
}

/**
 * Cache des pairs.
 *
 * `tailscale status --json` est un PROCESSUS EXTERNE : l'appeler en synchrone sur le
 * chemin d'une requete bloquerait la boucle d'evenements de tout le daemon pendant
 * plusieurs centaines de millisecondes, et jusqu'a plusieurs secondes quand Tailscale
 * vient de demarrer. Mesure faite pendant la recette : des requetes IPC ont expire et
 * des evenements `subscribe` sont arrives en retard a cause de cet appel.
 *
 * Le rafraichissement est donc ASYNCHRONE et de fond. Les lectures rendent toujours la
 * derniere valeur connue, immediatement. Une liaison qui bascule de relayee a directe
 * est visible au plus tard au rafraichissement suivant, ce qui est largement suffisant
 * pour un indicateur.
 */
let knownPeersCache: PeerLink[] = [];
let refreshing = false;

export function knownPeers(): PeerLink[] {
  return knownPeersCache;
}

function refreshPeers(): Promise<PeerLink[]> {
  if (refreshing) return Promise.resolve(knownPeersCache);
  const bin = tailscaleBin();
  if (!bin) {
    knownPeersCache = [];
    return Promise.resolve(knownPeersCache);
  }
  refreshing = true;
  return new Promise((resolve) => {
    execFile(bin, ['status', '--json'], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      refreshing = false;
      if (!err) knownPeersCache = parsePeers(stdout);
      resolve(knownPeersCache);
    });
  });
}

/**
 * Rafraichissement periodique, demarre par le daemon. Rend la fonction d'arret.
 * `onRefresh` est appele apres chaque lecture : le hub y compare la liaison de chaque
 * client a la derniere annoncee, et pousse le changement.
 */
export function startPeerRefresh(intervalMs = CACHE_MS, onRefresh?: () => void): () => void {
  const tick = (): void => {
    void refreshPeers().then(() => onRefresh?.());
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Lecture immediate, jamais bloquante. */
export function currentLink(remoteAddress: string | undefined): LinkInfo {
  return linkFor(remoteAddress, knownPeersCache);
}

/** Reservee aux tests : impose le contenu du cache. */
export function setKnownPeers(peers: PeerLink[]): void {
  knownPeersCache = peers;
}
