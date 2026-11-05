// La file d'attention (`attn`) telle que l'onglet Asks la tient. Relue au montage, puis
// toutes les 10 s tant que l'onglet est affiche (le daemon garde sa lecture autant), et
// des que le compte `waitsOnYou` du daemon bouge : une entree `now` ouverte ou fermee sur
// le Mac le fait bouger. Le dernier instantane reste en memoire, pour un retour immediat.
//
// Rien n'est cache sur disque, comme les questions : une entree n'a de sens que vivante.
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import type { AttentionButton, AttentionEntry } from '@/protocol';
import { ATTENTION_SEND } from '@/protocol';
import { fetchAttention } from '@/net/http';
import { actOnAttention } from '@/actions/attention';
import { useAsks } from '@/store/asks';
import { t } from '@/i18n/en';
import { phaseAfterSendFailure, type AttentionPhase } from './attention';

const POLL_MS = 10_000;

interface AttentionState {
  /** `null` tant qu'aucune lecture n'a reussi : rien ne s'affiche, pas d'etat vide. */
  entries: AttentionEntry[] | null;
  phase: Record<string, AttentionPhase>;
  notice: Record<string, string | null>;
  load: () => Promise<void>;
  act: (id: string, button: AttentionButton) => Promise<void>;
}

/** Reponse tardive : seule la derniere lecture partie a le droit d'ecrire la liste. */
let generation = 0;

export const useAttentionStore = create<AttentionState>((set, get) => ({
  entries: null,
  phase: {},
  notice: {},

  load: async () => {
    const mine = ++generation;
    try {
      const res = await fetchAttention();
      if (mine !== generation) return;
      // Les gestes des entrees fermees n'ont plus d'objet.
      const alive = new Set(res.entries.map((e) => e.id));
      set((s) => ({
        entries: res.entries,
        phase: keepKeys(s.phase, alive),
        notice: keepKeys(s.notice, alive),
      }));
    } catch {
      // Un daemon plus ancien (404) ou `attn` en echec : on garde ce qu'on avait. Une
      // file qui n'a jamais ete lue ne s'affiche pas, elle ne se lit pas comme vide.
    }
  },

  act: async (id, button) => {
    const current = get().phase[id];
    if (current === 'sending') return;
    // Un `Envoyer` parti, ou peut etre parti, ne repart pas d'ici.
    if (button === ATTENTION_SEND && (current === 'sent' || current === 'unknown')) return;
    set((s) => ({ phase: { ...s.phase, [id]: 'sending' }, notice: { ...s.notice, [id]: null } }));
    const out = await actOnAttention(id, button);
    if (!out.ok && button === ATTENTION_SEND) {
      const phase = phaseAfterSendFailure(out.kind, out.status, out.code);
      set((s) => ({
        phase: { ...s.phase, [id]: phase },
        notice: { ...s.notice, [id]: phase === 'failed' ? t.attnFailed(out.cause) : null },
      }));
      if (phase !== 'failed') void get().load();
      return;
    }
    if (!out.ok) {
      set((s) => ({
        phase: { ...s.phase, [id]: out.kind === 'gone' ? 'idle' : 'failed' },
        notice: { ...s.notice, [id]: out.kind === 'gone' ? null : t.attnFailed(out.cause) },
      }));
      if (out.kind === 'gone') void get().load();
      return;
    }
    // `Envoyer` laisse l'entree ouverte jusqu'a ce que le chief la ferme : elle passe en
    // « envoye » pour qu'un second appui ne renvoie rien. Une fermeture la retire.
    if (button === ATTENTION_SEND) set((s) => ({ phase: { ...s.phase, [id]: 'sent' } }));
    else {
      set((s) => ({
        entries: s.entries?.filter((e) => e.id !== id) ?? null,
        phase: { ...s.phase, [id]: 'idle' },
      }));
    }
    void get().load();
  },
}));

function keepKeys<T>(record: Record<string, T>, alive: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => alive.has(id)));
}

/** Le rafraichissement de l'onglet : montage, 10 s, et chaque changement du compte du daemon. */
export function useAttention(): AttentionState['entries'] {
  const entries = useAttentionStore((s) => s.entries);
  const load = useAttentionStore((s) => s.load);
  const waits = useAsks((s) => s.waitsOnYou);
  const reload = useCallback(() => void load(), [load]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    if (waits !== null) reload();
  }, [waits, reload]);
  return entries;
}
