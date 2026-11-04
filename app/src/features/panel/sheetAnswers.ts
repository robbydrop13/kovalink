// Les reponses d'une fiche de decisions, de l'ecran au corps envoye a Kova. Pur, teste
// sous Node.
//
// Kova lit la forme de sa propre page (`Sheet::answers_from`) : un objet par id de
// decision, `{choice, note}`, plus une note globale. Ce qui part REMPLACE le brouillon :
// l'etat entier part donc a chaque envoi, et une decision sans choix ni note n'y figure
// pas (elle reste ouverte).
import {
  SHEET_NOTE_MAX,
  SHEET_OTHER,
  type DecisionSheet,
  type SheetAnswersPayload,
  type SheetDraft,
} from '@/protocol';

export interface DecisionState {
  /** Un id d'option, `other`, ou `null` tant que rien n'est choisi. */
  choice: string | null;
  note: string;
}

export interface SheetState {
  decisions: Record<string, DecisionState>;
  note: string;
}

const EMPTY: DecisionState = { choice: null, note: '' };

/** L'etat de l'ecran a partir du brouillon de Kova (decisions en tableau). */
export function stateFromDraft(draft: SheetDraft | null | undefined): SheetState {
  const decisions: Record<string, DecisionState> = {};
  for (const a of draft?.decisions ?? []) {
    decisions[a.id] = { choice: a.choice ?? null, note: a.note ?? '' };
  }
  return { decisions, note: draft?.note ?? '' };
}

export function decisionState(state: SheetState, id: string): DecisionState {
  return state.decisions[id] ?? EMPTY;
}

/** Un tap sur l'option deja choisie la decoche : on peut revenir a « ouvert ». */
export function choose(state: SheetState, id: string, choice: string): SheetState {
  const current = decisionState(state, id);
  const next = current.choice === choice ? null : choice;
  return { ...state, decisions: { ...state.decisions, [id]: { ...current, choice: next } } };
}

export function setNote(state: SheetState, id: string, note: string): SheetState {
  const current = decisionState(state, id);
  return { ...state, decisions: { ...state.decisions, [id]: { ...current, note } } };
}

const cap = (s: string): string => [...s.trim()].slice(0, SHEET_NOTE_MAX).join('');

/**
 * Le corps de `answer-sheet`, borne a ce que la fiche demande : decisions connues,
 * choix parmi leurs options ou `other`, notes coupees au plafond de Kova.
 */
export function answersPayload(sheet: DecisionSheet, state: SheetState): SheetAnswersPayload {
  const decisions: SheetAnswersPayload['decisions'] = {};
  for (const d of sheet.decisions) {
    const a = state.decisions[d.id];
    if (!a) continue;
    const valid = a.choice !== null && (a.choice === SHEET_OTHER || d.options.some((o) => o.id === a.choice));
    const note = cap(a.note);
    if (!valid && note.length === 0) continue;
    decisions[d.id] = { ...(valid ? { choice: a.choice as string } : {}), ...(note.length > 0 ? { note } : {}) };
  }
  const note = cap(state.note);
  return { decisions, ...(note.length > 0 ? { note } : {}) };
}

/** Combien de decisions ont une reponse (un choix ou une note), comme Kova les compte. */
export function answeredCount(sheet: DecisionSheet, state: SheetState): number {
  return Object.keys(answersPayload(sheet, state).decisions).length;
}
