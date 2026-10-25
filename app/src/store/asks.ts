// Les questions des agents (`kova ask`), telles que l'app les tient.
//
// Une question est posee par un agent sur la carte de Kova, sur le Mac, et l'agent attend
// la reponse. Tant qu'elle n'existait que la, une question posee pendant que Robin etait
// ailleurs bloquait l'agent jusqu'a son retour : c'est exactement ce que KovaLink sert a
// eviter. Le daemon diffuse la liste a chaque changement, l'app REMPLACE la sienne.
//
// Rien n'est cache sur disque : une question n'a de sens que vivante. Hors ligne, mieux
// vaut ne rien montrer que proposer de repondre a une question peut etre deja reglee.
import type { AskItem, AskSnoozeChoice } from '@/protocol';
import { create } from 'zustand';

/** Etat d'un geste en cours sur UNE question. */
export type AskPhase = 'idle' | 'sending' | 'sent' | 'failed';

interface AsksState {
  asks: AskItem[];
  snoozeChoices: AskSnoozeChoice[];
  /** Faux quand le Kova du Mac ne connait pas encore les questions : on le dit. */
  supported: boolean;
  phase: Record<string, AskPhase>;
  notice: Record<string, string | null>;
  applySnapshot: (asks: AskItem[], snoozeChoices: AskSnoozeChoice[], supported: boolean) => void;
  setPhase: (askId: string, phase: AskPhase) => void;
  setNotice: (askId: string, notice: string | null) => void;
}

export const useAsks = create<AsksState>((set, get) => ({
  asks: [],
  snoozeChoices: [],
  supported: true,
  phase: {},
  notice: {},

  applySnapshot: (asks, snoozeChoices, supported) => {
    // Les gestes des questions disparues n'ont plus d'objet : sans ce menage, un
    // `failed` d'hier reapparaitrait sur une question qui porte le meme identifiant.
    const alive = new Set(asks.map((a) => a.id));
    set((s) => ({
      asks,
      snoozeChoices: snoozeChoices.length > 0 ? snoozeChoices : s.snoozeChoices,
      supported,
      phase: keepKeys(s.phase, alive),
      notice: keepKeys(s.notice, alive),
    }));
  },

  setPhase: (askId, phase) => set((s) => ({ phase: { ...s.phase, [askId]: phase } })),
  setNotice: (askId, notice) => {
    if (get().notice[askId] === notice) return;
    set((s) => ({ notice: { ...s.notice, [askId]: notice } }));
  },
}));

function keepKeys<T>(record: Record<string, T>, alive: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => alive.has(id)));
}

/**
 * Les questions a montrer : celles qui sont dues, la plus ancienne d'abord, comme la
 * carte du Mac. Une question remise a plus tard ne compte dans aucun bandeau, c'est tout
 * l'interet du report.
 */
export function dueAsks(asks: readonly AskItem[]): AskItem[] {
  return asks.filter((a) => a.due).sort((a, b) => a.askedAtMs - b.askedAtMs || a.id.localeCompare(b.id));
}

/** La prochaine question a traiter, celle qu'ouvre le bandeau. */
export function nextAsk(asks: readonly AskItem[]): AskItem | null {
  return dueAsks(asks)[0] ?? null;
}

/**
 * Les questions reportees et leur heure de retour, pour les montrer sous les autres :
 * un report doit rester visible, sinon il se lit comme un abandon.
 */
export function snoozedAsks(asks: readonly AskItem[]): AskItem[] {
  return asks.filter((a) => !a.due).sort((a, b) => a.snoozedUntilMs - b.snoozedUntilMs);
}
