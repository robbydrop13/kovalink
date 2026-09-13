// Connexion WebSocket. Le WS est la source de vérité de l'état des panes : aucune seconde
// source, aucun cache de requêtes.
//
// Le jeton voyage en en-tête `Authorization`, jamais dans `Sec-WebSocket-Protocol` : ce
// champ est renvoyé tel quel dans la réponse de handshake et atterrit dans tous les
// journaux d'accès (C8).
//
// Un seul socket vivant à la fois (13 septembre). `reconnectNow` remplaçait le socket
// puis laissait le `onclose` de l'ANCIEN arriver après coup : il effaçait la référence
// au nouveau, tuait son ping, annonçait « Mac injoignable » et programmait un TROISIÈME
// socket. L'orphelin, sans ping, était déclaré mort par le daemon 40 s plus tard, et son
// `onclose` recommençait. Le journal du daemon montrait des connexions par paires à moins
// d'une seconde d'écart et des « client WS mort » par paires, toutes les 2 à 5 minutes.
// Désormais un socket remplacé est détaché AVANT d'être fermé, et chaque gestionnaire
// vérifie qu'il parle bien du socket courant.
import { WS_PING_INTERVAL_MS, wsCloseReason, type C2S, type S2C, type WsCloseReason } from '@/protocol';

/** React Native accepte un troisième argument `{ headers }` sur iOS. */
type RNWebSocketCtor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

const PING_INTERVAL_MS = WS_PING_INTERVAL_MS;
export const PONG_TIMEOUT_MS = 8_000;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000, 15000];

export interface SocketHandlers {
  onMessage: (msg: S2C) => void;
  onOpen: () => void;
  onClose: (reason: WsCloseReason) => void;
  /** Aller-retour mesuré sur un ping : envoi du `ping`, réception de son `pong`. */
  onLatency?: (ms: number) => void;
  /**
   * Pane dont l'écran de session est affiché, `null` sinon (liste, réglages, app en
   * arrière plan). Envoyé dans CHAQUE ping : c'est le signal de premier plan du daemon,
   * qui ne supprime une notification que si un client vivant regarde ce pane (A1, CA-31).
   */
  foregroundPaneId: () => number | null;
}

let seq = 0;
export function nextId(): string {
  seq += 1;
  return `c${Date.now().toString(36)}-${seq}`;
}

export class Socket {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private missedPongs = 0;
  private attempt = 0;
  private closedByUs = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pings en attente de pong : identifiant vers heure d'envoi. */
  private readonly inflight = new Map<string, number>();

  private readonly url: string;
  private readonly token: string;
  private readonly handlers: SocketHandlers;

  // Champs explicites, pas de propriétés de paramètre : Node les refuse en mode
  // « strip-only », et ce fichier est testé sous Node.
  constructor(url: string, token: string, handlers: SocketHandlers) {
    this.url = url;
    this.token = token;
    this.handlers = handlers;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === 1;
  }

  connect(): void {
    this.closedByUs = false;
    // Jamais deux sockets : celui qui existe encore est détaché et fermé en silence.
    this.detach();
    const Ctor = WebSocket as unknown as RNWebSocketCtor;
    const ws = new Ctor(this.url, undefined, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.missedPongs = 0;
      this.startPing();
      this.handlers.onOpen();
    };

    ws.onmessage = (event: WebSocketMessageEvent) => {
      if (this.ws !== ws) return;
      // Les frames binaires du terminal sont du lot 2 : elles sont ignorées ici.
      if (typeof event.data !== 'string') return;
      let msg: S2C;
      try {
        msg = JSON.parse(event.data) as S2C;
      } catch {
        return;
      }
      if (msg.t === 'pong') this.onPong(msg.reqId);
      this.handlers.onMessage(msg);
    };

    ws.onerror = () => {
      // `onclose` suit toujours : on n'agit qu'une fois.
    };

    ws.onclose = (event: WebSocketCloseEvent) => {
      // Un socket déjà remplacé ne parle plus au nom de la liaison.
      if (this.ws !== ws) return;
      this.stopPing();
      this.ws = null;
      // La traduction du code vit dans le protocole : l'app ne compare jamais un nombre.
      const reason = wsCloseReason(event.code);
      this.handlers.onClose(reason);
      if (!this.closedByUs && reason === 'network') this.scheduleReconnect();
    };
  }

  /** Un changement de réseau ou un retour au premier plan n'est pas un échec : pas de backoff. */
  reconnectNow(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 15000;
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, Math.max(200, base + jitter));
  }

  send(msg: C2S): boolean {
    if (!this.isOpen || !this.ws) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Ping hors cycle : l'écran change, le daemon doit le savoir tout de suite. */
  pingNow(): void {
    this.ping();
  }

  private ping(): void {
    const id = nextId();
    if (!this.send({ t: 'ping', id, foregroundPaneId: this.handlers.foregroundPaneId() })) return;
    this.inflight.set(id, Date.now());
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      this.missedPongs += 1;
      // Deux pongs manqués consécutifs déclenchent la reconnexion. Le second ping part
      // tout de suite, pas au prochain cycle : un socket mort se voit en 16 s, pas en 36.
      if (this.missedPongs >= 2) this.reconnectNow();
      else this.ping();
    }, PONG_TIMEOUT_MS);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
  }

  private onPong(reqId: string): void {
    this.missedPongs = 0;
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    const sentAt = this.inflight.get(reqId);
    this.inflight.delete(reqId);
    if (sentAt !== undefined) this.handlers.onLatency?.(Math.max(0, Date.now() - sentAt));
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
    this.missedPongs = 0;
    this.inflight.clear();
  }

  /** Oublie le socket courant et le ferme sans qu'il puisse rappeler personne. */
  private detach(): void {
    const ws = this.ws;
    this.ws = null;
    this.stopPing();
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* rien */
    }
  }

  close(permanent = true): void {
    this.closedByUs = permanent;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.detach();
  }
}
