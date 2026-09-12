import type { ErrorCode } from './errors.js';
import type { LinkInfo } from './link.js';
import type { KeyName } from './keys.js';
import type { Pane, PaneCommand, PaneScreen, Tab } from './pane.js';
import type { Prompt } from './prompt.js';
import type { SessionMeta, Turn } from './turn.js';

export const PROTOCOL_VERSION = 1;

// --------------------------------------------------------------------------
// Client vers serveur. Les messages marques L2 sont declares mais non traites
// par le daemon du lot 1 : ils repondent FORBIDDEN_ACTION.
// --------------------------------------------------------------------------

export interface Hello {
  t: 'hello';
  id: string;
  protocol: 1;
  deviceId: string;
  appVersion: string;
  platform: 'ios';
  expoPushToken?: string;
  /**
   * Reprise : l'app annonce l'etag du dernier instantane de panes qu'elle a en cache.
   * S'il correspond encore, le daemon repond `ack` a `panes.subscribe` au lieu de
   * renvoyer la liste complete.
   */
  resume?: { panesEtag?: string };
}
/**
 * Battement du client, toutes les `WS_PING_INTERVAL_MS`. Il porte le signal de PREMIER
 * PLAN, qui n'existait pas avant : le daemon tenait tout client pour « au premier plan »
 * a jamais, et jetait des notifications de fin de tour pour un telephone verrouille.
 */
export interface Ping {
  t: 'ping';
  id: string;
  /**
   * Pane dont l'ecran de session est affiche au moment du ping, `null` sinon (liste,
   * reglages, app en arriere plan, ecran verrouille). Le daemon n'en tient compte que
   * pendant `FOREGROUND_TTL_MS` : l'app doit donc l'envoyer A CHAQUE ping, et envoyer
   * un ping hors cycle quand l'ecran change. Avec `session.attach`, qui pose le meme
   * signal a l'ouverture, ce sont les deux seules sources du premier plan.
   */
  foregroundPaneId: number | null;
}
export interface PanesSubscribe {
  t: 'panes.subscribe';
  id: string;
}
/** Relecture explicite de l'etat interactif d'un pane (ouverture d'ecran, pull to refresh). */
export interface PanePeek {
  t: 'pane.peek';
  id: string;
  paneId: number;
}
/** Repli monospace : ~30 lignes du pane visible, pas de xterm.js en lot 1. */
export interface PaneScreenRequest {
  t: 'pane.screen';
  id: string;
  paneId: number;
}
export interface PaneCommandMsg {
  t: 'pane.cmd';
  id: string;
  paneId: number;
  cmd: PaneCommand;
}
// Il n'existe AUCUN message WS d'ecriture vers un pane. Repondre, interrompre et envoyer
// du texte passent par les routes HTTPS `paneAnswer`, `paneInterrupt` et `paneText`
// (`routes.ts`), qui portent le nonce, le limiteur et l'audit une seule fois. Les
// messages `pane.answer`, `pane.interrupt` et `pane.sendText` etaient declares ici et
// servis par le hub, mais l'app ne les a jamais emis : une surface d'ecriture en double.
export interface SessionAttach {
  t: 'session.attach';
  id: string;
  sessionId: string;
  afterSeq?: number;
  lastTurnId?: string;
  lastTurnBlockCount?: number;
}
export interface SessionDetach {
  t: 'session.detach';
  id: string;
  sessionId: string;
}
/**
 * Les reglages de l'ecran Reglages qui traversent la frontiere. Chacun est LU par le
 * daemon, sinon il n'a rien a faire ici.
 *
 * `keepMacAwake` etait range dans l'app et jamais transmis (CA-126) : le daemon lisait
 * son propre `preventSleep`. Regle A1 : l'interrupteur de l'app EST le reglage. Le
 * daemon l'ecrit dans sa config a reception et relache l'assertion en cours si elle
 * vient d'etre interdite. Il n'y a qu'un Mac : le dernier appareil qui parle a raison.
 */
export interface DevicePrefs {
  onlyValidations: boolean;
  quietHours: boolean;
  keepMacAwake: boolean;
}
export interface PushRegister {
  t: 'push.register';
  id: string;
  expoPushToken: string;
  prefs: DevicePrefs;
}
/** L2. Ne transporte PAS de string : uniquement des `KeyName` de la table fermee. */
export interface PaneSendKeys {
  t: 'pane.sendKeys';
  id: string;
  paneId: number;
  keys: KeyName[];
}
/** L2. Meme regle : aucune string libre ne passe par le terminal. */
export interface TermInput {
  t: 'term.input';
  id: string;
  paneId: number;
  keys: KeyName[];
}

export type C2S =
  | Hello
  | Ping
  | PanesSubscribe
  | PanePeek
  | PaneScreenRequest
  | PaneCommandMsg
  | SessionAttach
  | SessionDetach
  | PushRegister
  | PaneSendKeys
  | TermInput;

// --------------------------------------------------------------------------
// Serveur vers client
// --------------------------------------------------------------------------

/**
 * Etat de la liaison daemon -> Kova, tel que l'app doit l'afficher (CA-123) :
 *
 * - `up` : abonnement IPC vivant, la liste des panes fait foi ;
 * - `reconnecting` : abonnement perdu depuis moins de `KOVA_DOWN_AFTER_MS`. Kova
 *   redemarre probablement, la liste en cache reste affichee telle quelle ;
 * - `down` : aucun socket Kova depuis `KOVA_DOWN_AFTER_MS` ou plus. Le daemon a VIDE sa
 *   liste et diffuse un `panes.snapshot` vide : l'app affiche « Kova n'est pas lance »
 *   avec le bouton `Lancer Kova`. L'onglet Fichiers reste utilisable.
 */
export type KovaStatus = 'up' | 'down' | 'reconnecting';

export interface HelloOk {
  t: 'hello.ok';
  reqId: string;
  protocol: 1;
  daemonVersion: string;
  kova: { status: KovaStatus; pid: number | null; commands: Record<string, boolean> };
  /** Direct ou relaye (A11). */
  link: LinkInfo;
  serverTime: string;
  /** Renouvellement silencieux du jeton a moins de 15 jours de l'expiration. */
  token?: string;
}
export interface Pong {
  t: 'pong';
  reqId: string;
  serverTime: string;
}
export interface Ack {
  t: 'ack';
  reqId: string;
}
export interface ErrorMsg {
  t: 'error';
  reqId?: string;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}
export interface DaemonStatus {
  t: 'daemon.status';
  kova: { status: KovaStatus; pid: number | null };
  /** Rafraichi a chaque diffusion : la liaison peut basculer de relayee a directe. */
  link: LinkInfo;
  since: string;
}
export interface PanesSnapshot {
  t: 'panes.snapshot';
  appActive: boolean;
  focusPaneId: number | null;
  panes: Pane[];
  tabs: Tab[];
  /** Le client REMPLACE, il ne fusionne pas. */
  etag: string;
}
export type PaneEvent =
  | { t: 'pane.event'; ev: 'focus'; appActive: boolean; reason: string; pane: Pane | null }
  | {
      t: 'pane.event';
      ev: 'pane-status';
      paneId: number;
      awaiting: boolean;
      awaitingSince: string | null;
    }
  | { t: 'pane.event'; ev: 'pane-working'; paneId: number; working: boolean }
  | { t: 'pane.event'; ev: 'pane-open'; pane: Pane }
  | { t: 'pane.event'; ev: 'pane-close'; paneId: number; window: number; tab: number };

export interface PromptMsg {
  t: 'prompt';
  prompt: Prompt;
}
export interface PaneScreenMsg {
  t: 'pane.screen.ok';
  reqId: string;
  screen: PaneScreen;
}
export interface SessionSnapshot {
  t: 'session.snapshot';
  reqId: string;
  sessionId: string;
  meta: SessionMeta;
  turns: Turn[];
  hasMoreBefore: boolean;
}
export interface SessionAppend {
  t: 'session.append';
  sessionId: string;
  turns: Turn[];
  /** Un turn peut etre MUTABLE : 1 a 5 blocs arrivent ligne par ligne (V6). */
  replaceIds: string[];
}
export interface SessionClosed {
  t: 'session.closed';
  sessionId: string;
}

export type S2C =
  | HelloOk
  | Pong
  | Ack
  | ErrorMsg
  | DaemonStatus
  | PanesSnapshot
  | PaneEvent
  | PromptMsg
  | PaneScreenMsg
  | SessionSnapshot
  | SessionAppend
  | SessionClosed;
