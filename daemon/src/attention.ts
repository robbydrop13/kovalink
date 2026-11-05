// File d'attention de Robin : seul le CLI `attn` la connait, le daemon ne lit jamais son
// journal lui-meme. Chaque appel lui passe un argv fixe, jamais une ligne de shell : la
// lecture (`list --open --json`), un clic transmis au chief (`act`) et une fermeture
// (`close`). Le corps d'une entree reste dans la reponse ; la sortie de `attn` (messages,
// chemins du Mac) ne part jamais vers l'app.
//
// Les entrees `now` comptent dans `waitsOnYou` comme une question : la lecture est
// gardee 10 s, et le daemon la relit au meme rythme pour que la pastille suive.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ATTENTION_ID_RE,
  ATTENTION_LEVELS,
  ATTENTION_TEXT_MAX,
  isAttentionButton,
  type AttentionActResponse,
  type AttentionEntry,
  type AttentionLevel,
} from '@kovalink/protocol';
import type { Exec } from './routines.js';

/** Duree de vie de la derniere lecture, et cadence du sondage de `main.ts`. */
export const ATTENTION_CACHE_MS = 10_000;

/** `list` lit un fichier ; `act` peut attendre que le chief recoive le clic. */
const LIST_TIMEOUT_MS = 10_000;
const ACT_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const STDERR_MAX = 200;

/** Les notes de fermeture, au mot pres : celles que Kova ecrit, marquees KovaLink. */
export const NOTE_DONE = 'Fait (KovaLink)';
export const NOTE_IGNORED = 'Ignore (KovaLink)';

/** Chemin du CLI `attn`, surchargeable par `KOVALINK_ATTN` (tests, install custom). */
export function attnPath(): string {
  return process.env['KOVALINK_ATTN'] ?? join(homedir(), '.local', 'bin', 'attn');
}

/**
 * Executeur par defaut : `execFile`, jamais un shell. Un CLI absent (`ENOENT`) n'a pas de
 * code numerique : il vaut un echec, avec le message de spawn dans `stderr` pour le
 * journal local.
 */
export const execAttn: Exec = (argv) => {
  const isList = argv[0] === 'list';
  return new Promise((resolve) => {
    execFile(
      attnPath(),
      argv,
      { timeout: isList ? LIST_TIMEOUT_MS : ACT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown }) | null;
        const code = e === null ? 0 : typeof e.code === 'number' ? e.code : 1;
        resolve({ code, stdout: stdout ?? '', stderr: stderr || (e?.message ?? '') });
      },
    );
  });
};

/**
 * Refus d'un geste : requete hors format (400, rien n'est lance), entree qui n'est plus
 * ouverte (404), geste deja en cours sur elle (409), `attn` en echec (502).
 */
export class AttentionError extends Error {
  constructor(
    readonly reason: 'bad_request' | 'not_found' | 'busy' | 'attn_failed',
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
  }
  return entry;
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
    return note.length > 0 ? ['act', id, 'Envoyer', `--text=${note}`] : ['act', id, 'Envoyer'];
  }
  if (button === 'Fait') return ['close', id, '--note', NOTE_DONE, '--by', 'robin'];
  if (button === 'Ignorer') return ['close', id, '--note', NOTE_IGNORED, '--by', 'robin'];
  return null;
}

/**
 * La file cote daemon : une lecture gardee `ATTENTION_CACHE_MS`, un seul `attn list` en
 * vol, et les gestes. `snapshot()` rend la derniere lecture sans attendre, pour le calcul
 * synchrone de `waitsOnYou`.
 */
export class AttentionBoard {
  private entries: AttentionEntry[] = [];
  private readAt = Number.NEGATIVE_INFINITY;
  private running: Promise<AttentionEntry[]> | null = null;
  /** Un geste en cours pour cet identifiant : le second est refuse, pas lance deux fois. */
  private readonly acting = new Set<string>();

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
    this.readAt = Number.NEGATIVE_INFINITY;
  }

  /** Les entrees ouvertes, relues si la derniere lecture a plus de 10 s. */
  async list(): Promise<AttentionEntry[]> {
    if (this.now() - this.readAt < ATTENTION_CACHE_MS) return this.entries;
    if (this.running) return this.running;
    const run = this.load().finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  private async load(): Promise<AttentionEntry[]> {
    const res = await this.exec(['list', '--open', '--json']);
    if (res.code !== 0) throw new AttentionError('attn_failed', failure('list', res));
    this.entries = parseAttention(res.stdout);
    this.readAt = this.now();
    return this.entries;
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
    if (Buffer.byteLength(body, 'utf8') > ATTENTION_TEXT_MAX) {
      throw new AttentionError('bad_request', `text is longer than ${ATTENTION_TEXT_MAX} bytes`);
    }
    if (body.length > 0 && button !== 'Envoyer') {
      throw new AttentionError('bad_request', 'only Envoyer carries a text');
    }
    const argv = attentionArgv(id, button, body);
    if (argv === null) throw new AttentionError('bad_request', 'Ouvrir opens on the phone, nothing to record');
    if (this.acting.has(id)) throw new AttentionError('busy', 'an action is already running on this entry');
    this.acting.add(id);
    try {
      const open = await this.list();
      if (!open.some((e) => e.id === id)) throw new AttentionError('not_found', 'no open entry with this id');
      const res = await this.exec(argv);
      if (res.code !== 0) throw new AttentionError('attn_failed', failure(argv[0] ?? '', res));
      this.invalidate();
      return { applied: true, op: argv[0] === 'act' ? 'act' : 'close' };
    } finally {
      this.acting.delete(id);
    }
  }
}
