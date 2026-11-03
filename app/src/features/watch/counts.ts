// Les nombres du cadran du poignet, calcules depuis l'etat de l'app.
//
// Meme regle que le push silencieux du daemon (`daemon/src/push/counts.ts`) : le cadran
// doit dire la meme chose que l'app soit ouverte ou fermee. Un pane sur une erreur compte,
// `oldestAt` est la plus ancienne attente (pane `awaiting` ou question non reportee), et
// rien d'autre ne voyage : ni question, ni nom de pane, ni titre.
import { waitsOnYou, type AskItem, type Pane, type Prompt } from '@/protocol';
import { epochSecondsOf, needInputOf } from '@/features/home/needs';
import type { WatchCounts } from '../../../modules/watch-relay';

// Le contrat des nombres vit avec le module natif qui les recoit : une seule definition.
export type { WatchCounts };

/** Tout ce que l'app sait a un instant, pour calculer un envoi. */
export interface CountsSnapshot {
  panes: readonly Pane[];
  prompts: Readonly<Record<number, Prompt>>;
  asks: readonly AskItem[];
  /** Debut connu de chaque erreur, en ms epoch (voir `PanesState.errorSince`). */
  errorSince?: Readonly<Record<number, number>>;
  /** Le compte du daemon : il fait foi quand il est la (permissions comprises). */
  waitsOnYou: number | null;
  nowMs: number;
}

export function countsOf(s: CountsSnapshot): WatchCounts {
  const now = Math.floor(s.nowMs / 1000);
  let errors = 0;
  let oldestAt: number | null = null;

  for (const pane of s.panes) {
    if (pane.error) errors += 1;
    if (!pane.awaiting) continue;
    // Un Kova plus ancien ne date pas l'attente : on retombe sur l'instant connu.
    const since = epochSecondsOf(pane.awaiting_since) ?? now;
    if (oldestAt === null || since < oldestAt) oldestAt = since;
  }

  for (const ask of s.asks) {
    // Une question reportee n'attend pas tant que son report tient, et une question sans
    // date ne dit rien de son age.
    if (ask.snoozedUntilMs > s.nowMs || ask.askedAtMs <= 0) continue;
    const since = Math.floor(ask.askedAtMs / 1000);
    if (oldestAt === null || since < oldestAt) oldestAt = since;
  }

  return {
    // Le daemon compte permissions et questions avec dedoublonnage ; notre calcul local ne
    // sert qu'a un daemon anterieur a `waitsOnYou`.
    asks:
      s.waitsOnYou ??
      waitsOnYou(
        needInputOf({
          panes: s.panes,
          prompts: s.prompts,
          routines: null,
          asks: s.asks,
          errorSince: s.errorSince,
          nowMs: s.nowMs,
        }),
      ),
    errors,
    // Aucune source ne dit, cote app, qu'une question est morte avec sa session : le push
    // du daemon porte ce chiffre quand l'app est fermee. Ouverte, il reste a zero.
    ended: 0,
    oldestAt,
    // Instant de composition : la montre jette un envoi plus ancien que celui qu'elle porte.
    at: now,
  };
}

export function sameCounts(a: WatchCounts, b: WatchCounts): boolean {
  return a.asks === b.asks && a.errors === b.errors && a.ended === b.ended && a.oldestAt === b.oldestAt;
}

/** Deux secondes : assez pour laisser passer une rafale d'instantanes, assez court pour
 *  que le cadran suive un changement reel. */
export const COUNTS_DEBOUNCE_MS = 2_000;

export interface CountsTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const systemTimers: CountsTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as number),
};

export interface CountsThrottle {
  /** Signale un etat ; l'envoi part a la fermeture de la fenetre, ou au `flush`. */
  push: (counts: WatchCounts) => void;
  /** Envoie tout de suite ce qui attend. */
  flush: () => void;
  stop: () => void;
}

/**
 * Anti-rebond : le premier changement ouvre une fenetre de `delayMs`, la derniere valeur de
 * la fenetre part a sa fermeture. Un etat qui revient a ce que la montre a deja n'envoie
 * rien et annule l'envoi en attente.
 */
export function createCountsThrottle(
  send: (counts: WatchCounts) => void,
  options: { delayMs?: number; timers?: CountsTimers } = {},
): CountsThrottle {
  const delayMs = options.delayMs ?? COUNTS_DEBOUNCE_MS;
  const timers = options.timers ?? systemTimers;
  let sent: WatchCounts | null = null;
  let pending: WatchCounts | null = null;
  let handle: unknown = null;

  const cancel = (): void => {
    if (handle === null) return;
    timers.clear(handle);
    handle = null;
  };

  const flush = (): void => {
    handle = null;
    const next = pending;
    pending = null;
    if (next === null) return;
    if (sent !== null && sameCounts(sent, next)) return;
    sent = next;
    send(next);
  };

  return {
    push: (counts) => {
      if (sent !== null && sameCounts(sent, counts)) {
        pending = null;
        cancel();
        return;
      }
      pending = counts;
      if (handle === null) handle = timers.set(flush, delayMs);
    },
    flush: () => {
      cancel();
      flush();
    },
    stop: () => {
      pending = null;
      cancel();
    },
  };
}
