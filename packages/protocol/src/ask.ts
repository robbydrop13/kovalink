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
  /**
   * `decision` pour une fiche de decisions, absent ou `null` pour une question simple.
   * Optionnels : un daemon ou un Kova anterieurs ne les envoient pas.
   */
  kind?: string | null;
  /** La page de la fiche (un artifact), http(s) seulement. S'ouvre dans le panneau. */
  url?: string | null;
  /** Vrai pour une fiche native de Kova : son contenu se lit par `ROUTES.askSheet`. */
  sheet?: boolean;
}

/** Un lien de la fiche, http(s). */
export interface SheetLink {
  label: string;
  url: string;
}

/** Une option d'une decision. `reco` marque la recommandation (une au plus). */
export interface SheetOption {
  id: string;
  label: string;
  detail?: string;
  reco?: boolean;
}

export interface SheetDecision {
  id: string;
  title: string;
  group?: string;
  context?: string;
  options: SheetOption[];
}

/** Une fiche de decisions native de Kova (`kova ask --decisions`), telle que Kova la valide. */
export interface DecisionSheet {
  title: string;
  intro?: string;
  links?: SheetLink[];
  decisions: SheetDecision[];
}

/** Le choix qui veut dire « aucune de ces options » : la note est la reponse. */
export const SHEET_OTHER = 'other';

/** Une reponse du brouillon : un id d'option ou `other`, et/ou une note. */
export interface SheetDecisionAnswer {
  id: string;
  choice?: string;
  note?: string;
}

/** Le brouillon tel que Kova le garde : les decisions dans l'ordre de la fiche. */
export interface SheetDraft {
  decisions: SheetDecisionAnswer[];
  note?: string;
}

/** Reponse de `GET /v1/asks/:askId/sheet` (`get-sheet` de Kova). */
export interface AskSheetResponse {
  id: string;
  from: string;
  message: string;
  askedAtMs: number;
  followUp: boolean;
  sheet: DecisionSheet;
  draft: SheetDraft;
}

/**
 * Les reponses envoyees a Kova, dans la forme de sa page (`Sheet::answers_from`) : un
 * objet par id de decision. Elles REMPLACENT le brouillon : une decision absente est
 * effacee, donc l'etat entier part a chaque envoi.
 */
export interface SheetAnswersPayload {
  decisions: Record<string, { choice?: string; note?: string }>;
  note?: string;
}

/**
 * Corps de `POST /v1/asks/:askId/sheet`. `done: false` garde un brouillon ;
 * `done: true` repond, et les decisions restees ouvertes deviennent une question de suite.
 */
export interface AskSheetAnswerRequest {
  answers: SheetAnswersPayload;
  done: boolean;
  nonce?: string;
}

export interface AskSheetAnswerResponse {
  title: string;
  summary: string;
  answered: number;
  total: number;
  done: boolean;
  /** La question de suite qui garde les decisions restees ouvertes. */
  followUp: string | null;
}

/** Plafond d'une note de la fiche, le meme que celui de Kova (`MAX_NOTE`, en caracteres). */
export const SHEET_NOTE_MAX = 8000;

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
