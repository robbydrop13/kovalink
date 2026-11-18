// Le Cockpit tel que le telephone le tient : la file vient du magasin de la file
// d'attention (`useAttentionStore`, meme lecture et meme sondage que l'onglet Asks) ; ce
// magasin-ci garde ce que Robin fait sur les cartes : le filtre, la page, les cartes
// ouvertes, le texte tape et le brouillon reecrit (qui survivent a une relecture), les
// gestes en vol, les cartes classees cachees le temps que la file les retire, et les toasts.
//
// Les transitions sont pures et testees (`gesture.ts`) ; ce fichier ne fait que les appliquer.
import { create } from 'zustand';
import { isAttentionGesture, type AttentionEntry } from '@/protocol';
import { sendCockpitGesture, snoozeCockpitCard } from '@/actions/cockpit';
import { useAttentionStore } from '@/features/asks/useAttention';
import {
  ClientIds,
  classifyGesture,
  gesturePayload,
  newClientId,
  pruneCards,
  settleGesture,
  snoozeRequest,
  startGesture,
  type CardsState,
  type CockpitWord,
} from './gesture';
import { PAGE_SIZE, draftToSend, type CockpitFilter } from './rules';

interface CockpitState extends CardsState {
  filter: CockpitFilter;
  limit: number;
  setFilter: (filter: CockpitFilter) => void;
  showMore: () => void;
  toggle: (id: string) => void;
  open: (id: string) => void;
  setText: (id: string, text: string) => void;
  setDraft: (id: string, text: string | undefined) => void;
  dismissToast: (id: number) => void;
  /** Oublie ce qui tenait aux cartes que la file ne liste plus. */
  prune: (alive: readonly AttentionEntry[]) => void;
  gesture: (entry: AttentionEntry, word: Exclude<CockpitWord, 'snooze'>) => Promise<void>;
  snooze: (entry: AttentionEntry, until: string) => Promise<void>;
}

const clientIds = new ClientIds(() => newClientId());
let toastSeq = 0;

function cards(s: CockpitState): CardsState {
  const { texts, drafts, expanded, running, hidden, holdUntil, toasts } = s;
  return { texts, drafts, expanded, running, hidden, holdUntil, toasts };
}

export const useCockpit = create<CockpitState>((set, get) => ({
  filter: 'all',
  limit: PAGE_SIZE,
  expanded: {},
  texts: {},
  drafts: {},
  running: {},
  hidden: {},
  holdUntil: 0,
  toasts: [],

  // Changer de filtre repart a 10 cartes, comme Kova.
  setFilter: (filter) => set({ filter, limit: PAGE_SIZE }),
  showMore: () => set((s) => ({ limit: s.limit + PAGE_SIZE })),
  toggle: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  open: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: true } })),
  setText: (id, text) => set((s) => ({ texts: { ...s.texts, [id]: text } })),
  setDraft: (id, text) =>
    set((s) => {
      const { [id]: _old, ...rest } = s.drafts;
      return { drafts: text === undefined ? rest : { ...rest, [id]: text } };
    }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),

  prune: (alive) => {
    const ids = new Set(alive.map((e) => e.id));
    clientIds.keepCards(ids);
    set((s) => pruneCards(cards(s), ids, Date.now()));
  },

  gesture: async (entry, word) => {
    const s = get();
    const draft = word === 'go' ? draftToSend(entry, s.drafts[entry.id]) : undefined;
    const payload = gesturePayload(cards(s), entry, word, Date.now(), draft);
    if (payload === null) return;
    // Le meme geste avec le meme texte et le meme brouillon, relance a la main, garde son id.
    const clientId = isAttentionGesture(word) ? clientIds.for(entry.id, word, payload.text, payload.draft) : undefined;
    set((st) => startGesture(cards(st), entry.id, word));
    const call = await sendCockpitGesture(entry.id, {
      gesture: word,
      ...(payload.text.length > 0 ? { text: payload.text } : {}),
      ...(payload.seen !== undefined ? { seen: payload.seen } : {}),
      ...(payload.draft !== undefined ? { draft: payload.draft } : {}),
      ...(entry.cardSeen !== undefined ? { cardSeen: entry.cardSeen } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
    });
    const result = classifyGesture(word, call);
    if (result.kind === 'filed' || result.kind === 'stays') clientIds.forget(entry.id, word, payload.text, payload.draft);
    toastSeq += 1;
    const seq = toastSeq;
    set((st) => settleGesture(cards(st), entry, word, result, payload, Date.now(), seq));
    void useAttentionStore.getState().load();
  },

  snooze: async (entry, until) => {
    const payload = gesturePayload(cards(get()), entry, 'snooze', Date.now(), undefined);
    if (payload === null) return;
    // Le meme report (meme date), relance a la main, garde son id ; pris, il l'oublie.
    const clientId = clientIds.for(entry.id, 'snooze', until, undefined);
    set((st) => startGesture(cards(st), entry.id, 'snooze'));
    const result = classifyGesture('snooze', await snoozeCockpitCard(entry.id, snoozeRequest(entry, until, clientId)));
    if (result.kind === 'filed' || result.kind === 'stays') clientIds.forget(entry.id, 'snooze', until, undefined);
    toastSeq += 1;
    const seq = toastSeq;
    set((st) => settleGesture(cards(st), entry, 'snooze', result, payload, Date.now(), seq));
    void useAttentionStore.getState().load();
  },
}));
