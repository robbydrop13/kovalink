/**
 * Catalogue des categories et des actions de notification (defaut R1).
 *
 * SOURCE UNIQUE DE VERITE. Le daemon choisit la categorie, l'app les enregistre
 * statiquement au lancement, la Notification Service Extension ne fait que choisir
 * parmi celles-ci. Personne ne redeclare ces identifiants ailleurs : un identifiant
 * inconnu d'iOS donnerait une banniere sans bouton, en silence.
 *
 * Le PRD fait foi (09-decision-finale, D2/R1) sur le vocabulaire. Les noms `KL_OPT2`,
 * `KL_OPT3` et `KL_OPEN` de l'architecture sont abandonnes.
 *
 * Le FORMAT des identifiants d'action vit ici lui aussi : le daemon, l'app et la NSE
 * doivent encoder `answer:<index>` exactement de la meme facon, sans quoi une action
 * rapide ne serait jamais reconnue au retour.
 */

/** Les seuls endroits ou ces chaines sont ecrites. */
export const NOTIFICATION_CATEGORY = {
  /** L'agent a fini son tour. Le cas dominant du lot 1 (D1). */
  TURN_END: 'KL_TURN_END',
  /** Prompt parse a 2 options. */
  AWAITING_2: 'KL_AWAITING_2',
  /** Prompt parse a 3 options. */
  AWAITING_3: 'KL_AWAITING_3',
  /** NSE en echec, parsing impossible, ou plus de 3 options. Aucune action d'option. */
  AWAITING_BLIND: 'KL_AWAITING_BLIND',
  /** Tache terminee sans question (N2). */
  DONE: 'KL_DONE',
  /** Pane ferme alors qu'un agent travaillait (N3, lot 2). */
  CLOSED: 'KL_CLOSED',
  /** Daemon de nouveau joignable avec des actions en file (N4, lot 2). */
  RECONNECT: 'KL_RECONNECT',
  /**
   * Plafond horaire atteint (PRD 4.4, CA-32) : `{n} agents attendent`, une seule
   * banniere vivante, `Ouvrir` pour seule action.
   */
  AGGREGATE: 'KL_AGGREGATE',
} as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORY)[keyof typeof NOTIFICATION_CATEGORY];

/** Derive de la table ci-dessus : les chaines ne sont ecrites qu'une fois. */
export const NOTIFICATION_CATEGORIES = Object.values(
  NOTIFICATION_CATEGORY,
) as readonly NotificationCategory[];

/** Actions non numerotees. Les deux seules qui portent un nom fixe. */
export const NOTIFICATION_ACTION = {
  open: 'open',
  interrupt: 'interrupt',
} as const;

export type NotificationActionId =
  | (typeof NOTIFICATION_ACTION)[keyof typeof NOTIFICATION_ACTION]
  | `answer:${number}`;

/**
 * Identifiant d'une action numerotee. C'est le seul encodage admis dans tout le
 * projet : `answer:1`, `answer:2`, `answer:3`.
 *
 * Le `promptHash` n'entre PAS dans l'identifiant : les categories sont
 * pre-enregistrees statiquement au lancement de l'app, donc leurs identifiants
 * d'action sont figes avant meme qu'un prompt existe. Le hash voyage dans le
 * `userInfo`, ecrit par la NSE au moment de la recuperation.
 */
export function answerActionId(optionIndex: number): `answer:${number}` {
  return `answer:${optionIndex}`;
}

/** Reciproque stricte. Renvoie `null` sur tout ce qui n'est pas une action numerotee. */
export function parseAnswerActionId(actionId: string): number | null {
  const m = /^answer:(\d+)$/.exec(actionId);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export interface QuickAction {
  identifier: NotificationActionId;
  /** Libelle fige a l'enregistrement de la categorie. C'est le corps qui explique. */
  buttonTitle: string;
  opensAppToForeground: boolean;
  /** A2 : Face ID sur toute action qui repond, jamais sur les gestes surs. */
  authenticationRequired: boolean;
}

const OPEN: QuickAction = {
  identifier: NOTIFICATION_ACTION.open,
  buttonTitle: 'Open',
  opensAppToForeground: true,
  authenticationRequired: false,
};
const INTERRUPT: QuickAction = {
  identifier: NOTIFICATION_ACTION.interrupt,
  buttonTitle: 'Stop',
  opensAppToForeground: false,
  authenticationRequired: false,
};
const numbered = (n: number): QuickAction => ({
  identifier: answerActionId(n),
  buttonTitle: String(n),
  opensAppToForeground: false,
  authenticationRequired: true,
});

/**
 * Actions par categorie, dans l'ordre de declaration. iOS n'affiche que 4 actions :
 * `Interrompre` n'est JAMAIS retire, c'est le geste sur (C30).
 */
export const NOTIFICATION_CATEGORY_ACTIONS: Record<NotificationCategory, readonly QuickAction[]> = {
  [NOTIFICATION_CATEGORY.TURN_END]: [INTERRUPT, OPEN],
  [NOTIFICATION_CATEGORY.AWAITING_2]: [numbered(1), numbered(2), INTERRUPT],
  [NOTIFICATION_CATEGORY.AWAITING_3]: [numbered(1), numbered(2), numbered(3), INTERRUPT],
  [NOTIFICATION_CATEGORY.AWAITING_BLIND]: [INTERRUPT, OPEN],
  [NOTIFICATION_CATEGORY.DONE]: [OPEN],
  [NOTIFICATION_CATEGORY.CLOSED]: [OPEN],
  [NOTIFICATION_CATEGORY.RECONNECT]: [OPEN],
  [NOTIFICATION_CATEGORY.AGGREGATE]: [OPEN],
};

/**
 * Categorie transportee dans la charge utile APNs : toujours le pire cas.
 * Si la NSE est tuee avant d'avoir rien ecrit, la banniere qui s'affiche est celle
 * sans action d'approbation, jamais une banniere qui promet des boutons inexistants.
 */
export const DEFAULT_PUSH_CATEGORY: NotificationCategory = NOTIFICATION_CATEGORY.AWAITING_BLIND;
