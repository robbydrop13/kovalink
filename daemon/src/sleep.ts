import { spawn } from 'node:child_process';
import { logger } from './logger.js';

/** Filet de securite contre une assertion oubliee (A13, CA-125). */
export const SLEEP_CAP_MS = 4 * 3_600_000;

/** Ce que `SleepAssertion` attend d'un processus `caffeinate`. */
export interface SleepProcess {
  kill(): void;
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
}

const realSleepDeps: SleepDeps = {
  spawn: (args) => {
    const proc = spawn('/usr/bin/caffeinate', args, { stdio: 'ignore' });
    proc.unref();
    return proc;
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
 * Le declencheur est L'AGENT QUI TRAVAILLE, pas la presence d'un client : tout
 * l'interet du produit est que l'agent continue telephone range et app fermee.
 *
 * `caffeinate -i` pose exactement une assertion IOKit `PreventUserIdleSystemSleep`,
 * donc aucun module natif n'est necessaire. `-i` et non `-s` : on empeche la veille
 * par inactivite, on ne contre PAS la fermeture du capot, qui est un comportement
 * attendu (batterie, chaleur dans un sac).
 *
 * `-w <pid du daemon>` : caffeinate meurt avec le daemon, quelle que soit la facon dont
 * celui ci meurt. Sans lui, un `kill -9` ou un crash laissait une assertion orpheline
 * « asserting forever » (constate : 19 h).
 *
 * Le plafond de 4 h est une MINUTERIE, armee a la pose. Avant, il n'etait evalue qu'au
 * prochain evenement `pane-working`, et se rearmait aussitot : il n'existait pas.
 * Une fois le plafond atteint, aucune nouvelle assertion tant que tout ne s'est pas
 * arrete au moins une fois : un agent qui tourne depuis 4 h ne la merite plus.
 */
export class SleepAssertion {
  private proc: SleepProcess | null = null;
  private capTimer: unknown = null;
  private capped = false;

  constructor(
    private readonly enabled: () => boolean,
    private readonly deps: SleepDeps = realSleepDeps,
  ) {}

  /** Vrai quand une assertion est actuellement posee. */
  get active(): boolean {
    return this.proc !== null;
  }

  reconcile(anyWorking: boolean): void {
    if (!anyWorking) this.capped = false;
    const wanted = anyWorking && this.enabled() && !this.capped;
    if (wanted && !this.proc) {
      this.proc = this.deps.spawn(['-i', '-w', String(this.deps.pid)]);
      this.capTimer = this.deps.setTimeout(() => this.onCap(), SLEEP_CAP_MS);
      logger.info('assertion anti-veille posee');
      return;
    }
    if (!wanted && this.proc) {
      this.release(anyWorking ? 'reglage desactive' : 'plus aucun agent au travail');
    }
  }

  private onCap(): void {
    this.capTimer = null;
    this.capped = true;
    this.release('plafond de 4 h atteint');
  }

  private release(reason: string): void {
    if (this.capTimer) this.deps.clearTimeout(this.capTimer);
    this.capTimer = null;
    try {
      this.proc?.kill();
    } catch {
      /* deja mort */
    }
    this.proc = null;
    logger.info('assertion anti-veille relachee', { reason });
  }

  stop(): void {
    if (this.proc) this.release('arret du daemon');
  }
}
