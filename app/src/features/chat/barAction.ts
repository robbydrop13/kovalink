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
  | { kind: 'send'; enabled: boolean }
  | { kind: 'stop' }
  | { kind: 'busy' }
  | { kind: 'none' };

/**
 * L'action du bouton rond de droite, trois états et un vide (règle du 12 septembre, soir) :
 * - envoi de pièces ou transcription en cours : `busy` ;
 * - du contenu (texte ou pièces) : `send`, agent au repos OU en travail (envoyer met en
 *   file, comme Claude) ; Stop reste alors à portée dans le bandeau d'état en haut ;
 * - agent en travail et champ vide : `stop` ;
 * - champ vide, agent au repos : rien, la pilule se termine par le champ.
 * Le micro n'est PAS ici : c'est un bouton fantôme permanent à gauche, à côté du `plus`.
 */
export function barAction(s: BarInput): BarAction {
  if (s.recording || s.transcribing || s.sending) return { kind: 'busy' };
  if (s.hasText || s.hasAttachments) return { kind: 'send', enabled: !s.locked && !s.disabled };
  if (s.working && !s.locked && !s.disabled) return { kind: 'stop' };
  return { kind: 'none' };
}

/** Le micro : toujours visible, actif hors verrou, hors indisponibilité et hors occupation ; atténué avec du texte. */
export function micState(s: BarInput): { enabled: boolean; dimmed: boolean } {
  return { enabled: !s.locked && !s.disabled && !s.sending && !s.transcribing, dimmed: s.hasText || s.hasAttachments };
}

/** Le texte peut-il être édité ? Verrouillé, indisponible, en envoi ou en enregistrement : non. */
export function canEdit(s: BarInput): boolean {
  return !s.locked && !s.disabled && !s.sending && !s.recording;
}
