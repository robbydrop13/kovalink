import { MAC_FOCUSED_DEFER_MS, type Pane, type Prompt } from '@kovalink/protocol';
import type { KovalinkConfig } from '../config.js';
import { logger } from '../logger.js';

/**
 * Regles anti-bruit du PRD 4.4, en deux couches :
 *
 * 1. `TurnEndNotifier` (par EVENEMENT) : session ouverte sur un telephone vivant, et
 *    Robin devant son Mac. Ces deux regles dependent de l'etat du daemon, pas de
 *    l'appareil ;
 * 2. `deliveryFor` et `HourlyCap` (par APPAREIL puis global, dans `PushSender`) :
 *    `Validations seulement`, heures calmes en mode passif, plafond horaire.
 *
 * Tout ce qui est decide ici est journalise avec sa raison : une notification qui ne
 * part pas doit pouvoir etre expliquee depuis le journal.
 */

const QUIET_FROM_HOUR = 23;
const QUIET_TO_HOUR = 7;

/** PRD 4.4 : 20 notifications par heure, au dela on agrege. */
export const PUSH_HOURLY_CAP = 20;
const HOUR_MS = 3_600_000;

/** Heures calmes 23h a 7h, plage non reglable (PRD 3.7). */
export function inQuietHours(date = new Date()): boolean {
  const h = date.getHours();
  return h >= QUIET_FROM_HOUR || h < QUIET_TO_HOUR;
}

/** N1 : une question posee a Robin. Tout le reste est du N2 (fin de tour). */
function isValidation(prompt: Prompt): boolean {
  return prompt.state === 'parsed' || prompt.state === 'unparsable';
}

/** Preferences de notification d'UN appareil, telles que `push.register` les a posees. */
export interface DevicePushPrefs {
  onlyValidations: boolean;
  quietHours: boolean;
}

export type Delivery =
  | { kind: 'suppress'; reason: 'only_validations' }
  /**
   * `passive` : heures calmes (CA-130). La banniere est LIVREE mais sans son ni
   * allumage d'ecran (`interruptionLevel: passive`). Avant, elle etait supprimee et
   * rien n'etait rejoue au matin : a 2 h Robin n'avait rien du tout.
   */
  | { kind: 'send'; passive: boolean };

/**
 * Decision par appareil. La preference de l'appareil l'emporte sur le defaut du fichier
 * de config. Les deux interrupteurs de l'ecran Reglages sont lus ICI et nulle part
 * ailleurs.
 */
export function deliveryFor(
  prompt: Prompt,
  cfg: KovalinkConfig,
  prefs?: DevicePushPrefs,
  now = new Date(),
): Delivery {
  const validation = isValidation(prompt);
  const onlyValidations = prefs?.onlyValidations ?? cfg.push.onlyValidations;
  if (onlyValidations && !validation) return { kind: 'suppress', reason: 'only_validations' };
  const quiet = prefs?.quietHours ?? cfg.push.quietHours;
  // Heures calmes : seul N1 sonne, N2 passe en passif (PRD 4.4).
  return { kind: 'send', passive: quiet && !validation && inQuietHours(now) };
}

/**
 * Plafond horaire (PRD 4.4, CA-32) : fenetre glissante d'une heure. Au dela de
 * `PUSH_HOURLY_CAP` envois, l'evenement n'est pas jete : il est AGREGE en une seule
 * banniere `{n} agents attendent`, ou `n` compte les panes distincts agreges dans la
 * fenetre. La banniere agregee a un `collapseId` fixe, donc une seule vit a la fois.
 */
export class HourlyCap {
  private sentAt: number[] = [];
  private readonly aggregated = new Map<number, number>();

  constructor(private readonly cap = PUSH_HOURLY_CAP) {}

  private sweep(now: number): void {
    this.sentAt = this.sentAt.filter((t) => now - t < HOUR_MS);
    for (const [paneId, t] of this.aggregated) if (now - t >= HOUR_MS) this.aggregated.delete(paneId);
  }

  /** Enregistre l'evenement et dit s'il passe tel quel, ou agrege avec `n` panes. */
  admit(paneId: number, now = Date.now()): { aggregated: false } | { aggregated: true; waiting: number } {
    this.sweep(now);
    if (this.sentAt.length < this.cap) {
      this.sentAt.push(now);
      return { aggregated: false };
    }
    this.aggregated.set(paneId, now);
    return { aggregated: true, waiting: this.aggregated.size };
  }
}

// --------------------------------------------------------------------------
// Couche par evenement
// --------------------------------------------------------------------------

/** Ce que le notifieur demande au reste du daemon. Des fonctions, pour les tests. */
export interface NotifierPorts {
  /** Un client vivant, au premier plan sur ce pane, session attachee, signal frais. */
  isWatchedLive: (sessionId: string | null, paneId: number, now: number) => boolean;
  /** Kova au premier plan sur le Mac ET ce pane focalise. */
  isMacFocused: (paneId: number) => boolean;
  pane: (paneId: number) => Pane | undefined;
  /** Faux quand la reference a ete invalidee : le pane a repris la main entre temps. */
  isRefValid: (promptRef: string) => boolean;
  send: (prompt: Prompt, pane: Pane) => Promise<unknown>;
}

export interface NotifierDeps {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realNotifierDeps: NotifierDeps = {
  now: Date.now,
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export type NotifyOutcome =
  | { kind: 'sent' }
  | { kind: 'suppressed'; reason: 'session_open' }
  | { kind: 'deferred'; delayMs: number };

/**
 * Sort d'un evenement notifiable : fin de tour (N2) ou question detectee (N1). Les deux
 * passent ici, avec les memes regles.
 *
 * - Session ouverte sur un telephone VIVANT (A1, CA-31) : supprime. C'est la seule
 *   suppression definitive de cette couche, et elle exige un client qui repond.
 * - Robin devant son Mac sur ce pane (PRD 4.4) : SUSPENDU `MAC_FOCUSED_DEFER_MS`, puis
 *   reevalue. Si l'etat n'a pas change (pane vivant, pas reparti, reference valable),
 *   la notification part, meme si le Mac est toujours focalise. Avant, elle etait
 *   supprimee pour toujours.
 * - Sinon : envoye tout de suite.
 *
 * Un nouvel evenement sur le meme pane remplace un report en attente.
 */
export class PushNotifier {
  private readonly pending = new Map<number, unknown>();

  constructor(
    private readonly ports: NotifierPorts,
    private readonly deps: NotifierDeps = realNotifierDeps,
  ) {}

  notify(prompt: Prompt, pane: Pane): NotifyOutcome {
    this.cancel(pane.id);
    return this.evaluate(prompt, pane, false);
  }

  private evaluate(prompt: Prompt, pane: Pane, afterDefer: boolean): NotifyOutcome {
    // Une question detectee ne porte pas de `sessionId` : celui du pane fait foi.
    const sessionId =
      ('sessionId' in prompt ? prompt.sessionId : null) ??
      pane.agent_session_id ??
      pane.claude_session_id;
    if (this.ports.isWatchedLive(sessionId, pane.id, this.deps.now())) {
      logger.info('push supprime, session ouverte sur un telephone vivant', { paneId: pane.id });
      return { kind: 'suppressed', reason: 'session_open' };
    }
    if (!afterDefer && this.ports.isMacFocused(pane.id)) {
      logger.info('push suspendu, Robin est devant son Mac sur ce pane', {
        paneId: pane.id,
        delayMs: MAC_FOCUSED_DEFER_MS,
      });
      const handle = this.deps.setTimeout(() => {
        this.pending.delete(pane.id);
        this.resume(prompt, pane);
      }, MAC_FOCUSED_DEFER_MS);
      this.pending.set(pane.id, handle);
      return { kind: 'deferred', delayMs: MAC_FOCUSED_DEFER_MS };
    }
    void this.ports.send(prompt, pane);
    return { kind: 'sent' };
  }

  /** Fin de la suspension : la notification part si l'etat n'a pas change. */
  private resume(prompt: Prompt, snapshot: Pane): void {
    const pane = this.ports.pane(snapshot.id);
    const ref = 'promptRef' in prompt ? prompt.promptRef : null;
    const changed = this.whatChanged(pane, ref);
    if (changed || !pane) {
      logger.info('push abandonne apres suspension, etat change', { paneId: snapshot.id, changed });
      return;
    }
    logger.info('suspension terminee, etat inchange', { paneId: snapshot.id });
    this.evaluate(prompt, pane, true);
  }

  private whatChanged(pane: Pane | undefined, ref: string | null): string | null {
    if (!pane) return 'pane ferme';
    if (pane.working) return 'l agent est reparti';
    if (ref && !this.ports.isRefValid(ref)) return 'reference invalidee';
    return null;
  }

  /** Annule un report en attente : la question a ete reglee, ou le pane a ferme. */
  cancel(paneId: number): void {
    const handle = this.pending.get(paneId);
    if (handle !== undefined) this.deps.clearTimeout(handle);
    this.pending.delete(paneId);
  }

  stop(): void {
    for (const paneId of [...this.pending.keys()]) this.cancel(paneId);
  }
}
