// Enregistrement de la tâche de réponse aux notifications.
//
// Elle est définie AVANT tout rendu React (voir index.js) : iOS peut relancer un processus
// mort pour livrer une action rapide et n'accorde que quelques secondes.
// Ce module est chargé par `index.js` AVANT tout rendu React. Une exception ici éteindrait
// l'app avant même que React ne démarre, sans rien afficher : tout y est donc protégé, et
// rien n'y est tenté quand le push n'est pas disponible (Expo Go).
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { bootLog, bootWarn, pushAvailable } from '@/env';
import { handleNotificationResponse } from './quickAction';

export const NOTIF_RESPONSE_TASK = 'kl-notification-response';

export function registerBackgroundNotificationTask(): void {
  if (!pushAvailable) {
    bootLog('background task skipped, no remote push in this environment');
    return;
  }
  try {
    TaskManager.defineTask(NOTIF_RESPONSE_TASK, async ({ data, error }) => {
      if (error) return;
      const payload = data as { actionIdentifier?: string; notification?: unknown } | undefined;
      if (!payload?.actionIdentifier) return;
      await handleNotificationResponse(payload as unknown as Notifications.NotificationResponse);
    });
    Notifications.registerTaskAsync(NOTIF_RESPONSE_TASK).catch((error: unknown) => {
      // Sans la tâche, les actions rapides passent par le gestionnaire au premier plan.
      bootWarn('background task', error);
    });
    bootLog('background task registered');
  } catch (error) {
    bootWarn('background task', error);
  }
}

registerBackgroundNotificationTask();
