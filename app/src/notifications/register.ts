// Notifications : autorisation, catégories statiques, jeton Expo, écouteurs.
//
// GARDE GÉNÉRALE : aucun appel à `expo-notifications` ne peut casser le démarrage. Le push
// distant a été retiré d'Expo Go depuis le SDK 53, donc dans Expo Go la demande de jeton et
// l'enregistrement des catégories échouent par construction. Ailleurs, ils peuvent échouer
// pour d'autres raisons (autorisation refusée, module indisponible). Dans les deux cas, la
// conséquence doit être la même : une fonctionnalité en moins, un bandeau qui l'explique, et
// une app qui démarre.
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { bootLog, bootWarn, pushAvailable } from '@/env';
import { registerNotificationCategories } from './categories';
import { handleNotificationResponse } from './quickAction';
import { setPushToken } from '@/net/connection';
import { usePrefs } from '@/store/prefs';

// Le gestionnaire de premier plan est posé paresseusement, jamais à l'import du module : une
// exception au chargement d'un module remonte jusqu'à l'entrée et éteint l'app en silence.
let handlerInstalled = false;

function installForegroundHandler(): void {
  if (handlerInstalled || !pushAvailable) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // App au premier plan : aucune bannière système, un bandeau interne à la place
        // (design 5.4). Le badge d'icône reste le nombre de panes en attente.
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: true,
      }),
    });
    handlerInstalled = true;
  } catch (error) {
    bootWarn('gestionnaire de notifications', error);
  }
}

export type PushSetupResult = 'granted' | 'denied' | 'unavailable' | 'error';

export async function setupNotifications(): Promise<PushSetupResult> {
  if (Platform.OS !== 'ios') return 'unavailable';
  if (!pushAvailable) {
    // Expo Go. On ne demande rien, on n'enregistre rien, on ne pose aucun badge. Le bandeau
    // de l'écran Sessions et des Réglages dit pourquoi.
    bootLog('notifications ignorées, environnement sans push distant');
    return 'unavailable';
  }

  installForegroundHandler();

  // Les catégories sont posées AVANT toute demande de jeton : une bannière ne doit jamais
  // référencer une catégorie qui n'existe pas encore.
  try {
    await registerNotificationCategories();
  } catch (error) {
    bootWarn('catégories de notification', error);
    return 'error';
  }

  try {
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true, allowProvisional: false },
      });
      status = asked.status;
    }
    if (status !== 'granted') return 'denied';
  } catch (error) {
    bootWarn('autorisation de notification', error);
    return 'error';
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId: String(projectId) } : undefined,
    );
    setPushToken(token.data);
    bootLog('jeton de push obtenu');
    return 'granted';
  } catch (error) {
    bootWarn('jeton de push', error);
    return 'error';
  }
}

/**
 * Écouteurs de premier plan. Le démarrage à froid passe par la tâche de fond de `index.js`.
 * Rend une fonction de désabonnement, qui ne lève jamais.
 */
export function subscribeToNotifications(): () => void {
  if (!pushAvailable) return () => undefined;
  installForegroundHandler();

  const subscriptions: { remove: () => void }[] = [];
  try {
    subscriptions.push(
      Notifications.addNotificationResponseReceivedListener((response) => {
        void handleNotificationResponse(response);
      }),
    );
    subscriptions.push(
      Notifications.addNotificationReceivedListener(() => {
        usePrefs.getState().noteNotification();
      }),
    );
  } catch (error) {
    bootWarn('écouteurs de notification', error);
  }

  return () => {
    for (const s of subscriptions) {
      try {
        s.remove();
      } catch {
        /* rien */
      }
    }
  };
}

export async function setBadge(count: number): Promise<void> {
  if (!pushAvailable) return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // Le badge est un confort. Il ne justifie aucun message d'erreur.
  }
}
