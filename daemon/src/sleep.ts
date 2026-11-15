import { spawn, spawnSync } from 'node:child_process';
import { logger } from './logger.js';

/** Filet de securite contre une assertion oubliee (A13, CA-125). */
export const SLEEP_CAP_MS = 4 * 3_600_000;

/** Le Mac reste eveille ce temps la apres le dernier message recu du telephone. */
export const PHONE_HOLD_MS = 15 * 60_000;
/** Et ce temps la apres une notification : Robin la touche rarement dans la minute. */
export const PUSH_HOLD_MS = 30 * 60_000;
/** Une echeance qui bouge de moins que ca ne rearme pas la minuterie (un ping toutes les 6 s). */
const REARM_STEP_MS = 60_000;
/** Duree de validite d'une lecture de l'alimentation. */
const POWER_TTL_MS = 60_000;

export type HoldReason = 'phone' | 'push';

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
  /** Horloge, en millisecondes. Absente : `Date.now`. */
  now?: () => number;
  /** Vrai sur secteur. Absente : lecture de `pmset -g batt`. */
  onAcPower?: () => boolean;
}

let powerRead: { at: number; ac: boolean } | null = null;

/**
 * `pmset -g batt` commence par « Now drawing from 'AC Power' » ou « 'Battery Power' ».
 * Un Mac sans batterie repond toujours « AC Power ». Lecture illisible : on suppose la
 * batterie, donc aucune tenue en eveil de plus.
 */
export function parseAcPower(out: string): boolean {
  return /Now drawing from 'AC Power'/.test(out);
}

function readAcPower(): boolean {
  const now = Date.now();
  if (powerRead && now - powerRead.at < POWER_TTL_MS) return powerRead.ac;
  let ac = false;
  try {
    const r = spawnSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 2_000 });
    ac = parseAcPower(r.stdout ?? '');
  } catch {
    ac = false;
  }
  powerRead = { at: now, ac };
  return ac;
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
 * Premier declencheur : L'AGENT QUI TRAVAILLE, pas la presence d'un client : tout
 * l'interet du produit est que l'agent continue telephone range et app fermee.
 *
 * Second declencheur, depuis le 15 novembre : ROBIN AU TELEPHONE. Avec le seul premier,
 * l'assertion tombait a l'instant ou tous les agents l'attendaient, et un Mac regle sur
 * une minute de veille s'endormait sous l'iPhone : relachee a 14:30:36, telephone
 * connecte a 14:31:51, veille a 14:32:08, reveil au clavier a 15:02:52. Onze veilles en
 * trois jours suivent ainsi une relache de 20 s a 2 min. `touch` tient donc le Mac
 * eveille `PHONE_HOLD_MS` apres un message du telephone, et `PUSH_HOLD_MS` apres une
 * notification. Trois garde-fous : c'est un MESSAGE qui compte et non un socket ouvert
 * (iOS garde un socket vivant longtemps en arriere plan, alors que le JavaScript qui
 * pinge y est suspendu) ; seulement sur secteur ; un seul caffeinate, dont l'echeance
 * recule, toujours sous le plafond de 4 h.
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
  private working = false;
  /** Fin de la tenue demandee par le telephone ou une notification, 0 sans tenue. */
  private holdUntil = 0;
  /** Echeance pour laquelle `holdTimer` est arme. */
  private holdTimerFor = 0;
  private holdTimer: unknown = null;

  constructor(
    private readonly enabled: () => boolean,
    private readonly deps: SleepDeps = realSleepDeps,
  ) {}

  /** Vrai quand une assertion est actuellement posee. */
  get active(): boolean {
    return this.proc !== null;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  reconcile(anyWorking: boolean): void {
    this.working = anyWorking;
    this.apply();
  }

  /**
   * Signe de Robin au telephone : un message de l'app (`phone`) ou une notification qui
   * vient de partir (`push`). Sur batterie, rien : seul l'agent au travail y tient le Mac.
   */
  touch(reason: HoldReason): void {
    if (!this.enabled()) return;
    const onAc = this.deps.onAcPower ? this.deps.onAcPower() : readAcPower();
    if (!onAc) return;
    const until = this.now() + (reason === 'push' ? PUSH_HOLD_MS : PHONE_HOLD_MS);
    if (until <= this.holdUntil) return;
    this.holdUntil = until;
    if (!this.holdTimer || until - this.holdTimerFor >= REARM_STEP_MS) this.armHold();
    this.apply(reason === 'push' ? 'notification envoyee' : 'telephone actif');
  }

  private armHold(): void {
    if (this.holdTimer) this.deps.clearTimeout(this.holdTimer);
    this.holdTimerFor = this.holdUntil;
    this.holdTimer = this.deps.setTimeout(() => this.onHoldTimer(), Math.max(0, this.holdUntil - this.now()));
  }

  /** La minuterie peut sonner avant l'echeance (elle n'est pas rearmee a chaque ping). */
  private onHoldTimer(): void {
    this.holdTimer = null;
    if (this.now() < this.holdUntil) this.armHold();
    else this.apply();
  }

  private apply(why = 'agent au travail'): void {
    const holding = this.now() < this.holdUntil;
    if (!this.working && !holding) this.capped = false;
    const wanted = (this.working || holding) && this.enabled() && !this.capped;
    if (wanted && !this.proc) {
      this.proc = this.deps.spawn(['-i', '-w', String(this.deps.pid)]);
      this.capTimer = this.deps.setTimeout(() => this.onCap(), SLEEP_CAP_MS);
      logger.info('assertion anti-veille posee', { reason: this.working ? 'agent au travail' : why });
      return;
    }
    if (!wanted && this.proc) {
      this.release(
        this.working || holding
          ? 'reglage desactive'
          : this.holdUntil > 0
            ? 'plus aucun agent au travail, telephone inactif'
            : 'plus aucun agent au travail',
      );
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
    if (this.holdTimer) this.deps.clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.holdUntil = 0;
    if (this.proc) this.release('arret du daemon');
  }
}
