// Traitement d'une action rapide de notification.
//
// Ce module tourne aussi bien au premier plan qu'au démarrage à froid, dans le peu de temps
// qu'iOS accorde. Il n'utilise donc que HTTP : ouvrir un WebSocket consommerait la moitié du
// budget en poignée de main.
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

import {
  NOTIFICATION_ACTION,
  parseAnswerActionId,
  promptDeepLinkPath,
  sessionDeepLinkPath,
  type OptionKind,
  type PushPayload,
} from '@/protocol';
import { HttpError, fetchPrompt } from '@/net/http';
import { t } from '@/i18n/en';
import { answerPrompt } from '@/actions/answer';
import { interruptPane } from '@/actions/interrupt';
import { activeHostId, listHosts, setPendingRoute, takePendingRoute } from '@/store/credentials';
import { switchHost } from '@/net/hostSwitch';
import {
  parsePendingRoute,
  pendingPathFor,
  routeForHost,
  serializePendingRoute,
  type NotificationGesture,
  type HostRoute,
} from './hostRoute';

/**
 * Une notification locale de compte rendu, sans son, qui remplace celle d'origine. `data`
 * lui donne la charge d'origine : la toucher l'ouvre alors comme la bannière d'origine.
 */
async function notice(body: string, active = false, data?: PushPayload): Promise<void> {
  try {
    await scheduleNotice(body, active, data);
  } catch {
    // Un compte rendu qui n'arrive pas ne doit jamais faire échouer l'action elle même.
  }
}

async function scheduleNotice(body: string, active: boolean, data?: PushPayload): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: t.notifTitle,
      body,
      sound: false,
      interruptionLevel: active ? 'active' : 'passive',
      ...(data ? { data: data as unknown as Record<string, unknown> } : {}),
    },
    trigger: null,
  });
}

/**
 * URL d'ouverture, construite pour l'environnement RÉELLEMENT en cours.
 *
 * Le schéma `kovalink://` n'est enregistré que dans un build : dans Expo Go, l'app vit
 * sous `exp://<hôte>:8081/--/…` et ouvrir `kovalink://…` échoue. Le daemon envoie donc un
 * CHEMIN, et `Linking.createURL` y colle le schéma actif. On ne retombe sur l'URL brute
 * du daemon que si cette construction échoue.
 */
function deepLinkPathFor(data: PushPayload): string {
  return (
    data.deepLinkPath ??
    (data.paneId !== undefined
      ? sessionDeepLinkPath(data.paneId)
      : data.promptRef
        ? promptDeepLinkPath(data.promptRef)
        : '/')
  );
}

function deepLinkFor(data: PushPayload): string {
  const path = deepLinkPathFor(data);
  try {
    return Linking.createURL(path);
  } catch {
    return data.deepLink ?? path;
  }
}

/** Ouvre un lien sans jamais faire échouer l'action qui l'a déclenché. */
async function openDeepLink(data: PushPayload): Promise<void> {
  const url = deepLinkFor(data);
  try {
    await Linking.openURL(url);
  } catch (e) {
    // Un `openURL` qui rejette remontait jusqu'au `void handleNotificationResponse(...)`
    // de l'appelant, c'est à dire nulle part : l'action semblait ne rien faire du tout.
    console.warn('[KovaLink] deep link open failed', url, describe(e));
    await notice(t.notifOpenFailed(describe(e)), true);
  }
}

/**
 * Résout la référence opaque. R3 : elle reste valable jusqu'à résolution du prompt ou
 * 10 minutes, elle n'est pas à usage unique. Trois consommateurs la lisent légitimement,
 * la NSE, l'action rapide et le lien profond, et l'usage unique cassait toutes les actions
 * rapides dès la première notification.
 */
async function resolvePaneId(data: PushPayload): Promise<number | null> {
  if (typeof data.paneId === 'number') return data.paneId;
  if (!data.promptRef) return null;
  try {
    const prompt = await fetchPrompt(data.promptRef, 3000);
    return prompt.paneId;
  } catch (e) {
    // La cause part au journal : un compte rendu « Mac injoignable » sur une référence
    // expirée envoyait chercher un problème réseau qui n'existait pas.
    console.warn('[KovaLink] promptRef resolution failed', describe(e));
    return null;
  }
}

/**
 * Le Mac qui a sonné face au Mac actif (`hostRoute.ts`). Une lecture de trousseau qui
 * échoue rend le comportement d'origine : sans Mac actif lisible, rien d'autre ne marche.
 */
async function hostRouteFor(data: PushPayload, gesture: NotificationGesture): Promise<HostRoute> {
  if (typeof data.host !== 'string' || data.host.length === 0) return { kind: 'here' };
  try {
    const [activeId, hosts] = await Promise.all([activeHostId(), listHosts()]);
    return routeForHost({ payloadHost: data.host, activeId, hosts, gesture });
  } catch (e) {
    console.warn('[KovaLink] host lookup failed', describe(e));
    // Même règle que `routeForHost` sans Mac actif lisible : une action rapide n'agit pas.
    return gesture === 'action' ? { kind: 'openApp', hostName: null } : { kind: 'here' };
  }
}

/**
 * Ouverture d'une bannière d'un autre Mac : ranger le pane à ouvrir, puis changer de Mac.
 * Le changement recharge l'app, et `openPendingRoute` ouvre le pane une fois l'app prête.
 */
async function switchThenOpen(data: PushPayload, hostId: string): Promise<void> {
  try {
    await setPendingRoute(
      serializePendingRoute({ host: hostId, path: deepLinkPathFor(data), at: Date.now() }),
    );
    await switchHost(hostId);
  } catch (e) {
    await setPendingRoute(null).catch(() => undefined);
    console.warn('[KovaLink] switch from notification failed', describe(e));
    await notice(t.notifSwitchFailed(describe(e)), true);
  }
}

/**
 * Une seule lecture par chargement du bundle. Lire puis effacer au trousseau n'est pas
 * atomique : deux appels rapprochés (effet rejoué) liraient la même route et ouvriraient
 * le pane deux fois. La réponse de notification elle même n'est pas rejouée après le
 * rechargement (expo-notifications 57 vide sa file native dès qu'un écouteur l'a reçue).
 */
let pendingRouteTaken = false;

/** Appelé quand l'app est prête : ouvre le pane d'une notification d'un autre Mac. */
export async function openPendingRoute(): Promise<void> {
  if (pendingRouteTaken) return;
  pendingRouteTaken = true;
  try {
    const raw = await takePendingRoute();
    if (!raw) return;
    const path = pendingPathFor(parsePendingRoute(raw), await activeHostId(), Date.now());
    if (!path) return;
    await Linking.openURL(Linking.createURL(path));
  } catch (e) {
    console.warn('[KovaLink] pending route open failed', describe(e));
  }
}

/** Message court et EXACT, destiné à une bannière. */
function describe(e: unknown): string {
  if (e instanceof HttpError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const data = response.notification.request.content.data as unknown as PushPayload;
  const actionId = response.actionIdentifier;

  if (!data) return;

  // Tap sur le corps de la bannière : ouverture par défaut d'iOS. Testé AVANT la
  // référence de prompt : une question d'agent (`kind: 'ask'`) n'en porte pas, et la
  // garde d'origine la rendait muette au tap, son seul geste.
  if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER || actionId === NOTIFICATION_ACTION.open) {
    const route = await hostRouteFor(data, 'open');
    if (route.kind === 'switch') {
      await switchThenOpen(data, route.hostId);
      return;
    }
    // Mac retiré du registre : son pane n'existe pas ici, on ouvre l'app sans le viser.
    await openDeepLink(route.kind === 'openRoot' ? { kind: data.kind, deepLinkPath: '/' } : data);
    return;
  }

  // Tout ce qui suit répond à un prompt : sans référence opaque, rien à faire.
  if (typeof data.promptRef !== 'string' || data.promptRef.length === 0) return;

  // Une action rapide pour un autre Mac n'agit pas : le compte rendu porte la charge
  // d'origine, le toucher change de Mac et ouvre le pane.
  const route = await hostRouteFor(data, 'action');
  if (route.kind === 'openApp') {
    await notice(
      route.hostName ? t.notifOtherMacOpenApp(route.hostName) : t.notifOpenAppToAct,
      true,
      data,
    );
    return;
  }

  if (actionId === NOTIFICATION_ACTION.interrupt) {
    const paneId = await resolvePaneId(data);
    if (paneId === null) {
      await notice(t.notifMacUnreachableOpenApp, true);
      return;
    }
    try {
      await interruptPane(paneId, { haptics: false });
      await Notifications.dismissNotificationAsync(response.notification.request.identifier);
      await notice(t.notifInterrupted);
    } catch (e) {
      await notice(t.notifInterruptFailed(describe(e)), true);
    }
    return;
  }

  const optionIndex = parseAnswerActionId(actionId);
  if (optionIndex === null) return;

  // La NSE a écrit le hash et l'awaitingSince dans le userInfo. S'ils manquent, elle a
  // échoué : on n'envoie rien et on ouvre l'app. On n'approuve jamais une question dont on
  // n'a pas la charge décisionnelle.
  const paneId = await resolvePaneId(data);
  if (paneId === null || !data.promptHash || !data.awaitingSince) {
    await openDeepLink(data);
    return;
  }

  const kinds = data.optionKinds ?? [];
  const optionKind: OptionKind = kinds[optionIndex - 1] ?? 'neutral';

  // Face ID a déjà été demandé par iOS avant de nous réveiller sur une action numérotée
  // (`isAuthenticationRequired: true`). On ne le redemande pas ici, sauf sur une option dont
  // la nature est inconnue et que la catégorie statique ne pouvait pas protéger autrement.
  const outcome = await answerPrompt({
    paneId,
    optionIndex,
    optionKind: optionKind === 'reject' ? 'reject' : optionKind,
    optionLabel: t.notifOptionLabel(optionIndex),
    promptHash: data.promptHash,
    awaitingSince: data.awaitingSince,
  });

  if (!outcome.ok) {
    if (outcome.kind === 'cancelled') {
      await notice(t.notifAnswerCancelled, true);
    } else if (outcome.kind === 'refused') {
      // Le Mac a répondu et a refusé : rien n'est en file, rien ne repartira.
      await notice(t.notifAnswerRefused(outcome.cause), true);
    } else {
      await notice(t.notifAnswerUnreachable(outcome.cause), true);
    }
    return;
  }

  if (outcome.result.applied) {
    await Notifications.dismissNotificationAsync(response.notification.request.identifier);
    await notice(t.notifAnswerSent(optionIndex));
    return;
  }

  await notice(
    outcome.result.reason === 'prompt_changed' ? t.notifPromptChanged : t.notifAlreadyAnswered,
    true,
  );
}
