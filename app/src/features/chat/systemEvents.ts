// Tours `system` (injectés par le harnais sous le rôle `user`) dans le fil. Deux familles :
// les évènements qui intéressent Robin (notification de sous-agent, sortie de commande),
// rendus en ligne discrète repliée ; et le bruit (`<system-reminder>`, `isMeta`), masqué
// derrière un compteur « N system events » dépliable. Pur, testé.
import type { Turn } from '@/protocol';

/** Balises sans intérêt pour Robin : rappels d'instructions, mémoire, lignes `isMeta`. */
const QUIET_TAGS = new Set<string | null | undefined>(['system-reminder', 'system-notification', null, undefined]);

export function isQuietSystem(turn: Turn): boolean {
  return turn.kind === 'system' && QUIET_TAGS.has(turn.systemTag);
}

export type FeedItem = { kind: 'turn'; turn: Turn } | { kind: 'quiet'; key: string; turns: Turn[] };

/** Le fil à rendre : chaque tour, sauf les évènements discrets consécutifs regroupés. */
export function feedItems(turns: readonly Turn[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const turn of turns) {
    if (isQuietSystem(turn)) {
      const last = out[out.length - 1];
      if (last?.kind === 'quiet') last.turns.push(turn);
      else out.push({ kind: 'quiet', key: `quiet-${turn.id}`, turns: [turn] });
      continue;
    }
    out.push({ kind: 'turn', turn });
  }
  return out;
}
