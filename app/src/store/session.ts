// Transcript de la session affichée. Une seule session attachée à la fois : l'app ne
// s'abonne jamais aux sessions non visibles.
//
// Cache hors ligne (CA-120) : les derniers tours de chaque session ouverte sont gardés
// dans `kv`. Une session rouverte sans réseau montre son dernier échange avec un bandeau
// « hors ligne », au lieu d'un squelette sans fin.
import type { Block, SessionMeta, Turn } from '@/protocol';
import { create } from 'zustand';
import { kvDel, kvGet, kvSet } from '@/db';
import { splitAttachmentLines, type Attachment } from '@/features/chat/attachments';

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error' | 'closed';

/** Tours gardés en cache par session : le dernier échange, jamais l'historique entier. */
const SESSION_CACHE_TURNS = 60;
/** Sessions gardées en cache. Au delà, la plus ancienne sort. */
const SESSION_CACHE_MAX = 10;
const CACHE_INDEX_KEY = 'session.cache.ids';
const cacheKey = (sessionId: string): string => `session.cache.${sessionId}`;
/** Les appends arrivent ligne par ligne pendant un tour : une écriture par seconde suffit. */
const CACHE_WRITE_DELAY_MS = 1000;

export interface CachedSession {
  meta: SessionMeta | null;
  turns: Turn[];
  hasMoreBefore: boolean;
  cachedAt: number;
}

interface SessionState {
  sessionId: string | null;
  meta: SessionMeta | null;
  turns: Turn[];
  status: SessionStatus;
  error: string | null;
  hasMoreBefore: boolean;
  /** Non nul tant que les tours affichés viennent du cache et non du Mac. */
  servedFromCacheAt: number | null;
  /**
   * Groupes d'actions dépliés ou repliés À LA MAIN, par identifiant du premier appel du
   * groupe, jamais par position dans la liste (docs/13, point 9). Vidé quand une autre
   * session est ouverte : « tant que la session est ouverte ».
   */
  groupsOpen: Record<string, boolean>;
  setGroupOpen: (groupId: string, open: boolean) => void;
  attach: (sessionId: string) => void;
  applySnapshot: (sessionId: string, meta: SessionMeta, turns: Turn[], hasMoreBefore: boolean) => void;
  applyAppend: (sessionId: string, turns: Turn[], replaceIds: string[]) => void;
  /** Page d'historique chargée en tirant vers le haut : fusionnée, jamais dupliquée. */
  applyOlder: (sessionId: string, turns: Turn[], hasMoreBefore: boolean) => void;
  markClosed: (sessionId: string) => void;
  fail: (message: string) => void;
  detach: () => void;
}

/** Fusion d'un append : un turn déjà connu est REMPLACÉ, jamais dupliqué (A16, V6). */
export function merge(existing: Turn[], incoming: Turn[], replaceIds: string[]): Turn[] {
  const dropped = new Set(replaceIds);
  const map = new Map<string, Turn>();
  for (const t of existing) {
    if (!dropped.has(t.id)) map.set(t.id, t);
  }
  for (const t of incoming) map.set(t.id, t);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Ce qui part en cache : les `max` derniers tours. Si on en a coupé, il existe de
 * l'historique au dessus, et le lien « Charger plus ancien » doit le dire.
 */
export function cacheSlice(
  turns: Turn[],
  hasMoreBefore: boolean,
  max = SESSION_CACHE_TURNS,
): { turns: Turn[]; hasMoreBefore: boolean } {
  if (turns.length <= max) return { turns, hasMoreBefore };
  return { turns: turns.slice(turns.length - max), hasMoreBefore: true };
}

let cacheTimer: ReturnType<typeof setTimeout> | null = null;

/** Écriture différée et coalescée du cache de la session courante. */
function scheduleCacheWrite(): void {
  if (cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    const { sessionId, meta, turns, hasMoreBefore, status } = useSession.getState();
    if (!sessionId || status !== 'ready') return;
    const slice = cacheSlice(turns, hasMoreBefore);
    const entry: CachedSession = { meta, ...slice, cachedAt: Date.now() };
    void kvSet(cacheKey(sessionId), entry).then(() => rememberCached(sessionId));
  }, CACHE_WRITE_DELAY_MS);
}

async function rememberCached(sessionId: string): Promise<void> {
  const ids = ((await kvGet<string[]>(CACHE_INDEX_KEY)) ?? []).filter((id) => id !== sessionId);
  ids.push(sessionId);
  const evicted = ids.splice(0, Math.max(0, ids.length - SESSION_CACHE_MAX));
  await Promise.all(evicted.map((id) => kvDel(cacheKey(id))));
  await kvSet(CACHE_INDEX_KEY, ids);
}

async function restoreFromCache(sessionId: string): Promise<void> {
  const cached = await kvGet<CachedSession>(cacheKey(sessionId));
  const s = useSession.getState();
  // Le Mac a répondu entre temps, ou Robin a changé d'écran : le cache ne remplace rien.
  if (!cached || s.sessionId !== sessionId || s.status !== 'loading') return;
  useSession.setState({
    meta: cached.meta,
    turns: cached.turns,
    hasMoreBefore: cached.hasMoreBefore,
    status: 'ready',
    servedFromCacheAt: cached.cachedAt,
  });
}

export const useSession = create<SessionState>((set, get) => ({
  sessionId: null,
  meta: null,
  turns: [],
  status: 'idle',
  error: null,
  hasMoreBefore: false,
  servedFromCacheAt: null,
  groupsOpen: {},

  setGroupOpen: (groupId, open) => set((s) => ({ groupsOpen: { ...s.groupsOpen, [groupId]: open } })),

  attach: (sessionId) => {
    if (get().sessionId === sessionId) return;
    set({
      sessionId,
      meta: null,
      turns: [],
      status: 'loading',
      error: null,
      hasMoreBefore: false,
      servedFromCacheAt: null,
      groupsOpen: {},
    });
    void restoreFromCache(sessionId);
  },

  applySnapshot: (sessionId, meta, turns, hasMoreBefore) => {
    if (get().sessionId !== sessionId) return;
    set({
      meta,
      turns: [...turns].sort((a, b) => a.seq - b.seq),
      status: 'ready',
      error: null,
      hasMoreBefore,
      servedFromCacheAt: null,
    });
    scheduleCacheWrite();
  },

  applyAppend: (sessionId, turns, replaceIds) => {
    if (get().sessionId !== sessionId) return;
    set((s) => ({ turns: merge(s.turns, turns, replaceIds), status: 'ready', servedFromCacheAt: null }));
    scheduleCacheWrite();
  },

  applyOlder: (sessionId, turns, hasMoreBefore) => {
    if (get().sessionId !== sessionId) return;
    set((s) => ({ turns: merge(s.turns, turns, []), hasMoreBefore }));
  },

  markClosed: (sessionId) => {
    if (get().sessionId !== sessionId) return;
    set({ status: 'closed' });
  },

  fail: (message) => set({ status: 'error', error: message }),

  detach: () =>
    set({
      sessionId: null,
      meta: null,
      turns: [],
      status: 'idle',
      error: null,
      servedFromCacheAt: null,
      groupsOpen: {},
    }),
}));

/** Échanges gardés dépliés à l'ouverture (docs/13, point 7). */
export const EXCHANGES_KEPT = 3;

/**
 * Les `count` derniers échanges : un échange = un message utilisateur et tout ce qui le
 * suit jusqu'au suivant. C'est ce que Robin vient lire vingt fois par jour (C36), et il
 * doit pouvoir relire ce que l'agent vient de faire pendant que le tour suivant démarre
 * (docs/13, points 7 et 8) : la version précédente ne gardait que le dernier échange, et
 * chaque envoi repliait le précédent. Un tour de suite (`tool_result`) ou d'assistant
 * n'ouvre jamais un échange : seul un tour `user` compte. Sans message utilisateur
 * dans la fenêtre, tout est rendu.
 */
export function recentExchanges(turns: Turn[], count = EXCHANGES_KEPT): Turn[] {
  if (count <= 0) return [];
  let seen = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn && turn.kind === 'user') {
      seen += 1;
      if (seen === count) return turns.slice(i);
    }
  }
  return turns;
}

/**
 * La jointure `tool_use` vers `tool_result` est `indexToolResults`, dans le protocole :
 * le daemon émet chaque résultat dans un tour séparé de kind `tool_result`, et l'app fait
 * la jointure par `toolUseId` sur tous les tours en mémoire. Elle n'est PAS redéfinie ici.
 */
/** Identifiants des `tool_use` présents dans les tours affichés. Sert à repérer les orphelins. */
export function toolCallIds(turns: Turn[]): Set<string> {
  const ids = new Set<string>();
  for (const t of turns) {
    for (const b of t.blocks) {
      if (b.type === 'tool_use') ids.add(b.id);
    }
  }
  return ids;
}

/** Texte visible d'un ensemble de blocs. Même règle pour une bulle et pour une comparaison. */
export function textOf(blocks: Block[]): string {
  return blocks
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim();
}

/** Message envoyé depuis l'app, affiché en local tant que son tour serveur n'est pas arrivé. */
export interface PendingMessage {
  nonce: string;
  text: string;
  state: 'queued' | 'sent' | 'failed';
  /** Horodatage figé à l'envoi. Le recalculer à chaque rendu faisait avancer l'heure affichée. */
  ts: string;
  /**
   * Plus haut `seq` du transcript connu au moment de l'envoi. Sert de borne basse pour
   * reconnaître le tour serveur correspondant, sans confondre avec un message identique
   * envoyé plus tôt dans la même session.
   */
  afterSeq: number;
  /** Session visée. Un `seq` ne veut rien dire d'une session à l'autre : il repart de zéro. */
  sessionId: string | null;
  /**
   * Pièces jointes (docs/15). `text` reste le texte de Robin seul : le message envoyé au
   * Mac est `text` suivi d'un chemin par pièce, et c'est sous cette forme que le
   * transcript le rend. Les `path` sont nuls tant que la pièce n'est pas sur le Mac.
   */
  attachments?: Attachment[];
}

/**
 * Forme canonique d'un texte pour la comparaison : NFC (le daemon normalise ainsi avant
 * d'émettre, et un clavier iOS peut produire l'autre forme), fins de ligne uniformisées,
 * suites d'espaces réduites, marqueurs `[Image #n]` retirés, bords rognés.
 */
export function canonicalText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\[Image #\d+\]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Tolérance d'horloge entre l'iPhone et le Mac pour dater un écho. Le `seq` est la
 * borne principale ; l'horodatage prend le relais quand la numérotation a bougé
 * (daemon relancé, ancienne version qui renumérotait à chaque `session.attach`). Les
 * deux horloges sont à l'heure réseau : quelques secondes suffisent.
 */
const ECHO_CLOCK_SKEW_MS = 5_000;

/** Vrai si le tour `t` est postérieur à l'envoi de `m` : par `seq`, sinon par l'heure. */
function isAfterSend(m: PendingMessage, t: Turn): boolean {
  if (t.seq > m.afterSeq) return true;
  const sentAt = Date.parse(m.ts);
  const turnAt = Date.parse(t.ts);
  return Number.isFinite(sentAt) && Number.isFinite(turnAt) && turnAt >= sentAt - ECHO_CLOCK_SKEW_MS;
}

/**
 * Vrai quand le tour utilisateur `echoText` est le rendu de la bulle locale `m`.
 * `loose` accepte que le transcript ait AJOUTÉ quelque chose autour du texte de Robin
 * (préfixe, ligne de contexte) : le texte de la bulle doit alors être contenu dans
 * celui du tour.
 */
function echoes(m: PendingMessage, echoText: string, loose = false): boolean {
  const pieces = m.attachments ?? [];
  const mine = canonicalText(m.text);
  if (pieces.length === 0) {
    const theirs = canonicalText(echoText);
    return loose ? mine.length > 0 && theirs.includes(mine) : theirs === mine;
  }
  // Avec des pièces, seule la comparaison du TEXTE s'élargit : les chemins, eux, doivent
  // toujours concorder, sinon un tour au même texte sans pièce passerait pour l'écho.
  const { text, paths } = splitAttachmentLines(echoText);
  const theirs = canonicalText(text);
  const textOk = loose ? theirs.includes(mine) : theirs === mine;
  if (!textOk || paths.length !== pieces.length) return false;
  // Une pièce partie de la file hors ligne n'a pas de chemin connu ici : on ne compare
  // que ce que l'on sait.
  return pieces.every((a, i) => a.path === null || a.path === paths[i]);
}

/**
 * Retire les bulles locales dont le tour serveur est arrivé.
 *
 * C'est LA cause du message affiché en double : la bulle « en cours d'envoi » restait en
 * place pour toujours, et le transcript rendait le même message quelques centaines de
 * millisecondes plus tard. Le transcript ne porte pas le `nonce` (l'identifiant d'un tour
 * utilisateur est l'`uuid` de la ligne JSONL écrite par Claude) : la seule corrélation
 * possible est le texte, bornée par le `seq` connu à l'envoi, ou à défaut par l'heure. Un
 * tour n'est consommé que par une seule bulle, pour que deux envois identiques d'affilée
 * ne disparaissent pas ensemble sur l'arrivée du premier.
 *
 * Deux passes : d'abord le texte exact (forme canonique), puis, pour les bulles restées
 * sans écho, un tour postérieur à l'envoi qui CONTIENT le texte de Robin. C'est le cas
 * de la capture du 12 septembre : après plusieurs reconnexions, la numérotation `seq`
 * avait changé et trois bulles sont restées collées sous le fil, jamais remplacées.
 */
export function withoutEchoed(
  list: PendingMessage[],
  turns: Turn[],
  sessionId: string | null,
): PendingMessage[] {
  if (list.length === 0) return list;
  const consumed = new Set<string>();
  const candidates = (m: PendingMessage): Turn[] =>
    turns.filter((t) => t.kind === 'user' && !t.isSidechain && !consumed.has(t.id) && isAfterSend(m, t));
  const matched = new Set<string>();
  for (const loose of [false, true]) {
    for (const m of list) {
      if (matched.has(m.nonce) || m.sessionId !== sessionId) continue;
      const match = candidates(m).find((t) => echoes(m, textOf(t.blocks), loose));
      if (!match) continue;
      consumed.add(match.id);
      matched.add(m.nonce);
    }
  }
  const kept = list.filter((m) => {
    // Bulle héritée d'une session précédente : plus aucun tour ne pourra la reconnaître,
    // et la garder afficherait un doublon indélogeable.
    if (m.sessionId !== sessionId) return false;
    return !matched.has(m.nonce);
  });
  return kept.length === list.length ? list : kept;
}

/** Au delà, sans écho dans le JSONL, le bandeau `Non confirmé` apparaît (CA-48). */
const UNCONFIRMED_AFTER_MS = 20_000;

/**
 * Messages partis (`sent`) dont l'écho n'est toujours pas arrivé après 20 s. L'envoi a été
 * accepté par le Mac, mais rien ne prouve que le pane l'a reçu : Robin doit aller voir le
 * terminal plutôt que de renvoyer à l'aveugle. Un message `queued` n'entre pas dans ce
 * compte, il n'est pas encore parti.
 */
export function unconfirmed(
  list: PendingMessage[],
  now = Date.now(),
  after = UNCONFIRMED_AFTER_MS,
): PendingMessage[] {
  return list.filter((m) => {
    if (m.state !== 'sent') return false;
    const sentAt = Date.parse(m.ts);
    return Number.isFinite(sentAt) && now - sentAt >= after;
  });
}

/** Repère du transcript au moment de l'envoi : session visée et plus haut `seq` connu. */
export function transcriptMark(): { sessionId: string | null; afterSeq: number } {
  const { sessionId, turns } = useSession.getState();
  return { sessionId, afterSeq: turns.length === 0 ? -1 : (turns[turns.length - 1]?.seq ?? -1) };
}
