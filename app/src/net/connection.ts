// Orchestrateur de la liaison. Singleton, vit hors de React.
//
// Ordre de reprise imposé par docs/03-architecture.md 3.5 : `hello` avec l'etag, puis
// `panes.subscribe`, puis `pane.peek` sur le pane affiché, puis `session.attach` sur la
// SEULE session visible. L'app ne s'abonne jamais aux sessions non visibles.
import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import Constants from 'expo-constants';

import type { PushRegister, S2C } from '@/protocol';
import { PROTOCOL_VERSION } from '@/protocol';
import { Socket, nextId } from './ws';
import { resumeActions } from './resume';
import { loadCredentials, rotateToken } from '@/store/credentials';
import { useConnection } from '@/store/connection';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';
import { useReads } from '@/store/reads';
import { useReorder } from '@/store/reorder';
import { staleMarks } from '@/features/sessions/unread';
import { useSession } from '@/store/session';
import { useScreens } from '@/store/screen';
import { usePrefs, type Prefs } from '@/store/prefs';
import { flushOutbox } from '@/actions/outboxRunner';
import { bootLog, bootWarn } from '@/env';
import { t } from '@/i18n/en';

let socket: Socket | null = null;
let deviceId: string | null = null;
let netSub: { remove: () => void } | null = null;
let appSub: { remove: () => void } | null = null;
let visiblePaneId: number | null = null;
let visibleSessionId: string | null = null;
let pushToken: string | null = null;
/** Vrai quand l'app est à l'écran. En arrière plan, aucun pane n'est « au premier plan ». */
let appActive = AppState.currentState === 'active';
/** Passage en arrière plan, pour juger au retour si le socket peut encore être vivant. */
let backgroundedAt: number | null = null;
/** Coupure en cours : « Mac injoignable » n'est dit qu'après ce délai sans reconnexion. */
let unreachableTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Une coupure réseau se reconnecte le plus souvent en moins d'une seconde. Avant ce
 * délai, la liaison est « connecting » : pas de bandeau, la barre de validation reste.
 */
export const UNREACHABLE_AFTER_MS = 8_000;
export { BACKGROUND_RECONNECT_AFTER_MS } from './resume';

function clearUnreachableTimer(): void {
  if (unreachableTimer) clearTimeout(unreachableTimer);
  unreachableTimer = null;
}

/** Signal de premier plan porté par chaque ping (A1, CA-31). */
function foregroundPaneId(): number | null {
  return appActive ? visiblePaneId : null;
}

const appVersion = Constants.expoConfig?.version ?? '1.0.0';

function handle(msg: S2C): void {
  const conn = useConnection.getState();
  switch (msg.t) {
    case 'hello.ok': {
      clearUnreachableTimer();
      conn.setDaemonVersion(msg.daemonVersion);
      conn.setKova(msg.kova.status);
      conn.setLink(msg.link.relay ? 'relayed' : 'direct', msg.link.relay);
      conn.markSynced();
      if (msg.token) void rotateToken(msg.token);
      socket?.send({ t: 'panes.subscribe', id: nextId() });
      if (visiblePaneId !== null) socket?.send({ t: 'pane.peek', id: nextId(), paneId: visiblePaneId });
      if (visibleSessionId) socket?.send({ t: 'session.attach', id: nextId(), sessionId: visibleSessionId });
      if (pushToken) registerPush(pushToken);
      void flushOutbox();
      break;
    }
    case 'pong':
      // La latence est mesurée par le socket (aller-retour réel), pas par `serverTime`,
      // qui ne donne que l'écart d'horloge entre l'iPhone et le Mac.
      break;
    case 'daemon.status':
      conn.setKova(msg.kova.status);
      conn.setLink(msg.link.relay ? 'relayed' : 'direct', msg.link.relay);
      break;
    case 'panes.snapshot': {
      usePanes.getState().applySnapshot({
        panes: msg.panes,
        tabs: msg.tabs,
        etag: msg.etag,
        appActive: msg.appActive,
        focusPaneId: msg.focusPaneId,
      });
      // Un ordre posé par glisser-déposer est retiré dès que le Mac le montre.
      useReorder.getState().reconcile(msg.tabs, msg.panes);
      // Cmd+J : les marques de lecture et les prompts des panes disparus sont purgés.
      const alive = msg.panes.map((p) => p.id);
      useReads.getState().forget(staleMarks(useReads.getState().byPane, msg.panes));
      usePrompts.getState().keepOnly(alive);
      conn.markSynced();
      break;
    }
    case 'pane.event':
      usePanes.getState().applyEvent(msg);
      if (msg.ev === 'pane-close') {
        useReads.getState().forget([msg.paneId]);
        usePrompts.getState().keepOnly(usePanes.getState().panes.map((p) => p.id));
      }
      break;
    case 'prompt': {
      usePrompts.getState().setPrompt(msg.prompt);
      // Compteur `Questions illisibles` de l'écran Réglages (design 4.3.6).
      if (msg.prompt.state === 'unparsable') usePrefs.getState().bumpCounter('parseFailed');
      break;
    }
    case 'session.snapshot':
      useSession.getState().applySnapshot(msg.sessionId, msg.meta, msg.turns, msg.hasMoreBefore);
      break;
    case 'session.append':
      useSession.getState().applyAppend(msg.sessionId, msg.turns, msg.replaceIds);
      break;
    case 'session.closed':
      useSession.getState().markClosed(msg.sessionId);
      break;
    case 'pane.screen.ok':
      useScreens.getState().set(msg.screen);
      break;
    case 'error':
      // Le message du daemon est TOUJOURS conservé : il porte la cause. Le remplacer par
      // un libellé fixe (« Transcript illisible ») masquait aussi bien un fichier absent
      // qu'un refus d'accès ou un pane fermé.
      bootWarn(`daemon error message (${msg.code})`, msg.message);
      if (msg.code === 'KOVA_DOWN') conn.setKova('down');
      else if (msg.code === 'SESSION_NOT_FOUND' || msg.code === 'IO_ERROR') {
        useSession.getState().fail(t.linkDaemonError(msg.code, msg.message));
      } else conn.setError(t.linkDaemonError(msg.code, msg.message));
      break;
    default:
      // Message inconnu : ignoré silencieusement, jamais une erreur bloquante (C12).
      break;
  }
}

async function online(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false;
  } catch {
    return true;
  }
}

export async function startConnection(): Promise<void> {
  if (socket) return;
  const creds = await loadCredentials();
  if (!creds) {
    bootLog('connection skipped, not paired');
    return;
  }
  deviceId = creds.deviceId;

  const conn = useConnection.getState();
  conn.setLink((await online()) ? 'connecting' : 'offline');

  socket = new Socket(`wss://${creds.tsDns}:${creds.port}/ws`, creds.token, {
    onOpen: () => {
      socket?.send({
        t: 'hello',
        id: nextId(),
        protocol: PROTOCOL_VERSION as 1,
        deviceId: creds.deviceId,
        appVersion,
        platform: 'ios',
        ...(pushToken ? { expoPushToken: pushToken } : {}),
        resume: { ...(usePanes.getState().etag ? { panesEtag: usePanes.getState().etag as string } : {}) },
      });
    },
    onMessage: handle,
    onLatency: (ms) => useConnection.getState().setLatency(ms),
    foregroundPaneId,
    onClose: (reason) => {
      void (async () => {
        const state = useConnection.getState();
        if (!(await online())) state.setLink('offline');
        else if (reason === 'auth') state.setError(t.linkPairingRefused);
        else {
          // Coupure : on se reconnecte en silence. Le bandeau n'apparaît que si ça dure.
          state.setLink('connecting');
          clearUnreachableTimer();
          unreachableTimer = setTimeout(() => {
            unreachableTimer = null;
            if (!socket?.isOpen) useConnection.getState().setLink('macUnreachable');
          }, UNREACHABLE_AFTER_MS);
        }
      })();
    },
  });
  // Une URL invalide ou un module réseau indisponible ne doit pas empêcher l'app de
  // s'afficher : la pastille de liaison dira `Mac injoignable`, et le cache reste lisible.
  try {
    socket.connect();
    bootLog('connection started', `wss://${creds.tsDns}:${creds.port}/ws`);
  } catch (error) {
    bootWarn('WebSocket open', error);
    useConnection.getState().setLink('macUnreachable');
  }

  try {
    netSub = Network.addNetworkStateListener((event) => {
      if (event.isConnected === false) {
        useConnection.getState().setLink('offline');
      } else if (!socket?.isOpen) {
        useConnection.getState().setLink('connecting');
        socket?.reconnectNow();
      }
    });
  } catch (error) {
    bootWarn('network listener', error);
  }

  appSub = AppState.addEventListener('change', (status: AppStateStatus) => {
    appActive = status === 'active';
    if (status === 'active') {
      const away = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
      backgroundedAt = null;
      // Écran de session ouvert : on remet la surveillance serrée avant tout le reste.
      socket?.setFastPing(visibleSessionId !== null);
      // La décision vit dans `resume.ts`, testable sans React Native. `reconnect` est
      // seul : le `hello.ok` de la connexion neuve rejoue l'abonnement, le `peek` et
      // l'attache. Sinon on redemande TOUT ce qui est visible, même après dix secondes
      // d'absence : un simple ping ne rattrapait rien de ce qui s'était perdu.
      for (const action of resumeActions({
        open: socket?.isOpen === true,
        awayMs: away,
        visiblePaneId,
        visibleSessionId,
      })) {
        if (action === 'reconnect') {
          useConnection.getState().setLink('connecting');
          socket?.reconnectNow();
        } else if (action === 'ping') socket?.pingNow();
        else if (action === 'panes.subscribe') socket?.send({ t: 'panes.subscribe', id: nextId() });
        else if (action === 'pane.peek' && visiblePaneId !== null) peek(visiblePaneId);
        else if (action === 'session.attach' && visibleSessionId) attachSession(visibleSessionId, true);
      }
      return;
    }
    if (backgroundedAt === null) backgroundedAt = Date.now();
    // Arrière plan : la surveillance serrée n'a plus de raison d'être, la batterie compte.
    socket?.setFastPing(false);
    // Téléphone verrouillé ou app quittée : le daemon doit cesser de croire que Robin lit
    // ce pane, sinon la prochaine fin de tour ne vibre pas. Ping immédiat, pane à null.
    socket?.pingNow();
  });
}

export function stopConnection(): void {
  clearUnreachableTimer();
  socket?.close();
  socket = null;
  netSub?.remove();
  appSub?.remove();
  netSub = null;
  appSub = null;
  visiblePaneId = null;
  visibleSessionId = null;
}

export function currentDeviceId(): string | null {
  return deviceId;
}

/**
 * Les TROIS réglages traversent la frontière, pas deux. `keepMacAwake` était stocké sur
 * l'iPhone et jamais transmis : le daemon lisait son propre `preventSleep`, et
 * l'interrupteur des Réglages était un placebo (CA-126). La forme envoyée est dérivée du
 * type `Prefs` tout entier pour qu'un quatrième réglage ne puisse pas être oublié à son tour.
 */
function prefsForDaemon(prefs: Prefs): PushRegister['prefs'] {
  return {
    onlyValidations: prefs.onlyValidations,
    quietHours: prefs.quietHours,
    keepMacAwake: prefs.keepMacAwake,
  };
}

function registerPush(token: string): void {
  socket?.send({
    t: 'push.register',
    id: nextId(),
    expoPushToken: token,
    prefs: prefsForDaemon(usePrefs.getState().prefs),
  });
}

export function setPushToken(token: string): void {
  pushToken = token;
  registerPush(token);
}

/**
 * Réglage modifié : on le renvoie tout de suite. Sans jeton de push (Expo Go), le message
 * part quand même avec un jeton vide : le daemon doit lire les réglages, et l'anti-veille
 * en particulier ne dépend pas des notifications.
 */
export function republishPrefs(): void {
  registerPush(pushToken ?? '');
}

/** Repli monospace : demande l'écran visible du pane. Faux si la liaison est coupée. */
export function requestScreen(paneId: number): boolean {
  return socket?.send({ t: 'pane.screen', id: nextId(), paneId }) ?? false;
}

/** `Ouvrir sur le Mac` (A8, CA-11) : `focus-pane`, la seule commande hors KeyGate avec le statut. */
export function focusPaneOnMac(paneId: number): boolean {
  return socket?.send({ t: 'pane.cmd', id: nextId(), paneId, cmd: { cmd: 'focus-pane' } }) ?? false;
}

/** Relecture explicite d'un prompt : ouverture d'écran, tirer pour rafraîchir, reprise. */
export function peek(paneId: number): void {
  socket?.send({ t: 'pane.peek', id: nextId(), paneId });
}

export function setVisiblePane(paneId: number | null): void {
  visiblePaneId = paneId;
  if (paneId !== null) peek(paneId);
  // L'écran change : le signal de premier plan part sans attendre le prochain cycle.
  socket?.pingNow();
}

/**
 * `force` sert au retour au premier plan : sans lui, le retour anticipé sur « même
 * session » empêchait toute réattache, même en remontant l'écran. Le magasin de session,
 * lui, ne se réinitialise pas pour la même session : aucun clignotement.
 */
export function attachSession(sessionId: string, force = false): void {
  if (visibleSessionId === sessionId && !force) return;
  if (visibleSessionId && visibleSessionId !== sessionId) {
    socket?.send({ t: 'session.detach', id: nextId(), sessionId: visibleSessionId });
  }
  visibleSessionId = sessionId;
  useSession.getState().attach(sessionId);
  socket?.send({ t: 'session.attach', id: nextId(), sessionId });
  // Écran de session ouvert : ping serré, un seul pong manqué reconnecte.
  socket?.setFastPing(true);
}

export function detachSession(): void {
  if (visibleSessionId) socket?.send({ t: 'session.detach', id: nextId(), sessionId: visibleSessionId });
  visibleSessionId = null;
  useSession.getState().detach();
  socket?.setFastPing(false);
}

export function forceReconnect(): void {
  socket?.reconnectNow();
}
