// Prompts par pane, et cycle de vie de la barre de validation (design 4.3.5).
//
// Rappel de cadrage (D1) : sur la machine de Robin, Kova ne lève jamais `awaiting`. Le
// daemon le synthétise lui même sur le front descendant de `pane-working` quand l'écran
// correspond à la grammaire des fixtures réelles : l'état `parsed` arrive alors avec ses
// options, son `promptHash` et son `awaitingSince`. `turn_end` et `unparsable` restent des
// chemins nominaux, pas des cas d'erreur.
import { PROMPT_AGING_MS, type Prompt } from '@/protocol';
import { create } from 'zustand';
import { kvGet, kvSet } from '@/db';

/**
 * Cache des prompts lisibles (docs/16, 6.5) : la liste hors ligne montre les non lus du
 * dernier état connu. Rien n'est marqué lu depuis ce cache sans affichage.
 */
const PROMPTS_KEY = 'prompts.byPane';
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(byPane: () => Record<number, Prompt>): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const live = Object.fromEntries(Object.entries(byPane()).filter(([, p]) => p.state !== 'none'));
    void kvSet(PROMPTS_KEY, live);
  }, 500);
}

/**
 * Phases pilotées par l'app. Les états `unparsable`, `unavailable` et `aging` du design ne
 * sont pas stockés : ils se dérivent respectivement du prompt, de la liaison et du temps.
 */
export type BarPhase =
  | 'hidden'
  | 'entering'
  | 'armed'
  | 'authenticating'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'hash_mismatch'
  | 'expired';

interface PromptsState {
  byPane: Record<number, Prompt>;
  phase: Record<number, BarPhase>;
  /** Option en cours d'envoi, pour afficher le spinner sur le bon bouton. */
  pendingIndex: Record<number, number>;
  notice: Record<number, string | null>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPrompt: (prompt: Prompt) => void;
  /** Panes disparus d'un instantané : leurs prompts n'ont plus de sens. */
  keepOnly: (paneIds: readonly number[]) => void;
  setPhase: (paneId: number, phase: BarPhase, pendingIndex?: number) => void;
  setNotice: (paneId: number, notice: string | null) => void;
  clear: (paneId: number) => void;
}

export const usePrompts = create<PromptsState>((set, get) => ({
  byPane: {},
  phase: {},
  pendingIndex: {},
  notice: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const stored = (await kvGet<Record<number, Prompt>>(PROMPTS_KEY).catch(() => null)) ?? {};
    // Ce que le Mac a déjà dit depuis le lancement l'emporte sur le cache.
    set((s) => ({ byPane: { ...stored, ...s.byPane }, hydrated: true }));
  },

  keepOnly: (paneIds) => {
    const alive = new Set(paneIds);
    const byPane = Object.fromEntries(Object.entries(get().byPane).filter(([id]) => alive.has(Number(id))));
    if (Object.keys(byPane).length === Object.keys(get().byPane).length) return;
    set({ byPane });
    schedulePersist(() => get().byPane);
  },

  setPrompt: (prompt) => {
    const paneId = prompt.paneId;
    const previous = get().byPane[paneId];
    if (prompt.state === 'none') {
      // `awaiting` est retombé : Robin a répondu sur son Mac, ou l'agent est reparti.
      const wasOpen = previous && previous.state !== 'none';
      set((s) => ({
        byPane: { ...s.byPane, [paneId]: prompt },
        phase: { ...s.phase, [paneId]: wasOpen ? 'expired' : 'hidden' },
        notice: { ...s.notice, [paneId]: null },
      }));
      schedulePersist(() => get().byPane);
      return;
    }
    // Une nouvelle question repasse par `entering`, donc par une nouvelle fenêtre
    // d'armement de 400 ms (design 4.3.4).
    const sameQuestion =
      previous &&
      previous.state === 'parsed' &&
      prompt.state === 'parsed' &&
      previous.promptHash === prompt.promptHash;
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: prompt },
      phase: { ...s.phase, [paneId]: sameQuestion ? (s.phase[paneId] ?? 'armed') : 'entering' },
    }));
    schedulePersist(() => get().byPane);
  },

  setPhase: (paneId, phase, pendingIndex) =>
    set((s) => ({
      phase: { ...s.phase, [paneId]: phase },
      pendingIndex:
        pendingIndex === undefined
          ? s.pendingIndex
          : { ...s.pendingIndex, [paneId]: pendingIndex },
    })),

  setNotice: (paneId, notice) => set((s) => ({ notice: { ...s.notice, [paneId]: notice } })),

  clear: (paneId) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { state: 'none', paneId } },
      phase: { ...s.phase, [paneId]: 'hidden' },
      notice: { ...s.notice, [paneId]: null },
    })),
}));

/** Le composer est verrouillé tant qu'un prompt PARSÉ est ouvert (C23, design 4.5). */
export function isComposerLocked(prompt: Prompt | undefined): boolean {
  return prompt?.state === 'parsed';
}

/** Texte libre autorisé mais sous Face ID : `awaiting` sans options lisibles. */
export function requiresFaceIdForText(prompt: Prompt | undefined): boolean {
  return prompt?.state === 'unparsable';
}

/** Attente de plus de `PROMPT_AGING_MS` : le losange et le compteur passent en `status.error`. */
export function isAgingSince(awaitingSince: string, now = Date.now()): boolean {
  const since = Date.parse(awaitingSince);
  return Number.isFinite(since) && now - since > PROMPT_AGING_MS;
}

export function isAging(prompt: Prompt | undefined, now = Date.now()): boolean {
  if (!prompt || prompt.state === 'none') return false;
  // Une fin de tour ne porte pas d'`awaitingSince` : rien n'attend une validation,
  // l'horodatage pertinent est celui de la fin du tour. Le typage discriminé nous
  // oblige à le dire explicitement, et c'est tant mieux.
  const since = prompt.state === 'turn_end' ? prompt.endedAt : prompt.awaitingSince;
  return isAgingSince(since, now);
}
