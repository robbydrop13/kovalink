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

/** Une notification locale de compte rendu, sans son, qui remplace celle d'origine. */
async function notice(body: string, active = false): Promise<void> {
  try {
    await scheduleNotice(body, active);
  } catch {
    // Un compte rendu qui n'arrive pas ne doit jamais faire échouer l'action elle même.
  }
}

async function scheduleNotice(body: string, active: boolean): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: t.notifTitle,
      body,
      sound: false,
      interruptionLevel: active ? 'active' : 'passive',
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
function deepLinkFor(data: PushPayload): string {
  const path =
    data.deepLinkPath ??
    (data.paneId !== undefined
      ? sessionDeepLinkPath(data.paneId)
      : promptDeepLinkPath(data.promptRef));
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

  if (!data || typeof data.promptRef !== 'string') return;

  // Tap sur le corps de la bannière : ouverture par défaut d'iOS.
  if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER || actionId === NOTIFICATION_ACTION.open) {
    await openDeepLink(data);
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
