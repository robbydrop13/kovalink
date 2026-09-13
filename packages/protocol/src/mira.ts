/**
 * Navigateur : le miroir de Mira sur l'iPhone. Contrat partage, SOURCE UNIQUE DE VERITE.
 *
 * Quand un agent sur le Mac bute sur un flux web (connexion, consentement OAuth, captcha,
 * un bouton a cliquer), Robin termine le geste depuis le telephone : le daemon capture
 * l'onglet de Mira, l'app affiche l'image, et chaque tap ou touche repart vers la socket
 * de Mira. Rien n'est ecrit ici sur le disque du Mac, et Mira n'est jamais mis au premier
 * plan (`focus-app` n'est appele nulle part).
 */

/** Un onglet de Mira, tel que `GET /v1/mira/tabs` le rend, toutes fenetres confondues. */
export interface MiraTab {
  /** UUID stable de l'onglet, cle de toutes les autres routes. */
  id: string;
  windowId: string;
  title: string;
  url: string;
  /** Onglet visible de sa fenetre. */
  active: boolean;
  /** Dans la barre mais pas charge : une capture le reveille d'abord (`activate`). */
  asleep: boolean;
}

/** `available: false` (200) : la socket de Mira est absente, l'app le dit sans erreur. */
export interface MiraTabsResponse {
  available: boolean;
  tabs: MiraTab[];
}

/**
 * Une image de l'onglet. `width` et `height` sont en pixels ecran (Retina 2x), `cssWidth`
 * et `cssHeight` en pixels CSS : les clics se donnent en CSS, l'app convertit.
 */
export interface MiraFrameResponse {
  /** Octets de l'image en base64. */
  image: string;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  url: string;
  title: string;
}

/** Touches acceptees par `{kind: 'key'}`, en plus d'un caractere imprimable seul. */
export const MIRA_KEYS: readonly string[] = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
] as const;

export const MIRA_MODIFIERS = ['shift', 'ctrl', 'alt', 'meta'] as const;
export type MiraModifier = (typeof MIRA_MODIFIERS)[number];

/** Plafond d'un texte tape en une fois. */
export const MIRA_TEXT_MAX = 2000;
/** Un defilement est borne a +/- 4000 px CSS par action. */
export const MIRA_SCROLL_MAX = 4000;

/**
 * Corps de `POST /v1/mira/tabs/:tabId/act`. Coordonnees en pixels CSS. Le daemon valide
 * chaque variante (touche dans la liste, texte borne, URL http/https) avant de parler a
 * Mira, et audite la nature du geste, jamais le texte tape.
 */
export type MiraAction =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string; modifiers?: MiraModifier[] }
  | { kind: 'scroll'; dy: number }
  | { kind: 'nav'; url: string }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'reload' }
  | { kind: 'activate' };

export type MiraActionKind = MiraAction['kind'];

export interface MiraActResponse {
  ok: true;
}
