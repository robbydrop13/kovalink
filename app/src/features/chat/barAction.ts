// La barre de message (docs/02 4.5, refonte du 12 septembre) : UN bouton d'action à
// droite, dont le contenu dépend de l'état. Décision pure, testée : elle ne dépend d'aucun
// composant, et c'est elle qui garantit qu'il n'y a jamais deux boutons ni un libellé.
export interface BarInput {
  /** Prompt parsé ouvert : la pilule est grisée, l'explication remplace le placeholder. */
  locked: boolean;
  /** Pane fermé ou sans agent : rien ne peut partir. */
  disabled: boolean;
  /** L'agent travaille : Stop, quel que soit le contenu du champ. */
  working: boolean;
  hasText: boolean;
  hasAttachments: boolean;
  /** Envoi avec pièces en cours : le champ est figé. */
  sending: boolean;
  /** Transcription vocale en cours. */
  transcribing: boolean;
  /** Enregistrement en cours : la pilule devient une barre d'enregistrement. */
  recording: boolean;
}

export type BarAction =
  | { kind: 'mic'; enabled: boolean }
  | { kind: 'send'; enabled: boolean }
  | { kind: 'stop' }
  | { kind: 'busy' }
  | { kind: 'none' };

/**
 * L'action du bouton rond de droite :
 * - enregistrement ou transcription en cours : `busy` (le geste est ailleurs) ;
 * - agent au travail : `stop`, même avec du texte (on prépare la suite en tapant) ;
 * - du contenu (texte ou pièces) : `send`, actif hors verrou et hors envoi ;
 * - sinon `mic`, actif hors verrou et hors indisponibilité.
 */
export function barAction(s: BarInput): BarAction {
  if (s.recording || s.transcribing || s.sending) return { kind: 'busy' };
  if (s.working && !s.locked) return { kind: 'stop' };
  if (s.hasText || s.hasAttachments) return { kind: 'send', enabled: !s.locked && !s.disabled };
  if (s.disabled) return { kind: 'none' };
  return { kind: 'mic', enabled: !s.locked };
}

/** Le texte peut-il être édité ? Verrouillé, indisponible, en envoi ou en enregistrement : non. */
export function canEdit(s: BarInput): boolean {
  return !s.locked && !s.disabled && !s.sending && !s.recording;
}
