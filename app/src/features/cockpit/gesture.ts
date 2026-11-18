// Ce que devient une carte apres un geste du Cockpit, en regles pures : la classification
// de la reponse du daemon, les mots du toast (ceux de Kova, `cockpit::Toast`), les dates
// du report, l'identifiant de clic garde pour un nouvel essai, et la garde de 700 ms apres
// qu'une carte a quitte la liste. Le magasin (`useCockpit.ts`) ne fait qu'appliquer.
import {
  ATTENTION_UNCERTAIN_WORDS,
  gestureFilesCard,
  gestureTakesText,
  isAttentionGesture,
  type AttentionGesture,
  type AttentionGestureResponse,
  type AttentionSnoozeRequest,
  type AttentionUncertainWord,
} from '@/protocol';
import { t } from '@/i18n/en';

/** Les deux mots d'une carte incertaine, pris du protocole (le mot du Mac, au caractere pres). */
export const [LEFT, RESEND] = ATTENTION_UNCERTAIN_WORDS;

/** Un geste de la carte : un des sept mots, un mot d'une carte incertaine, ou le report. */
export type CockpitWord = AttentionGesture | AttentionUncertainWord | 'snooze';

/** Apres un geste qui classe la carte, aucun bouton de la liste n'agit pendant ce delai. */
export const FILE_GUARD_MS = 700;

/** Une carte classee reste cachee au plus ce delai, le temps que la file la retire. */
export const HIDE_MS = 60_000;

/** Ce que l'action reseau a rendu, sans rien supposer de la suite. */
export type GestureCall =
  | { ok: true; response: AttentionGestureResponse | { applied: true } }
  | { ok: false; kind: 'http'; status: number; code: string; message: string }
  | { ok: false; kind: 'network'; message: string };

/**
 * Ce que la carte devient. `filed` : elle quitte la liste, un toast dit ce qui est fait.
 * `stays` : elle reste et se relit (une question posee, une demande annulee, un renvoi).
 * `refused` : rien n'est note, la carte revient entiere avec le texte tape. `unknown` :
 * coupure, delai ou 502, le geste est peut-etre arrive ; il ne se rejoue jamais seul.
 */
export type GestureResult =
  | { kind: 'filed'; said?: string }
  | { kind: 'stays'; said?: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'unknown' };

/** Le geste classe-t-il la carte quand il passe ? `parti` la ferme, `Renvoyer` est un nouveau go. */
export function wordFilesCard(word: CockpitWord): boolean {
  if (word === 'snooze' || word === LEFT) return true;
  if (word === RESEND) return false;
  return isAttentionGesture(word) && gestureFilesCard(word);
}

export function classifyGesture(word: CockpitWord, call: GestureCall): GestureResult {
  if (call.ok) {
    const said = 'outcome' in call.response && call.response.outcome === 'said' ? call.response.line : undefined;
    const base = said !== undefined ? { said } : {};
    return wordFilesCard(word) ? { kind: 'filed', ...base } : { kind: 'stays', ...base };
  }
  if (call.kind === 'network') return { kind: 'unknown' };
  if (call.status === 502 || call.status === 504 || call.status >= 500) return { kind: 'unknown' };
  if (call.code === 'ATTENTION_CARD_CHANGED') return { kind: 'refused', reason: t.cockpitCardChanged };
  if (call.code === 'ATTENTION_GESTURE_NOT_OFFERED') return { kind: 'refused', reason: t.cockpitNotOffered };
  if (call.code === 'ATTENTION_BUSY') return { kind: 'refused', reason: t.cockpitBusy };
  if (call.status === 404) return { kind: 'refused', reason: t.cockpitGone };
  // `ATTENTION_REFUSED` : la ligne d'`attn` elle-meme ; le reste, le message du daemon.
  return { kind: 'refused', reason: call.message };
}

/** Ce que dit le toast d'un geste passe (`Go noté`...). */
export function filedWords(word: CockpitWord): string {
  switch (word) {
    case 'go':
      return t.cockpitToastGo;
    case 'nogo':
      return t.cockpitToastNoGo;
    case 'done':
      return t.cockpitToastDone;
    case 'dismiss':
      return t.cockpitToastDismiss;
    case 'seen':
      return t.cockpitToastSeen;
    case 'snooze':
      return t.cockpitToastSnooze;
    case 'ask':
      return t.cockpitToastAsk;
    case 'cancel':
      return t.cockpitToastCancel;
    case LEFT:
      return t.cockpitToastLeft;
    case RESEND:
      return t.cockpitToastResend;
  }
}

/** Le mot que la carte donne au toast : sa longueur de toast, 180 caracteres, espaces aplatis. */
export const TOAST_TEXT_MAX = 180;

export function clipped(text: string): string {
  const flat = text.split(/\s+/).filter((w) => w.length > 0).join(' ');
  const chars = Array.from(flat);
  if (chars.length <= TOAST_TEXT_MAX) return flat;
  return `${chars.slice(0, TOAST_TEXT_MAX).join('').trimEnd()}…`;
}

export interface CockpitToast {
  id: number;
  ok: boolean;
  /** Neutre : ni succes ni echec (envoi non confirme, ligne de la file). */
  neutral?: boolean;
  head: string;
  title: string;
  more?: string;
}

/** Le toast d'un geste passe : ce qui est fait, la carte, et le texte parti avec. */
export function filedToast(id: number, word: CockpitWord, title: string, text: string | undefined, said?: string): CockpitToast {
  const sent = text?.trim() ?? '';
  const more = sent.length > 0 ? t.cockpitToastTextLeft(clipped(sent)) : undefined;
  // La file a parle elle-meme (`envoi par le code...`, `déjà parti...`) : sa ligne, neutre.
  if (said !== undefined) return { id, ok: true, neutral: true, head: said, title, ...(more ? { more } : {}) };
  return { id, ok: true, head: filedWords(word), title, ...(more ? { more } : {}) };
}

/** Le toast d'un refus : jamais les mots d'un succes, et le texte reste sur la carte. */
export function failedToast(id: number, title: string, why: string, hadText: boolean): CockpitToast {
  const reason = clipped(why).replace(/\.+$/, '');
  return { id, ok: false, head: t.cockpitToastFailed, title, more: `${reason}.${hadText ? t.cockpitToastTextKept : ''}` };
}

/** Le toast d'un geste sans reponse claire. */
export function unknownToast(id: number, title: string): CockpitToast {
  return { id, ok: false, neutral: true, head: t.cockpitToastUnknown, title, more: t.cockpitToastUnknownMore };
}

/**
 * Les identifiants de clic, par carte, geste, texte et brouillon : un nouvel essai du meme
 * geste reprend le meme, et la file ne le note pas deux fois. `make` fabrique un nouvel id.
 */
export class ClientIds {
  private readonly ids = new Map<string, string>();
  private readonly make: () => string;

  // Pas de propriete de parametre : les tests tournent en dépouillement de types seul.
  constructor(make: () => string) {
    this.make = make;
  }

  private static key(card: string, word: CockpitWord, text: string, draft: string | undefined): string {
    return JSON.stringify([card, word, text.trim(), draft ?? null]);
  }

  for(card: string, word: CockpitWord, text: string, draft: string | undefined): string {
    const key = ClientIds.key(card, word, text, draft);
    const known = this.ids.get(key);
    if (known !== undefined) return known;
    const id = this.make();
    this.ids.set(key, id);
    return id;
  }

  /** Le geste a ete pris : l'identifiant ne sert plus. */
  forget(card: string, word: CockpitWord, text: string, draft: string | undefined): void {
    this.ids.delete(ClientIds.key(card, word, text, draft));
  }

  /** Les cartes parties de la liste n'ont plus d'identifiants a garder. */
  keepCards(alive: ReadonlySet<string>): void {
    for (const key of [...this.ids.keys()]) {
      const card = (JSON.parse(key) as [string])[0];
      if (!alive.has(card)) this.ids.delete(key);
    }
  }
}

/**
 * Ce qui part pour un report : la date, l'empreinte de la carte affichee (la file refuse si
 * elle a change) et l'identifiant du clic, repris quand Robin relance le meme report.
 */
export function snoozeRequest(entry: { cardSeen?: string }, until: string, clientId: string): Omit<AttentionSnoozeRequest, 'nonce'> {
  return { until, ...(entry.cardSeen !== undefined ? { cardSeen: entry.cardSeen } : {}), clientId };
}

/** Un identifiant de clic : lettres, chiffres et tirets, comme `ATTENTION_CLIENT_ID_RE`. */
export function newClientId(random: () => number = Math.random): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(random() * 16)
        .toString(16)
        .toLowerCase(),
    ).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

/** Les quatre dates du report, comme le menu de Kova. */
export type SnoozeChoice = 'hour' | 'evening' | 'morning' | 'monday';

/** La date d'un report, a l'heure locale du telephone. */
export function snoozeDate(choice: SnoozeChoice, now: Date): Date {
  const at = new Date(now.getTime());
  if (choice === 'hour') return new Date(now.getTime() + 3600_000);
  if (choice === 'evening') {
    // 19:00 aujourd'hui, ou demain une fois passe.
    at.setHours(19, 0, 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return at;
  }
  if (choice === 'morning') {
    at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
    return at;
  }
  // Lundi prochain, 09:00 : jamais aujourd'hui, meme un lundi.
  const days = ((8 - at.getDay()) % 7) || 7;
  at.setDate(at.getDate() + days);
  at.setHours(9, 0, 0, 0);
  return at;
}

/** ISO 8601 avec le decalage local (`2026-11-19T09:00:00+01:00`), ce que `attn snooze` lit. */
export function isoWithOffset(date: Date): string {
  const pad = (n: number) => String(Math.abs(Math.trunc(n))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  // Le signe du decalage (pas une icone) : `String.fromCharCode` evite le faux positif de check-icons.
  const sign = String.fromCharCode(offset >= 0 ? 43 : 45);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/** Ce que le Cockpit garde des cartes entre deux relectures. */
export interface CardsState {
  /** Le texte tape dans la zone de reponse, par carte. */
  texts: Record<string, string>;
  /** Le brouillon tel que Robin l'a reecrit, par carte ; absent : intact. */
  drafts: Record<string, string>;
  expanded: Record<string, boolean>;
  /** Le geste en vol sur une carte : elle est grisee, rien n'y agit. */
  running: Record<string, CockpitWord>;
  /** Les cartes classees, cachees depuis cet instant (ms) jusqu'a ce que la file les retire. */
  hidden: Record<string, number>;
  /** Aucun bouton de la liste n'agit avant cet instant (ms). */
  holdUntil: number;
  toasts: CockpitToast[];
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = record;
  return rest;
}

/** Ce qui part avec un geste : le texte s'il le prend, le brouillon reecrit et l'empreinte sur `go`. */
export interface GesturePayload {
  text: string;
  draft?: string;
  seen?: string;
}

/**
 * Le geste peut-il partir, et avec quoi. `null` : une carte deja en vol, la garde de
 * 700 ms, ou `Demander` sans texte. `draftToSend` decide du brouillon (rules.ts).
 */
export function gesturePayload(
  state: CardsState,
  entry: { id: string; draft?: { seen?: string } },
  word: CockpitWord,
  nowMs: number,
  draft: string | undefined,
): GesturePayload | null {
  if (state.running[entry.id] !== undefined || nowMs < state.holdUntil) return null;
  const typed = (state.texts[entry.id] ?? '').trim();
  const text = isAttentionGesture(word) && gestureTakesText(word) ? typed : '';
  if (word === 'ask' && text.length === 0) return null;
  const goes = word === 'go' || word === LEFT || word === RESEND;
  const seen = goes ? entry.draft?.seen : undefined;
  return {
    text,
    ...(word === 'go' && draft !== undefined ? { draft } : {}),
    ...(seen !== undefined ? { seen } : {}),
  };
}

/** Le geste part : la carte se grise. */
export function startGesture(state: CardsState, id: string, word: CockpitWord): CardsState {
  return { ...state, running: { ...state.running, [id]: word } };
}

/**
 * Le geste a rendu sa reponse. Classee : la carte part, la garde de 700 ms commence, le
 * toast dit ce qui est fait et le texte parti avec. Restee (question, annulation) : le
 * champ se vide, la carte se relit. Refusee : la carte revient entiere avec son texte et
 * son brouillon, le toast dit pourquoi. Sans reponse claire : rien ne change, le toast le dit.
 */
export function settleGesture(
  state: CardsState,
  card: { id: string; title: string },
  word: CockpitWord,
  result: GestureResult,
  payload: GesturePayload,
  nowMs: number,
  toastId: number,
): CardsState {
  const id = card.id;
  const next: CardsState = { ...state, running: without(state.running, id) };
  if (result.kind === 'filed' || result.kind === 'stays') {
    next.toasts = [...state.toasts, filedToast(toastId, word, card.title, payload.text, result.said)];
    next.texts = without(state.texts, id);
    if (word === 'go') next.drafts = without(state.drafts, id);
    if (result.kind === 'filed') {
      next.hidden = { ...state.hidden, [id]: nowMs };
      next.holdUntil = nowMs + FILE_GUARD_MS;
      next.expanded = without(state.expanded, id);
    }
    return next;
  }
  if (result.kind === 'refused') {
    const hadText = payload.text.length > 0 || payload.draft !== undefined;
    next.toasts = [...state.toasts, failedToast(toastId, card.title, result.reason, hadText)];
    return next;
  }
  next.toasts = [...state.toasts, unknownToast(toastId, card.title)];
  return next;
}

/** Les cartes a montrer : la file, moins celles qui viennent d'etre classees (60 s au plus). */
export function visibleEntries<T extends { id: string }>(entries: readonly T[], hidden: Readonly<Record<string, number>>, nowMs: number): T[] {
  return entries.filter((e) => {
    const at = hidden[e.id];
    return at === undefined || nowMs - at >= HIDE_MS;
  });
}

/** Oublie ce qui tenait aux cartes que la file ne liste plus ; une carte cachee depuis 60 s revient. */
export function pruneCards(state: CardsState, alive: ReadonlySet<string>, nowMs: number): CardsState {
  const keep = <V>(r: Record<string, V>) => Object.fromEntries(Object.entries(r).filter(([id]) => alive.has(id)));
  return {
    ...state,
    texts: keep(state.texts),
    drafts: keep(state.drafts),
    expanded: keep(state.expanded),
    hidden: Object.fromEntries(Object.entries(state.hidden).filter(([id, at]) => alive.has(id) && nowMs - at < HIDE_MS)),
  };
}
