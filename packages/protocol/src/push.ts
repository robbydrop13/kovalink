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
export type PushKind =
  | 'turn_end'
  | 'awaiting'
  | 'done'
  | 'closed'
  | 'reconnect'
  | 'aggregate'
  /**
   * Question d'un agent (`kova ask`). La SEULE charge utile sans `promptRef` : la NSE
   * en exige un et rend la notification telle quelle sans lui, ce qui est exactement
   * ce qu'il faut ici. Elle porte donc deja sa categorie et son texte definitifs, et
   * rien de la question elle meme.
   */
  | 'ask';

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
  /**
   * Reference opaque, valable jusqu'a resolution du prompt ou 10 minutes (R3).
   *
   * ABSENTE pour `kind: 'ask'`, et c'est voulu des deux cotes : la NSE n'agit que sur
   * une charge qui en porte une (sans elle, elle rend la notification telle quelle,
   * deja ecrite), et l'action rapide de l'app ne repond qu'a un prompt. Une chaine
   * vide ne ferait pas l'affaire : elle passerait les deux gardes et la NSE afficherait
   * « la question n'a pas pu etre recuperee » sur une banniere parfaitement lisible.
   */
  promptRef?: string;
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

/**
 * Les nombres du cadran du poignet, seuls dans un push SILENCIEUX.
 *
 * Le daemon l'envoie avec `aps: { "content-available": 1 }`, sans alerte, sans son et
 * sans badge : rien ne s'affiche, l'app se reveille et met le cadran a jour. Aucun
 * texte de question, aucun nom de pane, aucune chaine autre que `t` ne doit y entrer.
 *
 * `asks` est le meme compte que `waitsOnYou` (permissions et questions ouvertes),
 * `errors` les panes sur une erreur API, `ended` les questions ouvertes dont la session
 * n'existe plus, et `oldestAt` la seconde epoch de la plus ancienne des deux premieres.
 */
export interface CountsPush {
  t: 'counts';
  asks: number;
  errors: number;
  ended: number;
  /** La plus ancienne permission ou question ouverte, en secondes epoch. */
  oldestAt: number | null;
  /** Instant de composition du push, en secondes epoch. */
  at: number;
}
