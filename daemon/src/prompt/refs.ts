import { randomBytes } from 'node:crypto';
import { PROMPT_REF_TTL_MS } from '@kovalink/protocol';

/** R3 : la reference vaut jusqu'a resolution du prompt OU 10 minutes, pas un seul usage.
 *  La valeur vit dans le protocole : l'app compte le meme delai de son cote. */
export { PROMPT_REF_TTL_MS };

export interface PromptRefEntry {
  paneId: number;
  sessionId: string | null;
  expiresAt: number;
}

/**
 * Registre des references opaques de prompt.
 *
 * La reference ne revele ni le `paneId`, ni le `cwd`, ni le nom du projet : c'est la
 * SEULE donnee liee au prompt qui transite par la charge utile du push (A14, C24).
 *
 * Elle n'est PAS a usage unique (defaut R3) : trois consommateurs la lisent, la
 * Notification Service Extension, l'action rapide et le lien profond. L'usage unique
 * cassait toutes les actions rapides des la premiere notification.
 */
export class PromptRefs {
  private readonly entries = new Map<string, PromptRefEntry>();

  mint(paneId: number, sessionId: string | null, now = Date.now()): string {
    const ref = randomBytes(16).toString('base64url');
    this.entries.set(ref, { paneId, sessionId, expiresAt: now + PROMPT_REF_TTL_MS });
    this.sweep(now);
    return ref;
  }

  resolve(ref: string, now = Date.now()): PromptRefEntry | null {
    const entry = this.entries.get(ref);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(ref);
      return null;
    }
    return entry;
  }

  /** Invalidation a la resolution du prompt : le pane a repris la main. */
  invalidatePane(paneId: number): void {
    for (const [ref, e] of this.entries) if (e.paneId === paneId) this.entries.delete(ref);
  }

  sweep(now = Date.now()): void {
    for (const [ref, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(ref);
  }

  get size(): number {
    return this.entries.size;
  }
}
