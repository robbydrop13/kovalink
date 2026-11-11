// File d'attention de Robin : seul le CLI `attn` la connait, le daemon ne lit jamais son
// journal lui-meme. Chaque appel lui passe un argv fixe, jamais une ligne de shell : la
// lecture (`list --open --json`), un clic transmis au chief (`act`) et une fermeture
// (`close`). Le corps d'une entree reste dans la reponse ; la sortie de `attn` (messages,
// chemins du Mac) ne part jamais vers l'app.
//
// Les entrees `now` comptent dans `waitsOnYou` comme une question : la lecture est
// gardee 10 s, et le daemon la relit au meme rythme pour que la pastille suive.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
 * L'environnement d'un geste (`act`, `close`) : la cle relue a chaque geste (une cle
 * changee vaut sans relancer le daemon), passee par l'environnement, jamais en argument
 * (invisible dans `ps`), avec `ATTN_CLICK_FROM=kovalink`. Une lecture ou une cle absente :
 * l'environnement du daemon, inchange. Jamais pour `list`.
 */
export function attnEnv(argv: readonly string[]): NodeJS.ProcessEnv | undefined {
  if (argv[0] !== 'act' && argv[0] !== 'close') return undefined;
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
    readonly reason: 'bad_request' | 'not_found' | 'busy' | 'already_sent' | 'attn_failed',
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
    // `--exit-codes` : 3 = clic note, pas encore remis (le crochet ou le gardien le remet), pas un echec.
    const act = ['act', id, 'Envoyer', '--exit-codes'];
    return note.length > 0 ? [...act, `--text=${note}`] : act;
  }
  // `--reason` : le jugement de Robin, compte par `attn feedback` comme les croix et coches de Kova.
  if (button === 'Fait') return ['close', id, '--note', NOTE_DONE, '--reason', 'done', '--by', 'robin'];
  if (button === 'Ignorer') return ['close', id, '--note', NOTE_IGNORED, '--reason', 'dismissed', '--by', 'robin'];
  return null;
}

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
    const res = await this.exec(['list', '--open', '--json']);
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
}
