/**
 * Table fermee des touches autorisees (PRD B4).
 *
 * C'est la SEULE facon de designer une touche dans tout le projet, daemon et app
 * confondus. Aucun texte libre ne descend jamais jusqu'au terminal par ce chemin :
 * le texte libre passe par `pane.sendText`, assaini puis emballe en bracketed paste.
 */
export const KEY_TABLE = {
  esc: '\x1b',
  tab: '\t',
  enter: '\r',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  digit1: '1',
  digit2: '2',
  digit3: '3',
  slash: '/',
  at: '@',
  ctrl_c: '\x03',
} as const;

export type KeyName = keyof typeof KEY_TABLE;

export const KEY_NAMES = Object.keys(KEY_TABLE) as KeyName[];

/** Garde de type : rien d'autre que la table fermee ne franchit la frontiere. */
export function isKeyName(value: unknown): value is KeyName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KEY_TABLE, value);
}

/**
 * Touches capables de valider une option d'un prompt sans passer par le `promptHash`.
 * Elles sont gardees par `KeyGate` des qu'un prompt parse est en attente (C23).
 */
export const DECIDING_KEYS: readonly KeyName[] = ['enter', 'digit1', 'digit2', 'digit3'];

/** Plafond de touches par requete sur `POST /v1/panes/:paneId/terminal`. */
export const TERMINAL_MAX_KEYS = 16;

/**
 * Corps de `POST /v1/panes/:paneId/terminal`, l'un OU l'autre :
 * - `text` : une ligne tapee dans le pane puis l'Entree (assainie, une seule ligne) ;
 * - `keys` : des touches de la table fermee, de 1 a `TERMINAL_MAX_KEYS`.
 * Reponse : `ActionResponse`. Les touches decisives et le texte sont refuses (403
 * `FORBIDDEN_KEY`) quand un prompt parse attend : on repond avec les boutons.
 */
export type PaneTerminalRequest = { text: string; keys?: undefined } | { keys: KeyName[]; text?: undefined };
