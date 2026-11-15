import { execFile, spawn } from 'node:child_process';
import { logger } from './logger.js';

/** Filet de securite contre une assertion oubliee SUR BATTERIE (A13, CA-125). */
export const SLEEP_CAP_MS = 4 * 3_600_000;
/** Cadence de relecture de l'alimentation (`main.ts`). */
export const POWER_POLL_MS = 30_000;
/** Un caffeinate qui meurt est repris apres ce delai, pas en boucle serree. */
export const RESPAWN_DELAY_MS = 5_000;

/** Ce que `SleepAssertion` attend d'un processus `caffeinate`. */
export interface SleepProcess {
  kill(): void;
  /** Previent quand le processus meurt sans qu'on l'ait tue. Absent : jamais repris. */
  onExit?(cb: () => void): void;
}

/**
 * Dependances injectables. En production : `spawn` de Node et les minuteries reelles.
 * Dans les tests : un faux `spawn` qui enregistre les arguments, et une horloge simulee.
 */
export interface SleepDeps {
  spawn: (args: string[]) => SleepProcess;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  pid: number;
  /** Horloge, en millisecondes. Absente : `Date.now`. */
  now?: () => number;
}

/** Pourquoi le Mac est tenu eveille : `ac` sur secteur, `agent` sur batterie. */
export type SleepMode = 'ac' | 'agent';

/** Ce que `state.json` et `kovalinkd status` disent de l'anti-veille. */
export interface SleepState {
  held: boolean;
  reason: SleepMode | null;
  /** Pose de l'assertion en cours, ISO. */
  since: string | null;
  power: 'ac' | 'battery' | 'unknown';
}

/**
 * `pmset -g batt` commence par « Now drawing from 'AC Power' » ou « 'Battery Power' ».
 * Un Mac sans batterie repond toujours « AC Power ». Sortie illisible : `null`, et
 * l'appelant garde ce qu'il savait.
 */
export function parseAcPower(out: string): boolean | null {
  const m = /Now drawing from '([^']+)'/.exec(out);
  if (!m) return null;
  return m[1] === 'AC Power';
}

/** Lecture de l'alimentation, jamais bloquante. `null` si `pmset` echoue ou se tait. */
export function readAcPower(): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 2_000 }, (err, stdout) => {
      resolve(err ? null : parseAcPower(stdout));
    });
  });
}

const realSleepDeps: SleepDeps = {
  spawn: (args) => {
    const proc = spawn('/usr/bin/caffeinate', args, { stdio: 'ignore' });
    proc.unref();
    return {
      kill: () => void proc.kill(),
      onExit: (cb) => {
        proc.once('exit', cb);
        proc.once('error', cb);
      },
    };
  },
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  pid: process.pid,
};

/**
 * Anti-veille (A1, A13).
 *
 * SUR SECTEUR, le Mac ne dort jamais (Robin, 15 novembre : « le Mac ne doit jamais
 * s'endormir, sinon il arrete de travailler »). Les agents, les routines et l'iPhone
 * comptent tous sur un Mac eveille, et l'ancienne regle, eveille seulement pendant qu'un
 * agent travaille, le laissait dormir a l'instant ou tous attendaient Robin : garde
 * relachee a 14:30:36, telephone connecte a 14:31:51, veille a 14:32:08, reveil au
 * clavier a 15:02:52. Onze veilles en trois jours suivaient ainsi une relache de 20 s a
 * 2 min. Sur secteur l'assertion est donc permanente, sans fenetre ni plafond.
 *
 * SUR BATTERIE, la regle d'origine reste : tant qu'un agent travaille, sous un plafond de
 * 4 h. Le plafond est une MINUTERIE armee a la pose ; une fois atteint, aucune nouvelle
 * assertion tant que tout ne s'est pas arrete au moins une fois.
 *
 * Dans les deux cas `caffeinate -i` : une assertion IOKit `PreventUserIdleSystemSleep`,
 * donc la veille par INACTIVITE seule. L'ecran s'eteint normalement (pas de `-d`), et la
 * fermeture du capot endort toujours le Mac (pas de `-s` : chaleur dans un sac).
 *
 * `-w <pid du daemon>` : caffeinate meurt avec le daemon, quelle que soit la facon dont
 * celui ci meurt. Sans lui, un `kill -9` laissait une assertion orpheline (constate :
 * 19 h). A l'inverse, un caffeinate qui meurt seul est repris apres `RESPAWN_DELAY_MS`.
 *
 * L'interrupteur « Garder le Mac eveille » de l'app (`enabled`) coupe tout.
 * L'alimentation n'est pas lue ici : `main.ts` la relit toutes les `POWER_POLL_MS` et
 * appelle `setPower`. Tant qu'elle est inconnue, c'est la regle de la batterie.
 */
export class SleepAssertion {
  private proc: SleepProcess | null = null;
  private mode: SleepMode | null = null;
  private since: number | null = null;
  private capTimer: unknown = null;
  private respawnTimer: unknown = null;
  private capped = false;
  private working = false;
  private power: boolean | null = null;
  private stopped = false;
  /** Appele a chaque changement d'etat, pour `state.json`. */
  onChange: ((state: SleepState) => void) | null = null;

  constructor(
    private readonly enabled: () => boolean,
    private readonly deps: SleepDeps = realSleepDeps,
  ) {}

  /** Vrai quand une assertion est actuellement posee. */
  get active(): boolean {
    return this.proc !== null;
  }

  get state(): SleepState {
    return {
      held: this.proc !== null,
      reason: this.proc ? this.mode : null,
      since: this.proc && this.since !== null ? new Date(this.since).toISOString() : null,
      power: this.power === null ? 'unknown' : this.power ? 'ac' : 'battery',
    };
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  reconcile(anyWorking: boolean): void {
    this.working = anyWorking;
    this.apply();
  }

  /** Alimentation relue. `null` (lecture en echec) ne change rien. */
  setPower(onAc: boolean | null): void {
    if (onAc === null || onAc === this.power) return;
    this.power = onAc;
    logger.info('alimentation', { power: onAc ? 'secteur' : 'batterie' });
    this.apply();
    this.onChange?.(this.state);
  }

  private wantedMode(): SleepMode | null {
    if (this.stopped || !this.enabled()) return null;
    if (this.power === true) return 'ac';
    if (!this.working) this.capped = false;
    return this.working && !this.capped ? 'agent' : null;
  }

  private apply(): void {
    const wanted = this.wantedMode();
    if (wanted === this.mode && (wanted === null || this.proc || this.respawnTimer)) return;
    if (this.proc || this.mode) {
      this.release(
        wanted !== null
          ? wanted === 'ac' ? 'passage sur secteur' : 'passage sur batterie'
          : !this.enabled()
            ? 'reglage desactive'
            : this.power === true
              ? 'arret'
              : 'plus aucun agent au travail',
        wanted === null,
      );
    }
    if (wanted) this.pose(wanted);
  }

  private pose(mode: SleepMode): void {
    this.mode = mode;
    const proc = this.deps.spawn(['-i', '-w', String(this.deps.pid)]);
    this.proc = proc;
    this.since = this.now();
    if (mode === 'agent') this.capTimer = this.deps.setTimeout(() => this.onCap(), SLEEP_CAP_MS);
    proc.onExit?.(() => this.onExit(proc));
    logger.info('assertion anti-veille posee', { reason: mode === 'ac' ? 'secteur' : 'agent au travail' });
    this.onChange?.(this.state);
  }

  /** caffeinate est mort sans nous : l'assertion est tombee, on la reprend. */
  private onExit(proc: SleepProcess): void {
    if (this.proc !== proc) return;
    this.proc = null;
    this.since = null;
    if (this.capTimer) this.deps.clearTimeout(this.capTimer);
    this.capTimer = null;
    logger.warn('caffeinate est mort, assertion anti-veille a reprendre');
    this.onChange?.(this.state);
    if (this.respawnTimer) return;
    this.respawnTimer = this.deps.setTimeout(() => {
      this.respawnTimer = null;
      const wanted = this.wantedMode();
      this.mode = null;
      if (wanted && !this.proc) this.pose(wanted);
    }, RESPAWN_DELAY_MS);
  }

  private onCap(): void {
    this.capTimer = null;
    this.capped = true;
    this.release('plafond de 4 h atteint', true);
  }

  private release(reason: string, notify: boolean): void {
    if (this.capTimer) this.deps.clearTimeout(this.capTimer);
    this.capTimer = null;
    if (this.respawnTimer) this.deps.clearTimeout(this.respawnTimer);
    this.respawnTimer = null;
    const proc = this.proc;
    this.proc = null;
    this.mode = null;
    this.since = null;
    try {
      proc?.kill();
    } catch {
      /* deja mort */
    }
    if (proc) logger.info('assertion anti-veille relachee', { reason });
    if (notify) this.onChange?.(this.state);
  }

  stop(): void {
    this.stopped = true;
    if (this.proc || this.respawnTimer) this.release('arret du daemon', true);
  }
}
