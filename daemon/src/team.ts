// Equipe d'agents de Robin : seul le CLI `team` la connait, le daemon ne lit ni
// `registry.json` ni les profils. Chaque appel lui passe un argv, jamais une ligne de
// shell. L'argv de reouverture rendu par `team list --json` reste sur le Mac : la
// reponse ne porte que les noms, les roles et l'etat.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isTeamStatus,
  type AgentActionResponse,
  type AgentState,
  type AgentsRosterResponse,
  type RosterEntry,
} from '@kovalink/protocol';
import type { Exec } from './routines.js';

/** `list` lit un registre ; `reopen` relance une session entiere et peut prendre plus. */
const LIST_TIMEOUT_MS = 20_000;
const REOPEN_TIMEOUT_MS = 45_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const STDERR_MAX = 200;

/** Le format que `team spawn` accepte comme nom de session (donc un identifiant sur). */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Une reouverture en cours pour ce nom : la seconde est refusee plutot que de lancer
 * deux fois le meme `claude`.
 */
const reopening = new Set<string>();

/** Chemin du CLI `team`, surchargeable par `KOVALINK_TEAM` (tests, install custom). */
export function teamPath(): string {
  return (
    process.env['KOVALINK_TEAM'] ?? join(homedir(), 'AI directory', 'claude-config', 'team', 'team')
  );
}

/**
 * Executeur par defaut : `execFile`, jamais un shell, 20 s pour une lecture et 45 s pour
 * une reouverture. Un CLI absent (`ENOENT`) n'a pas de code numerique : il vaut un echec,
 * avec le message de spawn dans `stderr` pour le journal local.
 */
export const execTeam: Exec = (argv) => {
  const isReopen = argv[0] === 'reopen';
  return new Promise((resolve) => {
    execFile(
      teamPath(),
      argv,
      {
        timeout: isReopen ? REOPEN_TIMEOUT_MS : LIST_TIMEOUT_MS,
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

/** Echec d'un appel : `team` en echec (502), ou roster lu pour un nom inconnu (404). */
export class TeamError extends Error {
  constructor(
    readonly reason: 'unknown_agent' | 'team_failed',
    message: string,
  ) {
    super(message);
    this.name = 'TeamError';
  }
}

/** Derniere ligne de `stderr`, bornee : le message part dans le journal local seulement. */
function failure(what: string, res: { code: number; stderr: string }): string {
  const why = res.stderr.trim().split('\n').pop() ?? '';
  return `team ${what}: code ${res.code}${why ? ` (${why.slice(0, STDERR_MAX)})` : ''}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function state(v: unknown): AgentState | null {
  return v === 'working' || v === 'open' || v === 'closed' ? v : null;
}

/**
 * Une entree de `team list --json` vers le protocole : les champs optionnels vides sont
 * omis, et une entree sans nom valide ou sans etat connu est ignoree. Elle ne peut pas
 * etre designee par la route de reouverture. L'etat declare (`status`, `doing`,
 * `waiting_on`, `status_at`, ecrits par `attn status`) passe en `camelCase` ; un `status`
 * hors de la liste fermee est omis, l'app retombe alors sur l'affichage d'avant.
 */
function toEntry(raw: Record<string, unknown>): RosterEntry | null {
  const name = str(raw['name']);
  const st = state(raw['state']);
  if (!NAME_RE.test(name) || st === null) return null;
  const entry: RosterEntry = { name, role: str(raw['role']), state: st };
  const tab = str(raw['tab']);
  const by = str(raw['by']);
  const project = str(raw['project']);
  const created = str(raw['created']);
  if (tab) entry.tab = tab;
  if (by) entry.by = by;
  if (project) entry.project = project;
  if (created) entry.created = created;
  const status = raw['status'];
  const doing = str(raw['doing']);
  const waitingOn = str(raw['waiting_on']);
  const statusAt = str(raw['status_at']);
  if (isTeamStatus(status)) entry.status = status;
  if (doing) entry.doing = doing;
  if (waitingOn) entry.waitingOn = waitingOn;
  if (statusAt) entry.statusAt = statusAt;
  return entry;
}

/**
 * L'argv de reouverture d'une entree, nom du programme retire. Il n'est garde que s'il
 * vise bien `reopen <name>` : un roster qui pointerait ailleurs ne fait rien tourner.
 */
function reopenArgv(raw: Record<string, unknown>, name: string): string[] | null {
  const argv = raw['reopen'];
  if (!Array.isArray(argv) || argv.length < 3) return null;
  if (!argv.every((a) => typeof a === 'string')) return null;
  if (argv[1] !== 'reopen' || argv[2] !== name) return null;
  return argv.slice(1) as string[];
}

interface Roster {
  body: AgentsRosterResponse;
  /** argv de reouverture par nom, programme retire. Jamais rendu par l'API. */
  reopen: Map<string, string[]>;
}

function parseRoster(stdout: string): Roster {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new TeamError('team_failed', 'team list --json: sortie illisible');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TeamError('team_failed', 'team list --json: objet attendu');
  }
  const o = parsed as Record<string, unknown>;
  const managers = o['managers'];
  const dedicated = o['dedicated'];
  if (!Array.isArray(managers) || !Array.isArray(dedicated)) {
    throw new TeamError('team_failed', 'team list --json: tableaux attendus');
  }
  const reopen = new Map<string, string[]>();
  const convert = (rows: unknown[]): RosterEntry[] => {
    const out: RosterEntry[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const entry = toEntry(record);
      if (!entry) continue;
      const argv = reopenArgv(record, entry.name);
      if (argv) reopen.set(entry.name, argv);
      out.push(entry);
    }
    return out;
  };

  const otherOpen = Array.isArray(o['other_open'])
    ? o['other_open'].filter((n): n is string => typeof n === 'string')
    : [];
  return {
    body: { managers: convert(managers), dedicated: convert(dedicated), otherOpen },
    reopen,
  };
}

/**
 * Un seul `team list --json` en vol par executeur : l'onglet Agents et l'accueil le
 * demandent souvent dans la meme seconde, et chaque appel est un processus. Les appelants
 * simultanes partagent la reponse en cours, oubliee des qu'elle arrive.
 */
const rosters = new WeakMap<Exec, Promise<Roster>>();

function readRoster(exec: Exec): Promise<Roster> {
  const running = rosters.get(exec);
  if (running) return running;
  const run: Promise<Roster> = loadRoster(exec).finally(() => {
    if (rosters.get(exec) === run) rosters.delete(exec);
  });
  rosters.set(exec, run);
  return run;
}

async function loadRoster(exec: Exec): Promise<Roster> {
  const res = await exec(['list', '--json']);
  if (res.code !== 0) throw new TeamError('team_failed', failure('list', res));
  return parseRoster(res.stdout);
}

/** Le trombinoscope : managers, sessions dediees, autres sessions ouvertes. */
export async function getRoster(exec: Exec): Promise<AgentsRosterResponse> {
  return (await readRoster(exec)).body;
}

/**
 * Rouvre une session fermee. Le nom est d'abord valide, puis relu dans le roster
 * courant : une session ouverte n'est jamais rouverte, et l'argv execute est celui que
 * `team` a rendu pour ce nom-la, jamais une commande construite depuis l'app. Une
 * seconde demande pour le meme nom pendant que la premiere tourne est refusee.
 */
export async function reopenAgent(exec: Exec, name: string): Promise<AgentActionResponse> {
  if (!NAME_RE.test(name)) return { applied: false, reason: 'unknown_agent' };
  if (reopening.has(name)) return { applied: false, reason: 'busy' };
  reopening.add(name);
  try {
    let roster: Roster;
    try {
      roster = await readRoster(exec);
    } catch (e) {
      if (e instanceof TeamError) return { applied: false, reason: e.reason };
      throw e;
    }
    const found = [...roster.body.managers, ...roster.body.dedicated].find((a) => a.name === name);
    if (!found) return { applied: false, reason: 'unknown_agent' };
    if (found.state !== 'closed') return { applied: false, reason: 'not_closed' };
    const argv = roster.reopen.get(name);
    if (!argv) return { applied: false, reason: 'team_failed' };
    const res = await exec(argv);
    if (res.code !== 0) return { applied: false, reason: 'team_failed' };
    return { applied: true };
  } finally {
    reopening.delete(name);
  }
}
