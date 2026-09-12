// Connexion WebSocket. Le WS est la source de vérité de l'état des panes : aucune seconde
// source, aucun cache de requêtes.
//
// Le jeton voyage en en-tête `Authorization`, jamais dans `Sec-WebSocket-Protocol` : ce
// champ est renvoyé tel quel dans la réponse de handshake et atterrit dans tous les
// journaux d'accès (C8).
import { WS_PING_INTERVAL_MS, wsCloseReason, type C2S, type S2C, type WsCloseReason } from '@/protocol';

/** React Native accepte un troisième argument `{ headers }` sur iOS. */
type RNWebSocketCtor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

const PING_INTERVAL_MS = WS_PING_INTERVAL_MS;
const PONG_TIMEOUT_MS = 8_000;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000, 15000];

export interface SocketHandlers {
  onMessage: (msg: S2C) => void;
  onOpen: () => void;
  onClose: (reason: WsCloseReason) => void;
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

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly handlers: SocketHandlers,
  ) {}

  get isOpen(): boolean {
    return this.ws?.readyState === 1;
  }

  connect(): void {
    this.closedByUs = false;
    const Ctor = WebSocket as unknown as RNWebSocketCtor;
    const ws = new Ctor(this.url, undefined, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.missedPongs = 0;
      this.startPing();
      this.handlers.onOpen();
    };

    ws.onmessage = (event: WebSocketMessageEvent) => {
      // Les frames binaires du terminal sont du lot 2 : elles sont ignorées ici.
      if (typeof event.data !== 'string') return;
      let msg: S2C;
      try {
        msg = JSON.parse(event.data) as S2C;
      } catch {
        return;
      }
      if (msg.t === 'pong') this.onPong();
      this.handlers.onMessage(msg);
    };

    ws.onerror = () => {
      // `onclose` suit toujours : on n'agit qu'une fois.
    };

    ws.onclose = (event: WebSocketCloseEvent) => {
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
    this.close(false);
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
    if (!this.send({ t: 'ping', id: nextId(), foregroundPaneId: this.handlers.foregroundPaneId() })) return;
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      this.missedPongs += 1;
      // Deux pong manqués consécutifs déclenchent la reconnexion.
      if (this.missedPongs >= 2) this.reconnectNow();
    }, PONG_TIMEOUT_MS);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
  }

  private onPong(): void {
    this.missedPongs = 0;
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  close(permanent = true): void {
    this.closedByUs = permanent;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* rien */
    }
    this.ws = null;
  }
}
