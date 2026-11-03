// Routines locales de Robin : seul `routinectl` les connait, le daemon ne lit jamais
// leurs fichiers lui-meme. Chaque appel lui passe un argv, jamais une ligne de shell. Les
// chemins (`cwd`, prompt, journal) ne sortent pas du Mac : la reponse ne porte que les
// noms, l'horaire et l'etat.
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

const TIMEOUT_MS = 20_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const STDERR_MAX = 200;

/** Le format que `routinectl` accepte comme nom de routine (donc comme nom de fichier). */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Chemin de `routinectl`, surchargeable par `KOVALINK_ROUTINECTL` (tests, install custom). */
export function routinectlPath(): string {
  return process.env['KOVALINK_ROUTINECTL'] ?? join(homedir(), '.claude', 'routines', 'routinectl');
}

/**
 * Executeur par defaut : `execFile`, jamais un shell, 20 s de plafond. Un binaire absent
 * (`ENOENT`) n'a pas de code numerique : il vaut un echec, avec le message de spawn dans
 * `stderr` pour le journal local.
 */
export const execRoutinectl: Exec = (argv) =>
  new Promise((resolve) => {
    execFile(
      routinectlPath(),
      argv,
      { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown }) | null;
        const code = e === null ? 0 : typeof e.code === 'number' ? e.code : 1;
        resolve({ code, stdout: stdout ?? '', stderr: stderr || (e?.message ?? '') });
      },
    );
  });

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

/**
 * Les routines actives, telles que `routinectl list --json` les rend. Les routines `done`
 * (schedule `once` deja passee) sont filtrees : elles ne se relancent plus.
 */
export async function listRoutines(exec: Exec): Promise<RoutinesResponse> {
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
 * Garde commune : un nom hors format ne part jamais vers `routinectl`, et un nom absent
 * de la liste courante est inconnu. `list` est relu a chaque appel : pas d'etat local a
 * perimer quand une routine est ajoutee ou retiree a la main.
 */
async function requireRoutine(exec: Exec, name: string): Promise<void> {
  if (!NAME_RE.test(name)) {
    throw new RoutineError('unknown_routine', 'unknown routine');
  }
  const { routines } = await listRoutines(exec);
  if (!routines.some((routine) => routine.name === name)) {
    throw new RoutineError('unknown_routine', 'unknown routine');
  }
}

async function act(
  exec: Exec,
  name: string,
  command: 'run' | 'disable' | 'enable',
): Promise<RoutineActionResponse> {
  try {
    await requireRoutine(exec, name);
  } catch (e) {
    if (e instanceof RoutineError) return { applied: false, reason: e.reason };
    throw e;
  }
  const res = await exec([command, name]);
  if (res.code !== 0) return { applied: false, reason: 'routinectl_failed' };
  return { applied: true };
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
 */
export async function routineLog(exec: Exec, name: string): Promise<RoutineLogResponse> {
  await requireRoutine(exec, name);
  const res = await exec(['logs', name, '-n', String(ROUTINE_LOG_LINES)]);
  if (res.code !== 0) throw new RoutineError('routinectl_failed', failure('logs', res));
  const lines = res.stdout.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { lines: lines.slice(-ROUTINE_LOG_LINES) };
}
