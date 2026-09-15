import { EventEmitter } from 'node:events';
import { connect, type Socket } from 'node:net';
import {
  KOVA_DOWN_AFTER_MS,
  type ErrorCode,
  type KovaStatus,
  type PaneContent,
} from '@kovalink/protocol';
import { logger } from '../logger.js';
import { discoverKovaSocket, type DiscoverDeps, realDeps } from './discover.js';

export class IpcError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

/** V3 : `error` est une chaine libre sans code machine. Table de correspondance. */
function mapIpcError(raw: string): ErrorCode {
  if (/^not found/i.test(raw)) return 'PANE_NOT_FOUND';
  if (/^unknown command/i.test(raw)) return 'IPC_UNSUPPORTED';
  if (/^invalid JSON/i.test(raw)) return 'INTERNAL';
  return 'INTERNAL';
}

export interface KovaResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Le type vit dans le protocole : l'app affiche exactement ces trois etats. */
export type { KovaStatus };

const REQUEST_TIMEOUT_MS = 5_000;
/** Le contexte documente un keepalive `ping` a 30 s : 45 s laisse une marge franche. */
const WATCHDOG_MS = 45_000;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const SUBSCRIBED_EVENTS = ['focus', 'pane-status', 'pane-working', 'pane-open', 'pane-close'];

/**
 * Commandes sondees au demarrage (V3 : aucune commande de version n'existe).
 *
 * UNIQUEMENT des commandes de LECTURE. Sonder une commande de controle reviendrait a
 * l'emettre sans argument sur l'instance vivante de Robin : `focus-pane` deplacerait
 * peut-etre son focus, `set-pane-status` changerait un badge, `send-keys` ecrirait.
 * Leur presence est tenue pour acquise et verifiee a l'usage, pas au demarrage.
 *
 * `subscribe` est exclu pour une autre raison, mesuree sur la machine : l'emettre sur
 * une connexion de requete la transforme en flux d'evenements.
 */
const PROBED_COMMANDS = ['list-panes', 'list-tabs', 'get-pane-content'];

/**
 * Attente maximale d'une requete emise pendant une reconnexion (reveil, abonnement ferme).
 * Mesure du 15 septembre 2026 : un `start-claude` arrive souvent a la milliseconde ou le
 * reveil du Mac invalide les sockets. Il attend l'abonnement neuf au lieu d'echouer.
 */
export const WAIT_FOR_UP_MS = 5_000;

/** Lectures pures : les rejouer apres une coupure en vol ne change rien a l'etat de Kova. */
const IDEMPOTENT_COMMANDS = new Set(PROBED_COMMANDS);

interface Pending {
  payload: Record<string, unknown>;
  resolve: (r: KovaResponse) => void;
  reject: (e: Error) => void;
  /** Arme tant que la requete attend une connexion : a son echeance, elle echoue. */
  waitTimer?: NodeJS.Timeout;
  /** Une seule nouvelle tentative par requete, jamais une boucle. */
  retried?: boolean;
}

/** Decoupe un flux JSON-lines avec garde de taille. */
class LineBuffer {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    if (Buffer.byteLength(this.buf, 'utf8') > MAX_LINE_BYTES) {
      this.buf = '';
      throw new IpcError('INTERNAL', 'IPC line over 8 MB, connection dropped');
    }
    const parts = this.buf.split('\n');
    this.buf = parts.pop() ?? '';
    return parts.filter((l) => l.trim() !== '');
  }
  reset(): void {
    this.buf = '';
  }
}

export type RawChannel = (ipc: KovaIpc, payload: Record<string, unknown>) => Promise<KovaResponse>;

/** Pose par le bloc statique de `KovaIpc`, consomme une seule fois par `claimRawChannel`. */
let rawChannel: RawChannel | null = null;
let rawChannelClaimed = false;

/**
 * Canal brut vers `#enqueue`, A USAGE UNIQUE : la premiere reclamation le recoit, toute
 * autre leve au chargement du module appelant. `sendKeys.ts` le reclame a son import ;
 * un second module qui tenterait la meme chose ferait echouer le daemon au demarrage,
 * pas silencieusement en production. Le test `keygate.test.ts` compte les appelants
 * par analyse syntaxique.
 */
export function claimRawChannel(): RawChannel {
  if (rawChannelClaimed || !rawChannel) {
    throw new Error('le canal brut IPC a deja ete reclame : seul kova/sendKeys.ts y a droit');
  }
  rawChannelClaimed = true;
  return rawChannel;
}

/**
 * Client IPC de Kova.
 *
 * DEUX REGIMES DE CONNEXION, ET UN SEUL EST PERSISTANT. Mesure faite sur la machine,
 * Kova 1.11.0 :
 *
 * | Connexion | Comportement mesure |
 * |---|---|
 * | requete simple, puis silence | fermee par Kova a +5 017 ms |
 * | ouverte sans rien envoyer | fermee par Kova a +5 001 ms |
 * | `subscribe`, puis silence | toujours ouverte a +20 000 ms, 47 lignes recues |
 *
 * Kova ferme donc toute connexion inactive depuis 5 secondes, sauf celle qui porte un
 * abonnement. En consequence :
 *
 * - la connexion d'ABONNEMENT est persistante. Sa fermeture est un vrai incident :
 *   watchdog de 45 s, backoff, redecouverte du socket, `warn` dans le journal ;
 * - les connexions de REQUETE sont JETABLES, une par requete. Leur fermeture est le cas
 *   nominal : aucun `warn`, aucun backoff, aucune reconnexion planifiee, aucun
 *   changement d'etat. Le cout mesure d'une connexion neuve est de 1 ms, pour un
 *   aller-retour de 16 ms.
 *
 * Le protocole JSON-lines n'a AUCUN identifiant de correlation : les requetes restent
 * serialisees en FIFO, une seule en vol, timeout 5 s.
 */
export class KovaIpc extends EventEmitter {
  private status: KovaStatus = 'down';
  private socketPath: string | null = null;
  private kovaPid: number | null = null;

  private subSocket: Socket | null = null;
  private readonly subLines = new LineBuffer();

  private queue: Pending[] = [];
  private busy = false;

  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  /** Arme a la perte de l'abonnement : sans socket a son echeance, `down` (CA-123). */
  private downTimer: NodeJS.Timeout | null = null;
  private stopped = true;

  commands: Record<string, boolean> = {};

  constructor(
    private readonly deps: DiscoverDeps = realDeps,
    private readonly downAfterMs = KOVA_DOWN_AFTER_MS,
    private readonly waitForUpMs = WAIT_FOR_UP_MS,
  ) {
    super();
  }

  /**
   * Rend `true` des que l'IPC est `up`, `false` apres `timeoutMs` ou si Kova est `down`.
   * Sert aux appelants qui veulent relire l'etat avant de rejouer une ecriture.
   */
  whenUp(timeoutMs = this.waitForUpMs): Promise<boolean> {
    if (this.status === 'up') return Promise.resolve(true);
    if (this.stopped || this.status === 'down') return Promise.resolve(false);
    return new Promise((resolve) => {
      const onStatus = (s: KovaStatus): void => {
        if (s === 'reconnecting') return;
        clearTimeout(timer);
        this.off('status', onStatus);
        resolve(s === 'up');
      };
      const timer = setTimeout(() => {
        this.off('status', onStatus);
        resolve(this.status === 'up');
      }, timeoutMs);
      timer.unref?.();
      this.on('status', onStatus);
    });
  }

  get state(): KovaStatus {
    return this.status;
  }
  get pid(): number | null {
    return this.kovaPid;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.teardown('stop');
  }

  /**
   * Reveil apres veille : les sockets sont tenus pour morts, on reconnecte tout de
   * suite. Contrairement a `stop()` puis `start()`, l'etat passe par `reconnecting` et
   * non par `down` : un simple reveil ne doit pas vider la liste des panes de l'app.
   */
  restart(reason: string): void {
    this.clearTimers();
    this.attempt = 0;
    this.stopped = false;
    this.teardown(reason);
    void this.connect();
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.downTimer) clearTimeout(this.downTimer);
    this.reconnectTimer = null;
    this.watchdog = null;
    this.downTimer = null;
  }

  private setStatus(next: KovaStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.emit('status', next, this.kovaPid);
    // Les requetes mises en attente pendant la reconnexion partent des que c'est revenu,
    // et echouent tout de suite si Kova est tenu pour absent.
    if (next === 'up') this.pump();
    if (next === 'down') this.rejectQueued(new IpcError('KOVA_DOWN', 'Kova is unreachable'));
  }

  private rejectQueued(err: Error): void {
    const queued = this.queue;
    this.queue = [];
    for (const p of queued) {
      if (p.waitTimer) clearTimeout(p.waitTimer);
      p.reject(err);
    }
  }

  /** La requete attend une connexion : bornee a `waitForUpMs`, puis `KOVA_DOWN`. */
  private armWait(p: Pending): void {
    if (p.waitTimer) return;
    p.waitTimer = setTimeout(() => {
      p.waitTimer = undefined;
      const i = this.queue.indexOf(p);
      if (i < 0) return;
      this.queue.splice(i, 1);
      p.reject(
        new IpcError('KOVA_DOWN', `Kova is unreachable (waited ${Math.round(this.waitForUpMs / 1000)} s for the IPC to reconnect)`),
      );
    }, this.waitForUpMs);
    p.waitTimer.unref?.();
  }

  /**
   * Perte de l'abonnement. `up` devient `reconnecting` et la minuterie `down` s'arme ;
   * `down` reste `down` : on ne fait pas clignoter l'etat a chaque tentative. Le
   * passage a `down` ne coupe pas la reconnexion, qui continue en boucle.
   */
  private markLost(): void {
    if (this.stopped) {
      this.setStatus('down');
      return;
    }
    if (this.status === 'down') return;
    this.setStatus('reconnecting');
    if (this.downTimer) return;
    this.downTimer = setTimeout(() => {
      this.downTimer = null;
      if (this.status !== 'up') {
        this.kovaPid = null;
        logger.info('kova absent, etat down', { afterMs: this.downAfterMs });
        this.setStatus('down');
      }
    }, this.downAfterMs);
    this.downTimer.unref?.();
  }

  /**
   * Ne concerne QUE l'abonnement. Les requetes en file n'ont encore rien envoye : elles
   * ATTENDENT la reconnexion (bornee a `waitForUpMs`) au lieu d'echouer. C'etait la cause
   * du `start-claude` refuse du 15 septembre a 07:34 : `IPC connection lost (reveil)` a la
   * milliseconde de la requete. Seul un arret, ou Kova tenu pour absent, les rejette.
   */
  private teardown(reason: string): void {
    this.subSocket?.destroy();
    this.subSocket = null;
    this.subLines.reset();
    this.markLost();
    if (this.stopped || this.status === 'down') {
      this.rejectQueued(new IpcError('KOVA_DOWN', `IPC connection lost (${reason})`));
      return;
    }
    for (const p of this.queue) this.armWait(p);
  }

  // ------------------------------------------------------------------
  // Connexion d'abonnement, persistante
  // ------------------------------------------------------------------

  /** DISCOVERING re-scanne a chaque tentative : un Kova redemarre est rattrape seul. */
  private async connect(): Promise<void> {
    if (this.stopped) return;
    const found = discoverKovaSocket(this.deps);
    if (!found) {
      this.kovaPid = null;
      // Premier demarrage sans Kova : `down` d'emblee, il n'y a rien a attendre.
      if (this.status === 'up' || this.downTimer) this.markLost();
      else this.setStatus('down');
      return this.scheduleReconnect('aucun socket kova vivant');
    }
    this.socketPath = found.path;
    this.kovaPid = found.pid;

    try {
      this.subSocket = await this.openSubscription(found.path);
      this.attempt = 0;
      if (this.downTimer) clearTimeout(this.downTimer);
      this.downTimer = null;
      this.armWatchdog();
      this.setStatus('up');
      logger.info('kova ipc connecte', { pid: found.pid, socket: found.path });
      this.commands = await this.probeCommands();
      this.emit('ready');
    } catch (e) {
      this.teardown((e as Error).message);
      this.scheduleReconnect((e as Error).message);
    }
  }

  private openSubscription(path: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = connect(path);
      const fail = (e: Error): void => {
        sock.destroy();
        reject(e);
      };
      sock.once('error', fail);
      sock.once('connect', () => {
        sock.off('error', fail);
        sock.setEncoding('utf8');
        sock.on('data', (chunk: string) => {
          try {
            for (const line of this.subLines.push(chunk)) this.onSubLine(line);
          } catch (e) {
            this.teardown((e as Error).message);
            this.scheduleReconnect('buffer');
          }
        });
        sock.on('error', (e) => {
          this.teardown(e.message);
          this.scheduleReconnect(e.message);
        });
        sock.on('close', () => {
          if (this.stopped) return;
          // Une connexion d'abonnement fermee est un incident : Kova la garde ouverte
          // indefiniment tant qu'il vit.
          this.teardown('close');
          this.scheduleReconnect('abonnement ferme');
        });
        sock.write(`${JSON.stringify({ cmd: 'subscribe', events: SUBSCRIBED_EVENTS })}\n`);
        resolve(sock);
      });
    });
  }

  /** Backoff `min(500ms * 2^n, 10s)` avec gigue, pour ne pas marteler `/tmp`. */
  private scheduleReconnect(reason: string): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(500 * 2 ** this.attempt, 10_000);
    const delay = Math.round(base * (0.8 + 0.4 * Math.random()));
    this.attempt = Math.min(this.attempt + 1, 10);
    logger.warn('kova ipc reconnexion planifiee', { delayMs: delay, reason });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /**
   * Un socket Unix a moitie mort ne remonte jamais d'erreur. Ce timer, rearme a chaque
   * ligne recue sur l'abonnement (`ping` compris), est la seule parade.
   */
  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      logger.warn('kova ipc watchdog declenche', { ms: WATCHDOG_MS });
      this.teardown('watchdog');
      this.scheduleReconnect('watchdog');
    }, WATCHDOG_MS);
    this.watchdog.unref?.();
  }

  private onSubLine(line: string): void {
    this.armWatchdog();
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    // Snapshot initial de `subscribe` : {ok:true, data:{events, app_active, focus, panes}}
    if (typeof msg['ok'] === 'boolean' && msg['data'] !== undefined) {
      this.emit('snapshot', msg['data']);
      return;
    }
    if (typeof msg['event'] === 'string') this.emit('event', msg);
  }

  // ------------------------------------------------------------------
  // Connexions de requete, jetables
  // ------------------------------------------------------------------

  /**
   * ATTENTION : point d'entree des commandes de LECTURE et de controle.
   * `send-keys` est refuse ici : la seule voie d'ecriture vers un pane est `KeyGate`.
   */
  request(payload: Record<string, unknown>): Promise<KovaResponse> {
    if (payload['cmd'] === 'send-keys') {
      throw new IpcError('FORBIDDEN_ACTION', 'send-keys must go through KeyGate');
    }
    return this.#enqueue(payload);
  }

  /**
   * Mise en file SANS garde. Methode privee ES (`#`) : inaccessible hors de cette
   * classe, meme par `(ipc as any)`. Le seul acces exterieur est le canal brut a usage
   * unique (`claimRawChannel`), reclame par `sendKeys.ts`. L'ancienne methode publique
   * publique sans garde pouvait etre appelee de n'importe ou (K1).
   */
  static {
    rawChannel = (ipc, payload) => ipc.#enqueue(payload);
  }

  #enqueue(payload: Record<string, unknown>): Promise<KovaResponse> {
    return new Promise((resolve, reject) => {
      const pending: Pending = { payload, resolve, reject };
      if (this.status === 'up' && this.socketPath) {
        this.queue.push(pending);
        this.pump();
        return;
      }
      // Reconnexion en cours (reveil, abonnement ferme) : on attend, borne.
      if (!this.stopped && this.status === 'reconnecting') {
        this.queue.push(pending);
        this.armWait(pending);
        return;
      }
      reject(new IpcError('KOVA_DOWN', 'Kova is unreachable'));
    });
  }

  private pump(): void {
    if (this.busy || this.queue.length === 0) return;
    const path = this.socketPath;
    // Pas de connexion : la file attend `up` (voir `setStatus`), chaque requete bornee.
    if (!path || this.status !== 'up') return;
    const next = this.queue.shift();
    if (!next) return;
    if (next.waitTimer) clearTimeout(next.waitTimer);
    next.waitTimer = undefined;
    this.busy = true;
    this.runOne(next, path).finally(() => {
      this.busy = false;
      this.pump();
    });
  }

  /**
   * Une seule nouvelle tentative, en tete de file, apres la reconnexion si elle est en
   * cours. Rend `false` si la requete a deja ete rejouee : l'appelant la fait echouer.
   */
  private requeue(pending: Pending): boolean {
    if (pending.retried || this.stopped || this.status === 'down') return false;
    pending.retried = true;
    this.queue.unshift(pending);
    if (this.status !== 'up') this.armWait(pending);
    return true;
  }

  /**
   * Une requete, une connexion, une reponse, et on ferme.
   *
   * La fermeture par le serveur est le cas NOMINAL sur ce chemin : Kova coupe toute
   * connexion inactive depuis 5 s. Elle ne produit donc ni journal, ni backoff, ni
   * changement d'etat. Si elle survient AVANT la reponse, c'est en revanche une erreur
   * de la requete seule, remontee a son appelant.
   */
  private runOne(pending: Pending, path: string): Promise<void> {
    return new Promise<void>((done) => {
      const lines = new LineBuffer();
      const sock = connect(path);
      let settled = false;
      /** Vrai des que la requete est ecrite : avant, la rejouer est toujours sans risque. */
      let written = false;
      /**
       * Echec de connexion : rejouee une fois si rien n'est parti (socket refuse pendant un
       * reveil), ou si c'est une lecture pure. Une ecriture deja partie n'est JAMAIS rejouee
       * ici : Kova a pu l'executer, c'est a l'appelant de relire l'etat (voir `resume.ts`).
       */
      const failOrRetry = (err: IpcError): void =>
        finish(() => {
          const safe = !written || IDEMPOTENT_COMMANDS.has(String(pending.payload['cmd']));
          if (safe && this.requeue(pending)) {
            logger.info('requete IPC rejouee apres une coupure', { cmd: pending.payload['cmd'], written, err: err.message });
            return;
          }
          pending.reject(err);
        });

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        fn();
        done();
      };

      const timer = setTimeout(() => {
        finish(() => pending.reject(new IpcError('IPC_TIMEOUT', 'Kova did not answer within 5 s')));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();

      sock.setEncoding('utf8');
      sock.on('connect', () => {
        written = true;
        sock.write(`${JSON.stringify(pending.payload)}\n`);
      });
      sock.on('data', (chunk: string) => {
        let parsed: string[];
        try {
          parsed = lines.push(chunk);
        } catch (e) {
          return finish(() => pending.reject(e as Error));
        }
        const first = parsed[0];
        if (first === undefined) return;
        finish(() => {
          try {
            pending.resolve(JSON.parse(first) as KovaResponse);
          } catch (e) {
            pending.reject(
              new IpcError('INTERNAL', `unreadable IPC answer: ${(e as Error).message}`),
            );
          }
        });
      });
      sock.on('error', (e) => {
        failOrRetry(new IpcError('KOVA_DOWN', e.message));
      });
      sock.on('close', () => {
        // Fermeture avant reponse : la requete echoue (ou est rejouee si c'est sans
        // risque), mais l'abonnement, lui, n'est pas concerne et rien n'est replanifie.
        failOrRetry(new IpcError('KOVA_DOWN', 'connection closed before the answer'));
      });
    });
  }

  private async expectOk(payload: Record<string, unknown>): Promise<unknown> {
    const res = await this.request(payload);
    if (!res.ok) throw new IpcError(mapIpcError(res.error ?? ''), res.error ?? 'erreur IPC');
    return res.data;
  }

  /** V1 : `list-panes` et `list-tabs` renvoient `data` en TABLEAU DIRECT. */
  async listPanes(): Promise<Record<string, unknown>[]> {
    const data = await this.expectOk({ cmd: 'list-panes' });
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  async listTabs(): Promise<Record<string, unknown>[]> {
    const data = await this.expectOk({ cmd: 'list-tabs' });
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  /**
   * Interrogation par identifiant, JAMAIS `"all"` : la charge croit lineairement avec
   * le nombre de panes. Le champ de reponse s'appelle `panes` (pluriel).
   */
  async getPaneContent(paneIds: number[]): Promise<PaneContent[]> {
    const data = (await this.expectOk({
      cmd: 'get-pane-content',
      panes: paneIds,
      mode: 'visible',
      trim_trailing_blank_lines: true,
    })) as { panes?: PaneContent[] } | undefined;
    return data?.panes ?? [];
  }

  /**
   * Sondage des commandes : on envoie `{"cmd":"<nom>"}` sans argument et on observe la
   * forme de l'erreur. `unknown command:` signale une absence, tout autre message une
   * presence avec de mauvais arguments. Seul repli praticable pour l'exigence PRD 5.5.
   */
  async probeCommands(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const cmd of PROBED_COMMANDS) {
      try {
        const res = await this.request({ cmd });
        out[cmd] = !/^unknown command/i.test(res.error ?? '');
      } catch {
        out[cmd] = false;
      }
    }
    return out;
  }
}
