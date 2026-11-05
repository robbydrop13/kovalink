// Push silencieux de comptes pour le cadran du poignet.
//
// Le cadran ne lit pas le WebSocket : il ne sait que ce qu'APNs lui apporte. Le daemon
// envoie donc, quand les nombres bougent, une charge sans alerte qui ne contient QUE des
// nombres (`CountsPush`), et l'app met son cadran a jour sans rien afficher.
//
// Trois regles, et pas une de plus :
// 1. un envoi par appareil au plus toutes les 60 s, plus un envoi de RATTRAPAGE pour que
//    la derniere valeur arrive toujours ;
// 2. rien a envoyer si le trio (asks, errors, ended) n'a pas bouge depuis le dernier
//    envoi de CET appareil ;
// 3. les reglages d'alerte (`onlyValidations`, heures calmes) ne s'appliquent pas : un
//    push invisible n'a rien a taire. Un appareil sans jeton, lui, ne recoit rien.
import type { AskItem, AttentionEntry, CountsPush, Pane } from '@kovalink/protocol';
import { logger } from '../logger.js';
import { waitsOnYouOf } from '../needs.js';
import { pushTargets, type PushTarget } from './sender.js';

/** PRD du cadran : jamais plus d'un push de comptes par minute et par appareil. */
export const COUNTS_PUSH_MIN_INTERVAL_MS = 60_000;

/** Ce que le daemon sait compter, sans aucun texte. */
export interface CountsSnapshot {
  /** Le meme compte que `waitsOnYou` : permissions, questions ouvertes, entrees d'attention `now`. */
  asks: number;
  /** Les panes sur une erreur API. */
  errors: number;
  /** Les questions ouvertes dont la session n'existe plus. */
  ended: number;
  /** La plus ancienne permission ou question ouverte, en secondes epoch. */
  oldestAt: number | null;
}

function epochSecondsOf(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Lit l'etat du daemon et rend les trois nombres du cadran.
 *
 * `ended` n'est compte que lorsqu'il peut l'etre : une question sans `sessionId` ne dit
 * pas a quelle session elle appartenait, et un daemon qui n'a encore lu aucun pane ne
 * sait rien. Dans les deux cas il vaut 0, jamais une supposition.
 */
export function countsOf(
  panes: readonly Pane[],
  asks: readonly AskItem[],
  nowMs: number,
  attention: readonly AttentionEntry[] = [],
): CountsSnapshot {
  const now = Math.floor(nowMs / 1000);
  const liveSessions = new Set<string>();
  let errors = 0;
  let oldestAt: number | null = null;

  for (const pane of panes) {
    if (pane.error) errors += 1;
    if (pane.agent_session_id) liveSessions.add(pane.agent_session_id);
    if (pane.claude_session_id) liveSessions.add(pane.claude_session_id);
    if (!pane.awaiting) continue;
    const since = epochSecondsOf(pane.awaiting_since) ?? now;
    if (oldestAt === null || since < oldestAt) oldestAt = since;
  }

  let ended = 0;
  for (const ask of asks) {
    // Meme regle que `needs.ts` : une question reportee n'est pas ouverte tant que son
    // report n'a pas expire (`snoozedUntilMs` a 0 veut dire jamais reportee).
    if (ask.snoozedUntilMs > nowMs) continue;
    if (ask.askedAtMs > 0) {
      const since = Math.floor(ask.askedAtMs / 1000);
      if (oldestAt === null || since < oldestAt) oldestAt = since;
    }
    if (panes.length > 0 && ask.sessionId !== null && !liveSessions.has(ask.sessionId)) ended += 1;
  }

  for (const entry of attention) {
    if (entry.level !== 'now') continue;
    const since = epochSecondsOf(entry.ts);
    if (since !== null && (oldestAt === null || since < oldestAt)) oldestAt = since;
  }

  return { asks: waitsOnYouOf(panes, asks, nowMs, attention), errors, ended, oldestAt };
}

/** Le trio qui declenche un envoi. `oldestAt` ne le declenche pas, il voyage avec. */
function signatureOf(snapshot: CountsSnapshot): string {
  return `${snapshot.asks}|${snapshot.errors}|${snapshot.ended}`;
}

export interface CountsClock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realClock: CountsClock = {
  now: Date.now,
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export type CountsSend = (counts: CountsPush, targets: PushTarget[]) => Promise<number>;

export interface CountsPusherOptions {
  send: CountsSend;
  targets?: () => PushTarget[];
  clock?: CountsClock;
  minIntervalMs?: number;
}

interface DeviceState {
  /** Signature du dernier trio envoye, `null` avant le premier envoi. */
  lastSent: string | null;
  lastSentAt: number;
  /** La derniere valeur connue, celle qu'un envoi de rattrapage portera. */
  pending: CountsSnapshot | null;
  timer: unknown | null;
}

/**
 * Anti-rebond PAR APPAREIL : deux appareils ont leur propre fenetre de 60 s, et un
 * appareil qui vient de se connecter recoit tout de suite l'etat courant.
 *
 * `update` peut etre appele aussi souvent que l'etat change : il ne fait que replanifier.
 * L'horloge et le minuteur sont injectables, pour tester la minute sans l'attendre.
 */
export class CountsPusher {
  private readonly send: CountsSend;
  private readonly targets: () => PushTarget[];
  private readonly clock: CountsClock;
  private readonly minIntervalMs: number;
  private readonly devices = new Map<string, DeviceState>();

  constructor(options: CountsPusherOptions) {
    this.send = options.send;
    this.targets = options.targets ?? pushTargets;
    this.clock = options.clock ?? realClock;
    this.minIntervalMs = options.minIntervalMs ?? COUNTS_PUSH_MIN_INTERVAL_MS;
  }

  update(snapshot: CountsSnapshot): void {
    const now = this.clock.now();
    const targets = this.targets();
    const seen = new Set<string>();

    for (const target of targets) {
      seen.add(target.deviceId);
      let state = this.devices.get(target.deviceId);
      if (!state) {
        state = { lastSent: null, lastSentAt: 0, pending: null, timer: null };
        this.devices.set(target.deviceId, state);
      }
      state.pending = snapshot;
      this.plan(target.deviceId, state, now);
    }

    // Un appareil disparu (revoque, jeton retire) ne doit laisser aucun minuteur.
    for (const [deviceId, state] of [...this.devices]) {
      if (seen.has(deviceId)) continue;
      this.cancel(state);
      this.devices.delete(deviceId);
    }
  }

  stop(): void {
    for (const state of this.devices.values()) this.cancel(state);
    this.devices.clear();
  }

  private plan(deviceId: string, state: DeviceState, now: number): void {
    const pending = state.pending;
    if (!pending) return;
    const signature = signatureOf(pending);

    // Rien de neuf depuis le dernier envoi : pas de push, et le rattrapage devenu inutile
    // est annule (le trio a pu changer puis revenir en arriere dans la fenetre).
    if (signature === state.lastSent) {
      this.cancel(state);
      state.pending = null;
      return;
    }

    if (state.lastSent === null || now - state.lastSentAt >= this.minIntervalMs) {
      this.cancel(state);
      this.deliver(deviceId, pending, now);
      return;
    }

    // Un envoi est deja programme : `pending` vient d'etre remplace, le minuteur portera
    // donc la DERNIERE valeur sans qu'il faille le recreer.
    if (state.timer !== null) return;
    state.timer = this.clock.setTimeout(() => {
      state.timer = null;
      const latest = state.pending;
      if (!latest || signatureOf(latest) === state.lastSent) return;
      this.deliver(deviceId, latest, this.clock.now());
    }, this.minIntervalMs - (now - state.lastSentAt));
  }

  private deliver(deviceId: string, snapshot: CountsSnapshot, now: number): void {
    const state = this.devices.get(deviceId);
    const target = this.targets().find((t) => t.deviceId === deviceId);
    if (!state || !target) return;

    // Marque AVANT l'envoi : la fenetre de 60 s est celle des tentatives, sinon un Expo
    // lent laisserait deux updates rapproches partir tous les deux.
    state.lastSent = signatureOf(snapshot);
    state.lastSentAt = now;
    state.pending = null;

    const payload: CountsPush = {
      t: 'counts',
      asks: snapshot.asks,
      errors: snapshot.errors,
      ended: snapshot.ended,
      oldestAt: snapshot.oldestAt,
      at: Math.floor(now / 1000),
    };
    void this.send(payload, [target]).then(
      (sent) => logger.info('counts pousses', { deviceId, sent, ...snapshot }),
      (e: unknown) => logger.warn('envoi counts en echec', { deviceId, err: (e as Error).message }),
    );
  }

  private cancel(state: DeviceState): void {
    if (state.timer === null) return;
    this.clock.clearTimeout(state.timer);
    state.timer = null;
  }
}
