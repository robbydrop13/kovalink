// File d'attention de Robin : seul le CLI `attn` la connait, le daemon ne lit jamais son
// journal lui-meme. Chaque appel lui passe un argv fixe, jamais une ligne de shell : la
// lecture des deux files (`list --open --json --scope all`), un geste du Cockpit (`act`
// avec un des sept mots que la carte offre, la forme exacte de Kova), un report
// (`snooze`), et les anciens boutons (`act`, `close`). Le corps d'une entree reste dans la
// reponse ; la sortie de `attn` (messages, chemins du Mac) ne part jamais vers l'app, sauf
// la ligne d'un refus (code 4), qui est le message d'`attn` a Robin.
//
// Les entrees `now` comptent dans `waitsOnYou` comme une question : la lecture est
// gardee 10 s, et le daemon la relit au meme rythme pour que la pastille suive.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ATTENTION_CLIENT_ID_RE,
  ATTENTION_DRAFT_MAX,
  ATTENTION_GESTURES,
  ATTENTION_ID_RE,
  ATTENTION_LEVELS,
  ATTENTION_SEEN_RE,
  ATTENTION_SNOOZE_MAX_DAYS,
  ATTENTION_TEXT_MAX,
  ATTENTION_UNCERTAIN_WORDS,
  gestureTakesText,
  isAttentionButton,
  isAttentionGesture,
  isAttentionUncertainWord,
  type AttentionActResponse,
  type AttentionAsk,
  type AttentionDraft,
  type AttentionEntry,
  type AttentionGesture,
  type AttentionGestureResponse,
  type AttentionLevel,
  type AttentionSnoozeResponse,
  type AttentionUncertainWord,
  type AttentionWaiting,
} from '@kovalink/protocol';
import type { Exec } from './routines.js';

/** Duree de vie de la derniere lecture, et cadence du sondage de `main.ts`. */
export const ATTENTION_CACHE_MS = 10_000;

/** `list` lit un fichier ; `act` peut attendre que le chief recoive le clic. */
const LIST_TIMEOUT_MS = 10_000;
const ACT_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const STDERR_MAX = 200;

/**
 * Un `Envoyer` reussi bloque le suivant sur la meme entree pendant ce delai, meme avec un
 * nouveau nonce : l'entree reste ouverte jusqu'a ce que le chief la ferme, et un second
 * clic lui arriverait comme une seconde demande.
 */
export const ATTENTION_RESEND_MS = 10 * 60_000;

/** Ce que `attn` retape dans un pane : aucun caractere de controle sauf la tabulation et le saut de ligne. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/;

/** Les genres sur lesquels chaque bouton a un sens, comme les lignes de Kova. */
const KINDS_OF: Record<string, readonly string[]> = {
  Envoyer: ['would'],
  Ignorer: ['would'],
  Fait: ['decision', 'review', 'test'],
};

/** Les notes de fermeture, au mot pres : celles que Kova ecrit, marquees KovaLink. */
export const NOTE_DONE = 'Fait (KovaLink)';
export const NOTE_IGNORED = 'Ignore (KovaLink)';

/** Chemin du CLI `attn`, surchargeable par `KOVALINK_ATTN` (tests, install custom). */
export function attnPath(): string {
  return process.env['KOVALINK_ATTN'] ?? join(homedir(), '.local', 'bin', 'attn');
}

/**
 * Cle de clic d'`attn` (fichier 0600 cree par `attn click-key`), surchargeable par
 * `KOVALINK_CLICK_KEY_FILE` (tests). Elle prouve a `attn` qu'un geste vient du telephone de
 * Robin, comme Kova le fait sur le Mac ; sans elle, `attn` ne reconnait le daemon que par
 * son processus parent, repli qui sera retire.
 */
export function clickKeyPath(): string {
  return process.env['KOVALINK_CLICK_KEY_FILE'] ?? join(homedir(), '.config', 'attn', 'click' + '.key');
}

/**
 * L'environnement d'un geste (`act`, `close`, `snooze`) : la cle relue a chaque geste (une cle
 * changee vaut sans relancer le daemon), passee par l'environnement, jamais en argument
 * (invisible dans `ps`), avec `ATTN_CLICK_FROM=kovalink`. Une lecture ou une cle absente :
 * l'environnement du daemon, inchange. Jamais pour `list`.
 */
export function attnEnv(argv: readonly string[]): NodeJS.ProcessEnv | undefined {
  if (argv[0] !== 'act' && argv[0] !== 'close' && argv[0] !== 'snooze') return undefined;
  let key = '';
  try {
    key = readFileSync(clickKeyPath(), 'utf8').trim();
  } catch {
    return undefined;
  }
  if (key.length === 0) return undefined;
  return { ...process.env, ATTN_CLICK_KEY: key, ATTN_CLICK_FROM: 'kovalink' };
}

/**
 * Executeur par defaut : `execFile`, jamais un shell. Un CLI absent (`ENOENT`) n'a pas de
 * code numerique : il vaut un echec, avec le message de spawn dans `stderr` pour le
 * journal local.
 */
export const execAttn: Exec = (argv) => {
  const isList = argv[0] === 'list';
  const env = attnEnv(argv);
  return new Promise((resolve) => {
    execFile(
      attnPath(),
      argv,
      {
        timeout: isList ? LIST_TIMEOUT_MS : ACT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        ...(env ? { env } : {}),
      },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown }) | null;
        // Sans code numerique (spawn en echec, delai depasse, signal) : `EXIT_NO_CODE`,
        // jamais un refus d'`attn`, qui n'a rien dit.
        const code = e === null ? 0 : typeof e.code === 'number' ? e.code : EXIT_NO_CODE;
        resolve({ code, stdout: stdout ?? '', stderr: stderr || (e?.message ?? '') });
      },
    );
  });
};

/**
 * Refus d'un geste : requete hors format (400, rien n'est lance), entree qui n'est plus
 * ouverte (404), geste deja en cours sur elle (409), geste que la carte n'offre pas (409),
 * refuse par `attn` (409, `message` est sa ligne), carte changee (409), `attn` en echec (502).
 */
export class AttentionError extends Error {
  constructor(
    readonly reason:
      | 'bad_request'
      | 'not_found'
      | 'busy'
      | 'already_sent'
      | 'not_offered'
      | 'refused'
      | 'card_changed'
      | 'attn_failed',
    message: string,
  ) {
    super(message);
    this.name = 'AttentionError';
  }
}

/** Derniere ligne de `stderr`, bornee : le message part dans le journal local seulement. */
function failure(what: string, res: { code: number; stderr: string }): string {
  const why = res.stderr.trim().split('\n').pop() ?? '';
  return `attn ${what}: code ${res.code}${why ? ` (${why.slice(0, STDERR_MAX)})` : ''}`;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function isLevel(v: unknown): v is AttentionLevel {
  return typeof v === 'string' && (ATTENTION_LEVELS as readonly string[]).includes(v);
}

/**
 * Une entree de `attn list --json` vers le protocole : seuls les champs du contrat sont
 * gardes (`op`, `updated` et ce qui viendra s'en vont), les optionnels vides sont omis.
 * Une entree sans identifiant valide, sans date lisible, sans niveau connu ou sans titre
 * est ignoree : elle ne pourrait ni se dater ni se designer.
 */
export function toAttentionEntry(raw: unknown): AttentionEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  const ts = r['ts'];
  const level = r['level'];
  const title = text(r['title']);
  if (typeof id !== 'string' || !ATTENTION_ID_RE.test(id)) return null;
  if (typeof ts !== 'string' || !Number.isFinite(Date.parse(ts))) return null;
  if (!isLevel(level) || title === null) return null;
  const entry: AttentionEntry = {
    id,
    ts,
    from: text(r['from']) ?? '',
    level,
    kind: text(r['kind']) ?? 'info',
    title,
  };
  const needs = text(r['needs']);
  const action = text(r['action']);
  const topic = text(r['topic']);
  const body = text(r['body']);
  if (needs !== null) entry.needs = needs;
  if (action !== null) entry.action = action;
  if (topic !== null) entry.topic = topic;
  if (body !== null) entry.body = body;
  if (Array.isArray(r['src'])) {
    const src = r['src'].filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (src.length > 0) entry.src = src;
  } else {
    // Un seul mot vaut une liste d'un, comme Kova.
    const one = trimmed(r['src']);
    if (one !== null) entry.src = [one];
  }
  Object.assign(entry, cockpitFields(r));
  return entry;
}

function trimmed(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Les caracteres de controle retires, puis borne a `max` caracteres (`chars().take` de Kova). */
function shown(v: string, max: number): string {
  return Array.from(v.replace(SHOWN_CONTROL_RE, '')).slice(0, max).join('');
}

// Les controles au sens de Rust (`char::is_control`) : C0, DEL et C1.
// eslint-disable-next-line no-control-regex
const SHOWN_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const LABEL_GRAY = '#94A3B8';

/** Une empreinte de la file (`valid_seen` de Kova), sinon rien. */
function seenOf(v: unknown): string | null {
  return typeof v === 'string' && ATTENTION_SEEN_RE.test(v) ? v : null;
}

/** Les gestes listes : mots connus seulement, sans doublon, dans l'ordre de la file. */
function gesturesOf(v: unknown): AttentionGesture[] | null {
  if (!Array.isArray(v)) return null;
  const out: AttentionGesture[] = [];
  for (const g of v) if (isAttentionGesture(g) && !out.includes(g)) out.push(g);
  return out;
}

/** Le brouillon, lu champ par champ ; sans texte, il n'y en a pas. */
function draftOf(v: unknown): AttentionDraft | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>;
  if (typeof d['text'] !== 'string' || d['text'].trim().length === 0) return null;
  const draft: AttentionDraft = { text: d['text'] };
  const fields: [keyof AttentionDraft, string][] = [
    ['to', 'to'],
    ['channel', 'channel'],
    ['subject', 'subject'],
    ['target', 'target'],
    ['targetLabel', 'target_label'],
    ['targetKind', 'target_kind'],
  ];
  for (const [ours, theirs] of fields) {
    const value = trimmed(d[theirs]);
    if (value !== null) draft[ours] = value;
  }
  const seen = seenOf(d['seen']);
  if (seen !== null) draft.seen = seen;
  return draft;
}

/** La question posee, seulement quand la carte attend l'agent (`reply_of` de Kova). */
function askOf(v: unknown, waiting: AttentionWaiting | undefined): AttentionAsk | null {
  if (waiting !== 'agent' || !v || typeof v !== 'object' || Array.isArray(v)) return null;
  const a = v as Record<string, unknown>;
  const text = trimmed(a['text']);
  if (text === null) return null;
  const ask: AttentionAsk = { text };
  const ts = trimmed(a['ts']);
  const to = trimmed(a['to']);
  const label = trimmed(a['label']);
  if (ts !== null && Number.isFinite(Date.parse(ts))) ask.ts = ts;
  if (to !== null) ask.to = to;
  if (label !== null) {
    const l = shown(label, 80);
    if (l.length > 0) ask.label = l;
  }
  return ask;
}

/**
 * Les champs du Cockpit, lus avec la meme indulgence que Kova (`parse`) : une priorite, un
 * brouillon ou un label qui ne se lit pas est omis, l'entree reste.
 */
function cockpitFields(r: Record<string, unknown>): Partial<AttentionEntry> {
  const out: Partial<AttentionEntry> = {};
  const gestures = gesturesOf(r['gestures']);
  if (gestures !== null) out.gestures = gestures;
  const goLabel = typeof r['go_label'] === 'string' ? shown(r['go_label'].trim(), 40).trim() : '';
  if (goLabel.length > 0) out.goLabel = goLabel;
  const waiting = r['waiting'] === 'robin' || r['waiting'] === 'agent' ? r['waiting'] : undefined;
  if (waiting !== undefined) out.waiting = waiting;
  const ask = askOf(r['ask'], waiting);
  if (ask !== null) out.ask = ask;
  const cardSeen = seenOf(r['card_seen']);
  if (cardSeen !== null) out.cardSeen = cardSeen;
  const prio = r['prio'];
  if (prio === 1 || prio === 2 || prio === 3) out.prio = prio;
  const label = trimmed(r['label']);
  if (label !== null) {
    const color = r['label_color'];
    out.label = { name: label, color: typeof color === 'string' && HEX_COLOR_RE.test(color) ? color : LABEL_GRAY };
  }
  if (r['scope'] === 'pro' || r['scope'] === 'perso') out.scope = r['scope'];
  const draft = draftOf(r['draft']);
  if (draft !== null) out.draft = draft;
  for (const [ours, theirs] of [
    ['detail', 'detail'],
    ['failed', 'failed'],
    ['uncertain', 'uncertain'],
    ['proof', 'proof'],
  ] as const) {
    const value = trimmed(r[theirs]);
    if (value !== null) out[ours] = value;
  }
  // Des chemins absolus du Mac, rien d'autre.
  for (const key of ['before', 'after'] as const) {
    const value = trimmed(r[key]);
    if (value !== null && value.startsWith('/')) out[key] = value;
  }
  const snoozed = trimmed(r['snoozed_until']);
  if (snoozed !== null && Number.isFinite(Date.parse(snoozed))) out.snoozedUntil = snoozed;
  return out;
}

/** La sortie entiere : un tableau, sinon `attn` a change de forme et c'est une erreur. */
export function parseAttention(stdout: string): AttentionEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new AttentionError('attn_failed', 'attn list --json: sortie illisible');
  }
  if (!Array.isArray(parsed)) throw new AttentionError('attn_failed', 'attn list --json: tableau attendu');
  return parsed.map(toAttentionEntry).filter((e): e is AttentionEntry => e !== null);
}

/** L'argv d'un geste, ou `null` pour `Ouvrir` (il reste sur le telephone, rien a noter). */
export function attentionArgv(id: string, button: string, note: string): string[] | null {
  if (button === 'Envoyer') {
    // `--text=` en un seul element : un texte qui commence par `-` ne se lit pas comme
    // une option.
    // `--exit-codes` : 3 = clic note, pas encore remis (le crochet ou le gardien le remet), pas un echec.
    const act = ['act', id, 'Envoyer', '--exit-codes'];
    return note.length > 0 ? [...act, `--text=${note}`] : act;
  }
  // `--reason` : le jugement de Robin, compte par `attn feedback` comme les croix et coches de Kova.
  if (button === 'Fait') return ['close', id, '--note', NOTE_DONE, '--reason', 'done', '--by', 'robin'];
  if (button === 'Ignorer') return ['close', id, '--note', NOTE_IGNORED, '--reason', 'dismissed', '--by', 'robin'];
  return null;
}

/** La lecture : les deux files, pro et perso, comme le Cockpit de Kova. */
export const LIST_ARGV = ['list', '--open', '--json', '--scope', 'all'] as const;

/** Les drapeaux de chaque clic du Cockpit, comme l'`act_command` de Kova (`--by robin`). */
const BY_ROBIN = ['--by', 'robin'] as const;
export const EXIT_CODES = '--exit-codes';
export const CLIENT_ID = '--client-id';
export const CARD_SEEN = '--card-seen';

/** Les codes de sortie d'`attn act --exit-codes` (contrat des gestes). */
export const EXIT_DELIVERED = 0;
export const EXIT_NOTED = 3;
export const EXIT_REFUSED = 4;
export const EXIT_CARD_CHANGED = 5;
/** `attn` n'a pas rendu de code : il n'a pas pu partir, a depasse son delai ou a ete tue. */
export const EXIT_NO_CODE = -1;

/**
 * Comment commence la premiere ligne d'un clic qui n'a rien remis a un agent et le dit :
 * la file envoie elle-meme (`envoi par le code (slack a U123)`) ou a deja pris cette
 * version. Ce sont les mots d'`attn`, au caractere pres (`ALREADY` de Kova).
 */
export const SAID_PREFIXES: readonly string[] = [
  'déjà envoyé par le code',
  'déjà remis à',
  'déjà parti',
  'déjà noté',
  'envoi par le code',
];

/** La longueur d'une ligne d'`attn` montree sur la carte : 160 pour `said`, 140 pour un refus (Kova). */
const SAID_MAX = 160;
const REFUSED_MAX = 140;

/** Un geste du Cockpit, valide : ce que l'argv recoit. */
export interface CheckedGesture {
  gesture: AttentionGesture;
  /** Taille, controle et geste verifies ; absent quand rien n'a ete tape. */
  text?: string;
  seen?: string;
  draft?: string;
  cardSeen?: string;
  clientId?: string;
}

/**
 * Valide un geste AVANT de lancer quoi que ce soit. Le texte et le brouillon sont des
 * chaines bornees sans controle (sauf tabulation et saut de ligne) ; `ask` exige un texte,
 * `cancel` n'en prend pas ; `seen` et `draft` vont avec `go` seulement ; les empreintes et
 * l'identifiant du clic ont la forme que Kova passe.
 */
export function checkGesture(body: {
  gesture?: unknown;
  text?: unknown;
  seen?: unknown;
  draft?: unknown;
  cardSeen?: unknown;
  clientId?: unknown;
}): CheckedGesture {
  const { gesture, text, seen, draft, cardSeen, clientId } = body;
  if (!isAttentionGesture(gesture)) {
    throw new AttentionError('bad_request', `gesture must be one of ${ATTENTION_GESTURES.join(', ')}`);
  }
  const out: CheckedGesture = { gesture };
  if (text !== undefined && typeof text !== 'string') throw new AttentionError('bad_request', 'text must be a string');
  const t = typeof text === 'string' ? text.trim() : '';
  if (CONTROL_RE.test(t)) throw new AttentionError('bad_request', 'text must not contain control characters');
  if (Buffer.byteLength(t, 'utf8') > ATTENTION_TEXT_MAX) {
    throw new AttentionError('bad_request', `text is longer than ${ATTENTION_TEXT_MAX} bytes`);
  }
  if (t.length > 0) {
    if (!gestureTakesText(gesture)) throw new AttentionError('bad_request', `${gesture} carries no text`);
    out.text = t;
  } else if (gesture === 'ask') {
    throw new AttentionError('bad_request', 'ask needs a text');
  }
  if (seen !== undefined) {
    if (gesture !== 'go') throw new AttentionError('bad_request', 'seen goes with go only');
    if (typeof seen !== 'string' || !ATTENTION_SEEN_RE.test(seen)) {
      throw new AttentionError('bad_request', 'seen must be 8 to 64 hex digits');
    }
    out.seen = seen;
  }
  if (draft !== undefined) {
    if (gesture !== 'go') throw new AttentionError('bad_request', 'draft goes with go only');
    if (typeof draft !== 'string') throw new AttentionError('bad_request', 'draft must be a string');
    if (CONTROL_RE.test(draft)) throw new AttentionError('bad_request', 'draft must not contain control characters');
    if (Buffer.byteLength(draft, 'utf8') > ATTENTION_DRAFT_MAX) {
      throw new AttentionError('bad_request', `draft is longer than ${ATTENTION_DRAFT_MAX} bytes`);
    }
    // Le texte exact de Robin, tel quel ; un brouillon vide n'est pas un brouillon.
    if (draft.trim().length > 0) out.draft = draft;
  }
  if (cardSeen !== undefined) {
    if (typeof cardSeen !== 'string' || !ATTENTION_SEEN_RE.test(cardSeen)) {
      throw new AttentionError('bad_request', 'cardSeen must be 8 to 64 hex digits');
    }
    out.cardSeen = cardSeen;
  }
  if (clientId !== undefined) {
    if (typeof clientId !== 'string' || !ATTENTION_CLIENT_ID_RE.test(clientId)) {
      throw new AttentionError('bad_request', 'clientId must be 1 to 64 letters, digits, - or _, not starting with -');
    }
    out.clientId = clientId;
  }
  return out;
}

/**
 * L'argv d'un geste, la forme exacte de Kova (`gesture_argv`) : `act --by robin
 * --exit-codes --client-id=<id> [--card-seen=<x>] <carte> <mot> [--text=<T>] [--seen=<S>]
 * [--draft=<D>]`. Chaque valeur est UN element avec `=` : un texte qui commence par `--`
 * ne se lit jamais comme une option.
 */
export function gestureArgv(id: string, g: CheckedGesture & { clientId: string }): string[] {
  const argv = ['act', ...BY_ROBIN, EXIT_CODES, `${CLIENT_ID}=${g.clientId}`];
  if (g.cardSeen !== undefined) argv.push(`${CARD_SEEN}=${g.cardSeen}`);
  argv.push(id, g.gesture);
  if (g.text !== undefined) argv.push(`--text=${g.text}`);
  if (g.gesture === 'go' && g.seen !== undefined) argv.push(`--seen=${g.seen}`);
  if (g.gesture === 'go' && g.draft !== undefined) argv.push(`--draft=${g.draft}`);
  return argv;
}

/** Un mot d'une carte incertaine, valide : seul `seen` l'accompagne. */
export interface CheckedUncertain {
  word: AttentionUncertainWord;
  seen?: string;
}

/**
 * Valide `parti` ou `Renvoyer` avant de lancer quoi que ce soit : ni texte ni brouillon,
 * `seen` une empreinte, `clientId` et `cardSeen` de la bonne forme mais pas transmis (Kova
 * ne les passe pas pour ces deux mots).
 */
export function checkUncertain(body: {
  gesture?: unknown;
  text?: unknown;
  seen?: unknown;
  draft?: unknown;
  cardSeen?: unknown;
  clientId?: unknown;
}): CheckedUncertain {
  const { gesture, text, seen, draft, cardSeen, clientId } = body;
  if (!isAttentionUncertainWord(gesture)) {
    throw new AttentionError('bad_request', `gesture must be one of ${ATTENTION_UNCERTAIN_WORDS.join(', ')}`);
  }
  if (text !== undefined && (typeof text !== 'string' || text.trim().length > 0)) {
    throw new AttentionError('bad_request', `${gesture} carries no text`);
  }
  if (draft !== undefined) throw new AttentionError('bad_request', `${gesture} carries no draft`);
  if (cardSeen !== undefined && (typeof cardSeen !== 'string' || !ATTENTION_SEEN_RE.test(cardSeen))) {
    throw new AttentionError('bad_request', 'cardSeen must be 8 to 64 hex digits');
  }
  if (clientId !== undefined && (typeof clientId !== 'string' || !ATTENTION_CLIENT_ID_RE.test(clientId))) {
    throw new AttentionError('bad_request', 'clientId must be 1 to 64 letters, digits, - or _, not starting with -');
  }
  const out: CheckedUncertain = { word: gesture };
  if (seen !== undefined) {
    if (typeof seen !== 'string' || !ATTENTION_SEEN_RE.test(seen)) {
      throw new AttentionError('bad_request', 'seen must be 8 to 64 hex digits');
    }
    out.seen = seen;
  }
  return out;
}

/**
 * L'argv de `parti` ou `Renvoyer`, la forme de Kova (`verb_argv_with` puis `with_seen`) :
 * `act --by robin --exit-codes <carte> <mot> [--seen=<S>]`.
 */
export function uncertainArgv(id: string, u: CheckedUncertain): string[] {
  const argv = ['act', ...BY_ROBIN, EXIT_CODES, id, u.word];
  if (u.seen !== undefined) argv.push(`--seen=${u.seen}`);
  return argv;
}

/** L'argv d'un report : `snooze --by robin --until=<ISO> <carte>`. */
export function snoozeArgv(id: string, until: string): string[] {
  return ['snooze', ...BY_ROBIN, `--until=${until}`, id];
}

/** Une ligne d'`attn` montrable : sans controle, bornee. */
function lineOf(s: string, max: number): string {
  return shown(s.trim(), max).trim();
}

/**
 * Ce que dit la sortie d'un geste (`delivery_of`, `said_line` et `run_click_with` de
 * Kova). 0 : remis, ou la file le dit elle-meme sur sa premiere ligne (`said`) ; 3 : note,
 * remise a venir ; 4, ou tout autre code avec une ligne sur `stderr` : refuse, cette ligne
 * est le message d'`attn` a Robin et part vers l'app (`refusalOf`) ; 5 : la carte a change ;
 * sans code (spawn, delai, signal) ou sans ligne : un echec, dont la sortie reste sur le Mac.
 */
export function gestureOutcome(res: { code: number; stdout: string; stderr: string }): AttentionGestureResponse {
  if (res.code === EXIT_DELIVERED) {
    const first = lineOf(res.stdout.split('\n')[0] ?? '', SAID_MAX);
    if (SAID_PREFIXES.some((p) => first.startsWith(p))) return { outcome: 'said', line: first };
    return { outcome: 'delivered' };
  }
  if (res.code === EXIT_NOTED) return { outcome: 'noted' };
  if (res.code === EXIT_CARD_CHANGED) {
    throw new AttentionError('card_changed', 'the card changed since it was shown, nothing was noted');
  }
  throw refusalOf(res, 'act');
}

/**
 * Un geste qu'`attn` a refuse : il a rendu un code (4, ou un autre que 0, 3 et 5) et dit
 * pourquoi sur `stderr`. Sa premiere ligne part vers l'app, nettoyee, 140 caracteres, comme
 * Kova la montre (« Non transmis : <ligne> », `run_click_with`) ; la fin « (noté dans ...) »
 * est coupee, elle ne porte qu'un chemin du journal. Sans code ou sans ligne : un echec,
 * dont la sortie reste sur le Mac (502).
 */
export function refusalOf(res: { code: number; stdout: string; stderr: string }, what: string): AttentionError {
  if (res.code > 0) {
    const first = res.stderr.split('\n').find((l) => l.trim().length > 0) ?? '';
    const cut = first.indexOf(' (noté dans');
    const line = lineOf(cut === -1 ? first : first.slice(0, cut), REFUSED_MAX);
    if (line.length > 0) return new AttentionError('refused', line);
    if (res.code === EXIT_REFUSED) return new AttentionError('refused', 'refused by attn');
  }
  return new AttentionError('attn_failed', failure(what, res));
}

// ISO 8601 avec l'heure et un decalage (`Z` ou `+01:00`).
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Valide une date de report : ISO avec decalage, lisible, future, a 60 jours au plus. */
export function checkUntil(until: unknown, nowMs: number): string {
  if (typeof until !== 'string' || !ISO_WITH_OFFSET_RE.test(until)) {
    throw new AttentionError('bad_request', 'until must be an ISO 8601 date with an offset');
  }
  const at = Date.parse(until);
  if (!Number.isFinite(at)) throw new AttentionError('bad_request', 'until does not read as a date');
  if (at <= nowMs) throw new AttentionError('bad_request', 'until must be in the future');
  if (at > nowMs + ATTENTION_SNOOZE_MAX_DAYS * 24 * 3600_000) {
    throw new AttentionError('bad_request', `until must be within ${ATTENTION_SNOOZE_MAX_DAYS} days`);
  }
  return until;
}

/** Combien de cartes gardent l'identifiant de leur dernier clic. */
const CLIENT_IDS_MAX = 500;

/**
 * La file cote daemon : une lecture gardee `ATTENTION_CACHE_MS`, un seul `attn list` en
 * vol, et les gestes. `snapshot()` rend la derniere lecture sans attendre, pour le calcul
 * synchrone de `waitsOnYou`.
 *
 * `generation` avance a chaque `invalidate()` : une lecture partie avant ne fixe ni
 * l'heure de lecture ni la liste, et n'est pas reprise par un appelant venu apres.
 */
export class AttentionBoard {
  private entries: AttentionEntry[] = [];
  private readAt = Number.NEGATIVE_INFINITY;
  private generation = 0;
  private running: { gen: number; run: Promise<AttentionEntry[]> } | null = null;
  /** Un geste en cours pour cet identifiant : le second est refuse, pas lance deux fois. */
  private readonly acting = new Set<string>();
  /** Le dernier `Envoyer` reussi par identifiant, en ms epoch. */
  private readonly sentAt = new Map<string, number>();
  /**
   * Le dernier geste du Cockpit par carte et l'identifiant de clic qu'il a recu, quand
   * l'app n'en donne pas : le meme geste avec le meme texte et le meme brouillon, reessaye,
   * reprend l'identifiant, et la file ne le note pas deux fois (`client_id_for` de Kova).
   */
  private readonly clientIds = new Map<string, { key: string; clientId: string }>();

  constructor(
    private readonly exec: Exec,
    private readonly now: () => number = Date.now,
  ) {}

  /** La derniere lecture reussie, vide avant la premiere. */
  snapshot(): AttentionEntry[] {
    return this.entries;
  }

  /** Oublie la lecture : la suivante relance `attn`. */
  invalidate(): void {
    this.generation += 1;
    this.readAt = Number.NEGATIVE_INFINITY;
  }

  /** Les entrees ouvertes, relues si la derniere lecture a plus de 10 s. */
  async list(): Promise<AttentionEntry[]> {
    if (this.now() - this.readAt < ATTENTION_CACHE_MS) return this.entries;
    const gen = this.generation;
    if (this.running && this.running.gen === gen) return this.running.run;
    const run = this.load(gen).finally(() => {
      if (this.running?.run === run) this.running = null;
    });
    this.running = { gen, run };
    return run;
  }

  /** Une lecture neuve, jamais celle du cache ni une lecture partie avant cet appel. */
  fresh(): Promise<AttentionEntry[]> {
    this.invalidate();
    return this.list();
  }

  private async load(gen: number): Promise<AttentionEntry[]> {
    const res = await this.exec([...LIST_ARGV]);
    if (res.code !== 0) throw new AttentionError('attn_failed', failure('list', res));
    const entries = parseAttention(res.stdout);
    // Invalidee pendant la lecture : son resultat sert a l'appelant, pas au cache.
    if (gen !== this.generation) return entries;
    this.entries = entries;
    this.readAt = this.now();
    return entries;
  }

  /**
   * Un geste de Robin sur une entree. Tout est valide AVANT de lancer quoi que ce soit :
   * l'identifiant, le bouton, le texte. Puis l'entree est relue parmi les ouvertes, et
   * l'argv est construit ici, jamais recu de l'app.
   */
  async act(id: unknown, button: unknown, note: unknown): Promise<AttentionActResponse> {
    if (typeof id !== 'string' || !ATTENTION_ID_RE.test(id)) {
      throw new AttentionError('bad_request', 'id must match a-xxxxxx');
    }
    if (!isAttentionButton(button)) {
      throw new AttentionError('bad_request', 'button must be Envoyer, Ignorer, Fait or Ouvrir');
    }
    if (note !== undefined && typeof note !== 'string') {
      throw new AttentionError('bad_request', 'text must be a string');
    }
    const body = typeof note === 'string' ? note.trim() : '';
    if (CONTROL_RE.test(body)) {
      throw new AttentionError('bad_request', 'text must not contain control characters');
    }
    if (Buffer.byteLength(body, 'utf8') > ATTENTION_TEXT_MAX) {
      throw new AttentionError('bad_request', `text is longer than ${ATTENTION_TEXT_MAX} bytes`);
    }
    if (body.length > 0 && button !== 'Envoyer') {
      throw new AttentionError('bad_request', 'only Envoyer carries a text');
    }
    const argv = attentionArgv(id, button, body);
    if (argv === null) throw new AttentionError('bad_request', 'Ouvrir opens on the phone, nothing to record');
    if (this.acting.has(id)) throw new AttentionError('busy', 'an action is already running on this entry');
    const sent = this.sentAt.get(id);
    if (button === 'Envoyer' && sent !== undefined && this.now() - sent < ATTENTION_RESEND_MS) {
      throw new AttentionError('already_sent', 'Envoyer was already sent for this entry');
    }
    this.acting.add(id);
    try {
      // Lecture neuve : une entree fermee sur le Mac il y a 5 s ne recoit plus rien.
      const entry = (await this.fresh()).find((e) => e.id === id);
      if (!entry) throw new AttentionError('not_found', 'no open entry with this id');
      if (!(KINDS_OF[button] ?? []).includes(entry.kind)) {
        throw new AttentionError('bad_request', `${button} does not apply to a ${entry.kind} entry`);
      }
      const res = await this.exec(argv);
      if (res.code !== 0 && !(argv[0] === 'act' && res.code === 3)) {
        throw new AttentionError('attn_failed', failure(argv[0] ?? '', res));
      }
      if (button === 'Envoyer') this.sentAt.set(id, this.now());
      for (const [key, at] of this.sentAt) if (this.now() - at >= ATTENTION_RESEND_MS) this.sentAt.delete(key);
      this.invalidate();
      return { applied: true, op: argv[0] === 'act' ? 'act' : 'close' };
    } finally {
      this.acting.delete(id);
    }
  }

  /** L'identifiant de clic d'un geste sans `clientId` de l'app : repris pour un meme essai. */
  private clientIdFor(id: string, g: CheckedGesture): string {
    const key = JSON.stringify([g.gesture, g.text ?? '', g.draft ?? '']);
    const known = this.clientIds.get(id);
    if (known && known.key === key) return known.clientId;
    const clientId = randomUUID();
    this.clientIds.delete(id);
    this.clientIds.set(id, { key, clientId });
    // Les plus anciennes s'en vont d'abord : l'ordre d'insertion de `Map`.
    for (const old of this.clientIds.keys()) {
      if (this.clientIds.size <= CLIENT_IDS_MAX) break;
      this.clientIds.delete(old);
    }
    return clientId;
  }

  /** Une carte ouverte relue a neuf, sous la garde « un geste a la fois » par carte. */
  private async onOpenCard<T>(id: string, run: (entry: AttentionEntry) => Promise<T>): Promise<T> {
    if (this.acting.has(id)) throw new AttentionError('busy', 'an action is already running on this entry');
    this.acting.add(id);
    try {
      // Lecture neuve : une carte classee sur le Mac il y a 5 s ne recoit plus rien.
      const entry = (await this.fresh()).find((e) => e.id === id);
      if (!entry) throw new AttentionError('not_found', 'no open entry with this id');
      return await run(entry);
    } finally {
      this.acting.delete(id);
    }
  }

  /**
   * Un geste du Cockpit, comme Kova le passe : tout est valide avant de lancer quoi que ce
   * soit, puis la carte est relue et le geste doit etre un de ceux qu'elle offre. L'argv est
   * construit ici, jamais recu de l'app.
   */
  async gesture(id: unknown, body: Parameters<typeof checkGesture>[0]): Promise<AttentionGestureResponse> {
    if (typeof id !== 'string' || !ATTENTION_ID_RE.test(id)) {
      throw new AttentionError('bad_request', 'id must match a-xxxxxx');
    }
    if (isAttentionUncertainWord(body.gesture)) {
      const u = checkUncertain(body);
      return this.onOpenCard(id, async (entry) => {
        // Seulement sur une carte dont l'envoi est incertain, relue a l'instant.
        if (entry.uncertain === undefined) {
          throw new AttentionError('not_offered', `${u.word} applies to an uncertain card only`);
        }
        const res = await this.exec(uncertainArgv(id, u));
        try {
          return gestureOutcome(res);
        } finally {
          this.invalidate();
        }
      });
    }
    const g = checkGesture(body);
    return this.onOpenCard(id, async (entry) => {
      if (!(entry.gestures ?? []).includes(g.gesture)) {
        throw new AttentionError('not_offered', `${g.gesture} is not offered on this card`);
      }
      const clientId = g.clientId ?? this.clientIdFor(id, g);
      const res = await this.exec(gestureArgv(id, { ...g, clientId }));
      try {
        return gestureOutcome(res);
      } finally {
        // Une carte classee, une question posee ou un refus : la prochaine lecture le montre.
        this.invalidate();
      }
    });
  }

  /** Un report a une date : la carte doit etre ouverte, la date future et a 60 jours au plus. */
  async snooze(id: unknown, until: unknown): Promise<AttentionSnoozeResponse> {
    if (typeof id !== 'string' || !ATTENTION_ID_RE.test(id)) {
      throw new AttentionError('bad_request', 'id must match a-xxxxxx');
    }
    const date = checkUntil(until, this.now());
    return this.onOpenCard(id, async () => {
      const res = await this.exec(snoozeArgv(id, date));
      if (res.code !== 0) throw refusalOf(res, 'snooze');
      this.invalidate();
      return { applied: true };
    });
  }
}
