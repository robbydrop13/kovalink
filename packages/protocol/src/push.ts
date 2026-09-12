import type { NotificationCategory } from './notifications.js';
import type { OptionKind } from './prompt.js';

/**
 * Schema d'URL de l'app, tel que declare dans `app.json`. Il vit ici parce que le daemon
 * l'ecrivait en dur dans la charge utile du push.
 *
 * ATTENTION : ce schema n'est enregistre que dans un BUILD. Dans Expo Go, l'app est
 * servie sous `exp://<hote>:8081/--/...`, et ouvrir `kovalink://...` echoue. C'est
 * pourquoi le daemon transporte un CHEMIN et non une URL, et pourquoi l'app reconstruit
 * l'URL avec `Linking.createURL`, qui connait le schema reellement actif.
 */
export const APP_URL_SCHEME = 'kovalink';

/** Chemin profond d'un prompt. Le daemon et l'app le derivent tous deux d'ici. */
export function promptDeepLinkPath(promptRef: string): string {
  return `/prompt/${encodeURIComponent(promptRef)}`;
}

/** Chemin profond d'une session. */
export function sessionDeepLinkPath(paneId: number): string {
  return `/session/${paneId}`;
}

/**
 * Nature de l'evenement pousse. Le corps, lui, est toujours reecrit par la NSE.
 * `aggregate` : plafond horaire atteint, la banniere ne porte aucune reference de
 * prompt utile et ouvre la liste filtree sur EN ATTENTE (PRD 4.4).
 */
export type PushKind = 'turn_end' | 'awaiting' | 'done' | 'closed' | 'reconnect' | 'aggregate';

/**
 * Charge utile `data` d'une notification (le `userInfo` cote iOS).
 *
 * A14 et C24 : AUCUN contenu de conversation, AUCUN `paneId` ecrit par le daemon.
 * Seule la reference opaque transite. Les champs de la seconde moitie sont ecrits par
 * la Notification Service Extension, apres avoir recupere le prompt sur le canal
 * chiffre direct, et jamais par le daemon.
 *
 * Ce type est partage parce que trois processus l'ecrivent ou le lisent : le daemon,
 * la NSE et la tache d'action rapide de l'app.
 */
export interface PushPayload {
  kind: PushKind;
  /** Reference opaque, valable jusqu'a resolution du prompt ou 10 minutes (R3). */
  promptRef: string;
  /** Nom du projet, deja present dans le titre. Sert de sous-titre de repli a la NSE. */
  project?: string;
  /** Titre de l'onglet Kova. Jamais l'`ai-title`, qui est genere depuis le contenu. */
  tab?: string;
  issuedAt?: number;
  /**
   * URL complete, valable uniquement dans un BUILD (schema `kovalink://`). Conservee pour
   * la NSE et les clients qui ne savent pas reconstruire. L'app lui prefere `deepLinkPath`.
   */
  deepLink?: string;
  /** CHEMIN seul, sans schema. C'est ce que l'app doit utiliser (voir `APP_URL_SCHEME`). */
  deepLinkPath?: string;
  /** Categorie visee une fois le contenu recupere. La charge porte toujours le pire cas. */
  targetCategory?: NotificationCategory;

  // --- Ecrits par la NSE uniquement -----------------------------------------
  paneId?: number;
  promptHash?: string;
  awaitingSince?: string;
  optionCount?: number;
  optionKinds?: OptionKind[];
}
