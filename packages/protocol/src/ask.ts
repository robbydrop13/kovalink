/**
 * Les questions des agents (`kova ask`), telles que le telephone les voit.
 *
 * Kova affiche la question d'un agent sur une carte, en haut a droite de l'ecran du
 * Mac, et l'agent attend la reponse. Tant qu'elle n'existait que la, une question
 * posee pendant que Robin n'etait pas devant son Mac bloquait l'agent jusqu'a son
 * retour. Le daemon lit donc la carte (`list-asks`) et la sert ici.
 *
 * SOURCE UNIQUE DE VERITE de la forme des questions cote frontiere. Le daemon traduit
 * le JSON de Kova (en `snake_case`, horodatages en secondes) vers ces champs, une seule
 * fois, dans `daemon/src/kova/asks.ts` : ni l'app ni les routes ne relisent la forme
 * de Kova.
 */

/** Une question en attente sur la carte de Kova. */
export interface AskItem {
  /** UUID, tel que `kova ask` l'a fabrique. C'est lui qui nomme la question partout. */
  id: string;
  /** Qui demande : le nom affiche sur la carte (par defaut le dossier de l'agent). */
  from: string;
  message: string;
  /**
   * Les boutons que la question declare, dans l'ordre ; le premier est celui que la
   * carte du Mac tinte et que l'Entree choisit. Repondre exige l'UN d'eux, au
   * caractere pres : c'est ce mot que l'agent relit.
   */
  buttons: string[];
  /** La question accepte un texte libre en plus du bouton. */
  input: boolean;
  askedAtMs: number;
  /** 0 quand la question n'est pas remise a plus tard, sinon l'instant de son retour. */
  snoozedUntilMs: number;
  /** Faux tant qu'elle est remise a plus tard : la carte du Mac ne l'affiche pas. */
  due: boolean;
  /**
   * L'agent attend encore sur la socket. Faux une fois son delai ecoule : la reponse
   * lui sera livree par Kova (tapee dans son pane, ou en reouvrant sa conversation),
   * ce qui prend plus longtemps mais n'est jamais perdu.
   */
  waiting: boolean;
  sessionId: string | null;
  cwd: string | null;
}

/** Un delai propose pour remettre une question a plus tard. Vient de Kova. */
export interface AskSnoozeChoice {
  label: string;
  seconds: number;
}

/** Reponse de `GET /v1/asks`, et charge du message `asks` du WebSocket. */
export interface AsksResponse {
  asks: AskItem[];
  snoozeChoices: AskSnoozeChoice[];
  /**
   * Faux quand le Kova qui tourne ne connait pas `list-asks` (anterieur a cette
   * fonction) : l'app le dit au lieu d'afficher une liste vide, qui se lirait comme
   * « aucune question ».
   */
  supported: boolean;
}

/**
 * Corps de `POST /v1/asks/:askId/answer`.
 *
 * `action` est un des `buttons` de la question, jamais une chaine libre : Kova le
 * refuse sinon, parce que ce mot finit retape dans un terminal. `text` est le champ
 * libre de la carte, facultatif.
 */
export interface AskAnswerRequest {
  action: string;
  text?: string;
  nonce?: string;
}

/** Corps de `POST /v1/asks/:askId/snooze`. Kova plafonne le delai a 24 h. */
export interface AskSnoozeRequest {
  seconds: number;
  nonce?: string;
}

export interface AskSnoozeResponse {
  snoozedUntilMs: number;
}

/** Plafond du texte libre, le meme que celui de Kova (`ask::ANSWER_TEXT_MAX`). */
export const ASK_TEXT_MAX = 8 * 1024;

/** Chemin profond d'une question. Le daemon et l'app le derivent tous deux d'ici. */
export function askDeepLinkPath(askId: string): string {
  return `/ask/${encodeURIComponent(askId)}`;
}
