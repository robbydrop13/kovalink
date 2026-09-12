import {
  FOREGROUND_TTL_MS,
  PROTOCOL_VERSION,
  WS_CLOSE_CODE,
  WS_DEAD_AFTER_MISSED_PONGS,
  WS_PING_INTERVAL_MS,
  type C2S,
  type DevicePrefs,
  type ErrorCode,
  type KovaStatus,
  type Prompt,
  type S2C,
  type Turn,
} from '@kovalink/protocol';
import { audit } from '../audit.js';
import { saveConfig } from '../config.js';
import { logger } from '../logger.js';
import { transcriptPath } from '../paths.js';
import { buildTurns, sortAssistantBlocks } from '../transcript/jsonl.js';
import { buildSessionMeta } from '../transcript/session.js';
import {
  loadDevices,
  mintToken,
  saveDevices,
  signToken,
  TOKEN_RENEW_DAYS,
} from '../security/token.js';
import { currentLink } from '../net/tailscale.js';
import type { Services } from './services.js';

/**
 * Ce que le hub attend d'un socket. C'est la surface d'un `ws.WebSocket`, reduite a ce
 * qui est utilise, pour que les tests puissent en fournir un faux.
 */
export interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Ping DE TRAME (RFC 6455). Le client y repond par un pong sans code applicatif. */
  ping(): void;
  /** Fermeture brutale, sans attendre la trame de fermeture du client mort. */
  terminate(): void;
  on(event: 'message' | 'close' | 'error' | 'pong', cb: (arg?: unknown) => void): void;
}

export interface Client {
  socket: Socket;
  deviceId: string;
  /** Adresse Tailscale du client : sert a dire si SA liaison est directe ou relayee. */
  remoteAddress: string | undefined;
  /** Etag annonce par `hello.resume` : evite de renvoyer une liste identique. */
  resumeEtag: string | null;
  /** Sessions attachees, pour ne pousser que ce que l'appareil regarde. */
  sessions: Set<string>;
  panesSubscribed: boolean;
  /**
   * Pane affiche au premier plan, et date du dernier signal (`ping.foregroundPaneId`
   * ou `session.attach`). Le signal perime apres `FOREGROUND_TTL_MS`. Avant, ce champ
   * etait un booleen vrai a la creation et jamais reecrit.
   */
  foregroundPaneId: number | null;
  foregroundAt: number;
  /** Pings serveur envoyes sans pong depuis le dernier signe de vie. */
  missedPongs: number;
}

const MAX_FRAME_BYTES = 256 * 1024;

export interface HubOptions {
  /** Horloge injectable, pour tester la fraicheur du premier plan a sa vraie valeur. */
  now?: () => number;
}

/**
 * Hub WebSocket : un seul point d'entree pour les messages du client, un seul point de
 * diffusion vers les appareils. Les messages de lot 2 sont declares dans le protocole
 * mais refuses ici, explicitement, plutot que silencieusement ignores.
 *
 * AUCUNE ECRITURE VERS UN PANE NE PASSE PAR ICI. Repondre, interrompre et envoyer du
 * texte sont des routes HTTPS (`server/index.ts`), avec leur nonce, leur limiteur et leur
 * audit une seule fois. Le hub servait `pane.answer`, `pane.interrupt` et `pane.sendText`
 * en double, sans emetteur ; ils ont ete retires du protocole.
 *
 * DETECTION DES CLIENTS MORTS (H1). Un iPhone verrouille ou passe de Wi-Fi en 4G ne
 * ferme pas son socket : sans ping serveur, le client restait dans `clients` avec ses
 * sessions attachees, et le daemon jetait ses notifications de fin de tour pour
 * « session ouverte ». Le hub pinge donc toutes les `WS_PING_INTERVAL_MS`, et declare
 * mort un client apres `WS_DEAD_AFTER_MISSED_PONGS` pings sans pong ni message.
 */
export class Hub {
  private readonly clients = new Set<Client>();
  /** Compteur de sequence par session, pour la pagination et les reprises. */
  private readonly seqs = new Map<string, number>();
  private readonly now: () => number;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly services: Services,
    options: HubOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    services.tailer.on('lines', (sessionId: string, lines: unknown[], reopened: boolean) => {
      this.onTranscriptLines(sessionId, lines as never[], reopened);
    });
    services.tailer.on('closed', (sessionId: string) => {
      this.broadcast({ t: 'session.closed', sessionId }, (c) => c.sessions.has(sessionId));
    });
  }

  add(socket: Socket, deviceId: string, remoteAddress?: string): Client {
    const client: Client = {
      socket,
      deviceId,
      remoteAddress,
      resumeEtag: null,
      sessions: new Set(),
      panesSubscribed: false,
      foregroundPaneId: null,
      foregroundAt: 0,
      missedPongs: 0,
    };
    this.clients.add(client);
    socket.on('close', () => this.remove(client));
    socket.on('error', () => this.remove(client));
    socket.on('pong', () => {
      client.missedPongs = 0;
    });
    socket.on('message', (raw) => {
      // Un message, quel qu'il soit, est un signe de vie.
      client.missedPongs = 0;
      void this.onMessage(client, raw);
    });
    return client;
  }

  /** Retire le client et TOUT son etat : sessions, premier plan, abonnement du tail. */
  remove(client: Client): void {
    if (!this.clients.delete(client)) return;
    client.foregroundPaneId = null;
    for (const sessionId of client.sessions) this.maybeDetach(sessionId);
    client.sessions.clear();
  }

  // --- Battement serveur --------------------------------------------------

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), WS_PING_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * Un tour de battement. Public pour les tests, qui l'appellent a la main au lieu
   * d'attendre 40 s. Un client qui a deja `WS_DEAD_AFTER_MISSED_PONGS` pings sans
   * reponse est ferme avec `DEAD_CLIENT` puis termine ; les autres recoivent un ping.
   */
  heartbeat(): void {
    for (const client of [...this.clients]) {
      if (client.missedPongs >= WS_DEAD_AFTER_MISSED_PONGS) {
        logger.warn('client WS mort, fermeture et nettoyage', {
          deviceId: client.deviceId,
          missedPongs: client.missedPongs,
          sessions: client.sessions.size,
          foregroundPaneId: client.foregroundPaneId,
        });
        this.remove(client);
        try {
          client.socket.close(WS_CLOSE_CODE.DEAD_CLIENT, 'ping timeout');
          client.socket.terminate();
        } catch {
          /* deja ferme */
        }
        continue;
      }
      client.missedPongs += 1;
      try {
        client.socket.ping();
      } catch (e) {
        logger.warn('ping WS en echec', { deviceId: client.deviceId, err: (e as Error).message });
        this.remove(client);
      }
    }
  }

  /** Revocation immediate : on coupe les WebSocket ouverts de l'appareil. */
  dropDevice(deviceId: string): void {
    for (const c of [...this.clients]) {
      if (c.deviceId !== deviceId) continue;
      this.remove(c);
      try {
        c.socket.close(WS_CLOSE_CODE.UNAUTHORIZED, 'revoked');
      } catch {
        /* deja ferme */
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Regle anti-bruit A1, CA-31 : un push est supprime SEULEMENT si un client VIVANT est
   * AU PREMIER PLAN sur ce pane, avec un signal de moins de `FOREGROUND_TTL_MS`, et a
   * la session attachee. Un client mort a deja ete retire, un client dont le signal a
   * perime ne compte plus : l'iPhone range sur la table ne supprime rien.
   */
  isWatching(sessionId: string | null, paneId: number, now = this.now()): boolean {
    if (!sessionId) return false;
    return [...this.clients].some(
      (c) =>
        c.sessions.has(sessionId) &&
        c.foregroundPaneId === paneId &&
        now - c.foregroundAt < FOREGROUND_TTL_MS,
    );
  }

  private stampForeground(client: Client, paneId: number | null): void {
    client.foregroundPaneId = paneId;
    client.foregroundAt = this.now();
  }

  send(client: Client, msg: S2C): void {
    try {
      client.socket.send(JSON.stringify(msg));
    } catch (e) {
      logger.warn('envoi WS en echec', { err: (e as Error).message });
      this.remove(client);
    }
  }

  broadcast(msg: S2C, filter: (c: Client) => boolean = () => true): void {
    for (const client of [...this.clients]) if (filter(client)) this.send(client, msg);
  }

  private error(client: Client, reqId: string | undefined, code: ErrorCode, message: string): void {
    this.send(client, {
      t: 'error',
      reqId,
      code,
      message,
      retryable: code === 'KOVA_DOWN' || code === 'IPC_TIMEOUT',
    });
  }

  private async onMessage(client: Client, raw: unknown): Promise<void> {
    const text = typeof raw === 'string' ? raw : String(raw);
    if (Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) {
      return this.error(client, undefined, 'BAD_REQUEST', 'trame trop grande');
    }
    let msg: C2S;
    try {
      msg = JSON.parse(text) as C2S;
    } catch {
      return this.error(client, undefined, 'BAD_REQUEST', 'JSON illisible');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      return this.error(client, undefined, 'BAD_REQUEST', 'message sans type');
    }

    try {
      await this.dispatch(client, msg);
    } catch (e) {
      const code = (e as { code?: ErrorCode }).code ?? 'INTERNAL';
      this.error(client, msg.id, code, (e as Error).message);
    }
  }

  private async dispatch(client: Client, msg: C2S): Promise<void> {
    const { panes, ipc, prompts, rate } = this.services;

    switch (msg.t) {
      case 'hello': {
        if (msg.protocol !== PROTOCOL_VERSION) {
          // Le code de fermeture est declare dans le protocole et REELLEMENT emis : l'app
          // le lisait deja, personne ne l'envoyait.
          this.error(client, msg.id, 'PROTOCOL_VERSION', 'version de protocole inconnue');
          this.remove(client);
          client.socket.close(WS_CLOSE_CODE.PROTOCOL_VERSION, 'protocol version');
          return;
        }
        if (msg.expoPushToken) this.registerPushToken(client.deviceId, msg.expoPushToken);
        client.resumeEtag = msg.resume?.panesEtag ?? null;
        // Renouvellement silencieux a J-15. `hello.ok.token` etait declare dans le
        // protocole et l'app savait deja le ranger, mais personne ne l'emettait : le
        // jeton mourait a 90 jours et exigeait un reappairage sans explication.
        const renewed = this.renewIfNeeded(client.deviceId);
        return this.send(client, {
          t: 'hello.ok',
          reqId: msg.id,
          protocol: PROTOCOL_VERSION,
          daemonVersion: this.services.daemonVersion,
          kova: { status: ipc.state, pid: ipc.pid, commands: ipc.commands },
          link: currentLink(client.remoteAddress),
          serverTime: new Date().toISOString(),
          ...(renewed ? { token: renewed } : {}),
        });
      }

      case 'ping':
        // Le ping porte le premier plan. Un client d'avant ce champ vaut « pas au
        // premier plan » : on ne supprime jamais un push sur une absence d'information.
        this.stampForeground(client, typeof msg.foregroundPaneId === 'number' ? msg.foregroundPaneId : null);
        return this.send(client, { t: 'pong', reqId: msg.id, serverTime: new Date().toISOString() });

      case 'panes.subscribe': {
        client.panesSubscribed = true;
        // Reprise : le cache de l'app est deja a jour, on ne renvoie pas la liste.
        // L'etag porte l'identifiant de cette instance de daemon, donc un compteur
        // remis a zero par un redemarrage ne peut pas collisionner avec l'ancien.
        if (client.resumeEtag !== null && client.resumeEtag === panes.etag) {
          client.resumeEtag = null;
          return this.send(client, { t: 'ack', reqId: msg.id });
        }
        client.resumeEtag = null;
        return this.send(client, this.panesSnapshot());
      }

      case 'pane.peek': {
        if (!rate.allow(client.deviceId, 'prompt')) {
          return this.error(client, msg.id, 'RATE_LIMITED', 'trop de lectures de prompt');
        }
        const pane = panes.get(msg.paneId);
        if (!pane) return this.error(client, msg.id, 'PANE_NOT_FOUND', 'pane inconnu');
        const prompt = await prompts.current(msg.paneId, pane.awaiting_since);
        this.send(client, { t: 'ack', reqId: msg.id });
        return this.send(client, { t: 'prompt', prompt });
      }

      case 'pane.screen': {
        if (!rate.allow(client.deviceId, 'screen')) {
          return this.error(client, msg.id, 'RATE_LIMITED', 'trop de lectures d ecran');
        }
        const screen = await prompts.screen(msg.paneId);
        if (!screen) return this.error(client, msg.id, 'PANE_NOT_FOUND', 'pane inconnu');
        return this.send(client, { t: 'pane.screen.ok', reqId: msg.id, screen });
      }

      case 'pane.cmd': {
        const pane = panes.get(msg.paneId);
        if (!pane) return this.error(client, msg.id, 'PANE_NOT_FOUND', 'pane inconnu');
        // Union litterale fermee : aucune commande arbitraire ne peut etre passee.
        const payload =
          msg.cmd.cmd === 'focus-pane'
            ? { cmd: 'focus-pane', pane_id: msg.paneId }
            : { cmd: 'set-pane-status', pane_id: msg.paneId, status: msg.cmd.status };
        await ipc.request(payload);
        audit({ deviceId: client.deviceId, action: `pane.${msg.cmd.cmd}`, paneId: msg.paneId, result: 'ok' });
        return this.send(client, { t: 'ack', reqId: msg.id });
      }

      case 'session.attach':
        return this.attachSession(client, msg.id, msg.sessionId);

      case 'session.detach': {
        client.sessions.delete(msg.sessionId);
        this.maybeDetach(msg.sessionId);
        const pane = panes.findBySession(msg.sessionId);
        if (pane && client.foregroundPaneId === pane.id) this.stampForeground(client, null);
        return this.send(client, { t: 'ack', reqId: msg.id });
      }

      case 'push.register':
        this.registerPushToken(client.deviceId, msg.expoPushToken, msg.prefs);
        this.applySleepPref(msg.prefs);
        return this.send(client, { t: 'ack', reqId: msg.id });

      // Lot 2 : declares dans le protocole partage, refuses ici explicitement.
      case 'pane.sendKeys':
      case 'term.input':
        return this.error(client, msg.id, 'FORBIDDEN_ACTION', 'disponible au lot 2');

      default:
        return this.error(client, (msg as { id?: string }).id, 'BAD_REQUEST', 'type inconnu');
    }
  }

  /**
   * Rend un jeton neuf quand l'actuel arrive a moins de `TOKEN_RENEW_DAYS` de son terme,
   * `null` sinon. L'ancien reste valide jusqu'a sa propre expiration : une coupure entre
   * l'emission et l'ecriture en trousseau ne doit pas deconnecter l'appareil.
   */
  private renewIfNeeded(deviceId: string): string | null {
    const devices = loadDevices();
    const device = devices[deviceId];
    if (!device || device.revoked) return null;
    // `device.exp` est en SECONDES (c'est la valeur portee par le jeton), `Date.now()`
    // en millisecondes. La conversion est faite ici, une fois, explicitement.
    const remainingMs = device.exp * 1000 - Date.now();
    if (remainingMs >= TOKEN_RENEW_DAYS * 86_400_000) return null;
    const minted = mintToken(this.services.master);
    devices[deviceId] = { ...device, deviceId, exp: minted.exp };
    saveDevices(devices);
    logger.info('jeton renouvele', { deviceId });
    // Le `deviceId` change a chaque frappe : on reemet sous l'identifiant existant.
    return `${deviceId}.${minted.exp}.${signToken(this.services.master, deviceId, minted.exp)}`;
  }

  private registerPushToken(deviceId: string, expoPushToken: string, prefs?: DevicePrefs): void {
    const devices = loadDevices();
    const device = devices[deviceId];
    if (!device) return;
    // Un jeton vide signifie « seulement les reglages » : il n'ecrase jamais un jeton
    // deja range, sans quoi renvoyer ses preferences coupait les notifications.
    if (expoPushToken.length > 0) device.expoPushToken = expoPushToken;
    if (prefs) {
      device.prefs = { onlyValidations: prefs.onlyValidations, quietHours: prefs.quietHours };
    }
    saveDevices(devices);
    // Jamais le jeton dans le journal : il identifie l'appareil aupres d'Expo.
    audit({ deviceId, action: 'push.register', result: 'ok' });
  }

  /**
   * `keepMacAwake` (A1, CA-126). L'interrupteur de l'app EST le reglage : il est ecrit
   * dans `config.json` et l'assertion en cours est relachee sur le champ si elle vient
   * d'etre interdite. Un client d'avant ce champ ne change rien.
   */
  private applySleepPref(prefs: Partial<DevicePrefs> | undefined): void {
    if (typeof prefs?.keepMacAwake !== 'boolean') return;
    const cfg = this.services.cfg();
    if (cfg.preventSleep !== prefs.keepMacAwake) {
      saveConfig({ ...cfg, preventSleep: prefs.keepMacAwake });
      logger.info('reglage anti-veille recu de l app', { preventSleep: prefs.keepMacAwake });
    }
    this.services.sleep.reconcile(this.services.panes.anyWorking());
  }

  private async attachSession(client: Client, reqId: string, sessionId: string): Promise<void> {
    const pane = this.services.panes.findBySession(sessionId);
    if (!pane) return this.error(client, reqId, 'SESSION_NOT_FOUND', 'aucun pane pour cette session');
    const path = transcriptPath(pane.cwd, sessionId);

    client.sessions.add(sessionId);
    // Ouvrir l'ecran de session est un signal de premier plan, rafraichi ensuite par
    // chaque `ping.foregroundPaneId`.
    this.stampForeground(client, pane.id);
    let lines: unknown[] = [];
    try {
      lines = await this.services.tailer.attach(sessionId, path);
    } catch (e) {
      return this.error(client, reqId, 'IO_ERROR', (e as Error).message);
    }
    const raw = sortAssistantBlocks(lines as never[]);
    const turns = buildTurns(raw);
    this.seqs.set(sessionId, turns.length);
    const meta = buildSessionMeta(sessionId, pane.id, pane.cwd, raw, turns.length);
    this.send(client, {
      t: 'session.snapshot',
      reqId,
      sessionId,
      meta,
      turns,
      hasMoreBefore: true,
    });
  }

  private maybeDetach(sessionId: string): void {
    const stillWatched = [...this.clients].some((c) => c.sessions.has(sessionId));
    if (!stillWatched) this.services.tailer.detach(sessionId);
  }

  private onTranscriptLines(sessionId: string, lines: never[], reopened: boolean): void {
    const startSeq = reopened ? 0 : (this.seqs.get(sessionId) ?? 0);
    const turns: Turn[] = buildTurns(sortAssistantBlocks(lines), startSeq);
    if (turns.length === 0) return;
    this.seqs.set(sessionId, startSeq + turns.length);
    // Un turn peut etre MUTABLE : les blocs d'un meme `requestId` arrivent en
    // plusieurs lignes. Le client remplace les turns dont l'identifiant revient.
    this.broadcast(
      { t: 'session.append', sessionId, turns, replaceIds: turns.map((t) => t.id) },
      (c) => c.sessions.has(sessionId),
    );
  }

  panesSnapshot(): S2C {
    const { panes } = this.services;
    return {
      t: 'panes.snapshot',
      appActive: panes.appActive,
      focusPaneId: panes.focusPaneId,
      panes: panes.all(),
      tabs: panes.allTabs(),
      etag: panes.etag,
    };
  }

  pushPanesSnapshot(): void {
    const snap = this.panesSnapshot();
    this.broadcast(snap, (c) => c.panesSubscribed);
  }

  pushPaneEvent(event: Extract<S2C, { t: 'pane.event' }>): void {
    this.broadcast(event, (c) => c.panesSubscribed);
  }

  pushPrompt(prompt: Prompt): void {
    this.broadcast({ t: 'prompt', prompt });
  }

  /** Chaque client recoit l'etat de SA liaison, direct ou relayee (A11). */
  pushDaemonStatus(status: KovaStatus, pid: number | null): void {
    const since = new Date().toISOString();
    for (const client of [...this.clients]) {
      this.send(client, {
        t: 'daemon.status',
        kova: { status, pid },
        link: currentLink(client.remoteAddress),
        since,
      });
    }
  }

}
