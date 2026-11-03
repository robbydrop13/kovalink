// Routines locales de Robin : seul `routinectl` les connait, le daemon ne lit jamais
// leurs fichiers lui-meme. Chaque appel lui passe un argv, jamais une ligne de shell. Les
// chemins (`cwd`, prompt) restent sur le Mac. Le journal, lui, sort avec le prefixe du
// dossier personnel ramene a `~` : une ligne de log nomme un fichier sans donner au
// telephone le nom d'utilisateur du Mac.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Routine,
  RoutineActionResponse,
  RoutineLastRun,
  RoutineLogResponse,
  RoutinesResponse,
} from '@kovalink/protocol';

/** Ce qu'une commande rend : le code de sortie et les deux flux, deja lus. */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Lance `argv` (jamais une chaine) et rend son resultat, sans lever sur un code non nul. */
export type Exec = (argv: string[]) => Promise<ExecResult>;

/** Plafond d'un journal, en lignes. */
export const ROUTINE_LOG_LINES = 200;

/** `list` et `logs` lisent des fichiers ; un geste (`run`, `disable`, `enable`) passe par
 *  launchd et peut attendre. Deux plafonds, pour ne pas laisser un `list` pendu 30 s. */
const TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const STDERR_MAX = 200;

/** Le format que `routinectl` accepte comme nom de routine (donc comme nom de fichier). */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Un geste deja en cours pour ce nom. `routinectl run` peut durer : deux appuis sur
 * « Run now » ne doivent pas lancer la routine deux fois, ni faire attendre le second.
 */
const inFlight = new Set<string>();

/** Chemin de `routinectl`, surchargeable par `KOVALINK_ROUTINECTL` (tests, install custom). */
export function routinectlPath(): string {
  return process.env['KOVALINK_ROUTINECTL'] ?? join(homedir(), '.claude', 'routines', 'routinectl');
}

/**
 * Executeur par defaut : `execFile`, jamais un shell, 20 s pour une lecture et 30 s pour
 * un geste. Un binaire absent (`ENOENT`) n'a pas de code numerique : il vaut un echec,
 * avec le message de spawn dans `stderr` pour le journal local.
 */
export const execRoutinectl: Exec = (argv) => {
  const isRead = argv[0] === 'list' || argv[0] === 'logs';
  return new Promise((resolve) => {
    execFile(
      routinectlPath(),
      argv,
      {
        timeout: isRead ? TIMEOUT_MS : ACTION_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown }) | null;
        const code = e === null ? 0 : typeof e.code === 'number' ? e.code : 1;
        resolve({ code, stdout: stdout ?? '', stderr: stderr || (e?.message ?? '') });
      },
    );
  });
};

/** Echec d'un appel : nom inconnu (404 cote route) ou `routinectl` en echec (502). */
export class RoutineError extends Error {
  constructor(
    readonly reason: 'unknown_routine' | 'routinectl_failed',
    message: string,
  ) {
    super(message);
    this.name = 'RoutineError';
  }
}

/** Derniere ligne de `stderr`, bornee : le message part dans le journal local seulement. */
function failure(what: string, res: ExecResult): string {
  const why = res.stderr.trim().split('\n').pop() ?? '';
  return `routinectl ${what}: code ${res.code}${why ? ` (${why.slice(0, STDERR_MAX)})` : ''}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function flag(v: unknown): boolean {
  return v === true;
}

/** `last` n'est garde que complet : un passage sans code de sortie ne dit rien de sûr. */
function lastRun(v: unknown): RoutineLastRun | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const start = o['start'];
  const end = o['end'];
  const code = o['code'];
  if (typeof start !== 'string' || typeof end !== 'string' || typeof code !== 'number') return null;
  return { start, end, code };
}

/**
 * Une entree de `routinectl list --json` vers le protocole : snake_case vers camelCase,
 * et `cwd`/`prompt`/`log` restent sur le Mac. Une entree sans nom valide est ignoree :
 * elle ne peut pas etre designee par une route.
 */
function toRoutine(raw: Record<string, unknown>): Routine | null {
  const name = str(raw['name']);
  if (!NAME_RE.test(name)) return null;
  return {
    name,
    schedule: str(raw['schedule']),
    scheduleWords: str(raw['schedule_words']),
    enabled: flag(raw['enabled']),
    done: flag(raw['done']),
    active: flag(raw['active']),
    manual: flag(raw['manual']),
    loaded: flag(raw['loaded']),
    running: flag(raw['running']),
    nextRun: typeof raw['next_run'] === 'string' ? raw['next_run'] : null,
    last: lastRun(raw['last']),
    description: str(raw['description']),
  };
}

/** Un seul `routinectl list --json` en vol par executeur (voir `listRoutines`). */
const listings = new WeakMap<Exec, Promise<RoutinesResponse>>();

/**
 * Les routines actives, telles que `routinectl list --json` les rend. Les routines `done`
 * (schedule `once` deja passee) sont filtrees : elles ne se relancent plus.
 *
 * Un seul appel en vol par executeur : l'accueil, l'onglet Scheduled et un geste le
 * demandent souvent dans la meme seconde, et chaque appel est un processus. Les appelants
 * simultanes partagent la reponse en cours, oubliee des qu'elle arrive, donc l'appel
 * suivant relit le disque.
 */
export function listRoutines(exec: Exec): Promise<RoutinesResponse> {
  const running = listings.get(exec);
  if (running) return running;
  const run: Promise<RoutinesResponse> = readList(exec).finally(() => {
    if (listings.get(exec) === run) listings.delete(exec);
  });
  listings.set(exec, run);
  return run;
}

async function readList(exec: Exec): Promise<RoutinesResponse> {
  const res = await exec(['list', '--json']);
  if (res.code !== 0) throw new RoutineError('routinectl_failed', failure('list', res));
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new RoutineError('routinectl_failed', 'routinectl list --json: sortie illisible');
  }
  if (!Array.isArray(parsed)) {
    throw new RoutineError('routinectl_failed', 'routinectl list --json: tableau attendu');
  }
  const routines: Routine[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const routine = toRoutine(raw as Record<string, unknown>);
    if (routine && !routine.done) routines.push(routine);
  }
  return { routines };
}

/**
 * La routine nommee, ou `null` : un nom hors format ne part jamais vers `routinectl`, et
 * un nom absent de la liste courante est inconnu. `list` est relu a chaque appel : pas
 * d'etat local a perimer quand une routine est ajoutee ou retiree a la main.
 */
async function findRoutine(exec: Exec, name: string): Promise<Routine | null> {
  if (!NAME_RE.test(name)) return null;
  const { routines } = await listRoutines(exec);
  return routines.find((routine) => routine.name === name) ?? null;
}

/**
 * Un geste : `routinectl run`, `disable` ou `enable`. Le nom est relu dans la liste
 * courante, un second geste pour le meme nom est refuse (`busy`), et `run` sur une
 * routine suspendue aussi (`paused`) : `routinectl` sort alors 0 sans rien lancer, ce
 * qui laissait l'app croire que la routine etait partie.
 */
async function act(
  exec: Exec,
  name: string,
  command: 'run' | 'disable' | 'enable',
): Promise<RoutineActionResponse> {
  if (inFlight.has(name)) return { applied: false, reason: 'busy' };
  inFlight.add(name);
  try {
    let routine: Routine | null;
    try {
      routine = await findRoutine(exec, name);
    } catch (e) {
      if (e instanceof RoutineError) return { applied: false, reason: e.reason };
      throw e;
    }
    if (routine === null) return { applied: false, reason: 'unknown_routine' };
    if (command === 'run' && !routine.enabled) return { applied: false, reason: 'paused' };
    const res = await exec([command, name]);
    if (res.code !== 0) return { applied: false, reason: 'routinectl_failed' };
    return { applied: true };
  } finally {
    inFlight.delete(name);
  }
}

export function runRoutine(exec: Exec, name: string): Promise<RoutineActionResponse> {
  return act(exec, name, 'run');
}

/** Pause = `disable` : `enabled: false` dans l'en-tete de la routine, puis `sync`. */
export function pauseRoutine(exec: Exec, name: string): Promise<RoutineActionResponse> {
  return act(exec, name, 'disable');
}

/** Reprise = `enable`. */
export function resumeRoutine(exec: Exec, name: string): Promise<RoutineActionResponse> {
  return act(exec, name, 'enable');
}

/**
 * Les `ROUTINE_LOG_LINES` dernieres lignes du journal. `-n` borne deja la lecture ; la
 * tranche ici protege d'un `routinectl` qui l'ignorerait.
 *
 * Une ligne de log nomme des fichiers du Mac : le prefixe du dossier personnel part en
 * `~`, pour que le telephone ne recoive jamais le nom d'utilisateur de la machine.
 */
export async function routineLog(exec: Exec, name: string): Promise<RoutineLogResponse> {
  if ((await findRoutine(exec, name)) === null) {
    throw new RoutineError('unknown_routine', 'unknown routine');
  }
  const res = await exec(['logs', name, '-n', String(ROUTINE_LOG_LINES)]);
  if (res.code !== 0) throw new RoutineError('routinectl_failed', failure('logs', res));
  const home = homedir();
  const lines = res.stdout.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { lines: lines.slice(-ROUTINE_LOG_LINES).map((line) => line.split(home).join('~')) };
}
