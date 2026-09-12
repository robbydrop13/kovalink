// Détection de l'environnement d'exécution.
//
// Pourquoi ce fichier existe : le push distant a été retiré d'Expo Go depuis le SDK 53.
// Dans Expo Go, `getExpoPushTokenAsync`, l'enregistrement des catégories et le badge d'icône
// échouent. Ce sont des fonctions de confort au démarrage, pas le chemin critique : elles ne
// doivent jamais empêcher l'app de s'afficher.
//
// La règle du fichier : on détecte pour prévenir l'utilisateur, mais on protège quand même
// chaque appel par un try/catch. La détection sert le bandeau, les gardes servent la
// robustesse, et les deux sont indépendantes.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { t } from '@/i18n/en';

/**
 * Vrai dans Expo Go. `executionEnvironment` vaut `storeClient` aussi bien dans Expo Go que
 * dans un build de développement : seul `appOwnership` distingue les deux, d'où son usage
 * malgré sa dépréciation.
 */
const isExpoGo: boolean =
  Constants.appOwnership === 'expo' ||
  (Constants.executionEnvironment === ExecutionEnvironment.StoreClient &&
    Constants.appOwnership !== null &&
    Constants.appOwnership !== undefined);

/** Les notifications distantes ne fonctionnent que dans un build, jamais dans Expo Go. */
export const pushAvailable: boolean = Platform.OS === 'ios' && !isExpoGo;

/** Libellé unique, affiché à l'identique dans Sessions et dans Réglages. */
export const PUSH_UNAVAILABLE_LABEL: string = t.pushUnavailable;

/**
 * Les extensions iOS (Share Extension comme Notification Service Extension) n'existent que
 * dans un build : Expo Go n'embarque pas de cibles supplémentaires. C'est attendu, et cela
 * se dégrade comme le push, par un bandeau explicatif et rien de bloquant.
 */
export const shareExtensionAvailable: boolean = Platform.OS === 'ios' && !isExpoGo;

export const SHARE_EXTENSION_UNAVAILABLE_LABEL: string = t.shareExtensionUnavailable;

const PREFIX = '[KovaLink boot]';

/** Trace de démarrage. Elle sert à savoir OÙ le démarrage s'arrête, pas à faire joli. */
export function bootLog(step: string, detail?: unknown): void {
  if (detail === undefined) console.log(`${PREFIX} ${step}`);
  else console.log(`${PREFIX} ${step}`, detail);
}

export function bootWarn(step: string, error: unknown): void {
  console.warn(`${PREFIX} ${step} failed`, error instanceof Error ? error.message : error);
}
