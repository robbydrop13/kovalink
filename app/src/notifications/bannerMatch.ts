// Reconnaissance du pane visé par une bannière. Pur, testé sous Node (CA-14).
import type { Pane, PushPayload } from '@/protocol';

export interface PaneIdentity {
  id: number;
  projectName: string;
  tab: string;
}

export function paneIdentity(pane: Pane): PaneIdentity {
  return { id: pane.id, projectName: pane.projectName, tab: pane.title ?? pane.agent ?? 'Kova' };
}

/**
 * Vrai si la charge utile d'une bannière désigne ce pane. Pur, testé sous Node.
 * `activeHost` : une bannière d'un autre Mac n'est jamais celle d'un pane du Mac actif,
 * même à `paneId` ou à (projet, onglet) égaux.
 */
export function bannerBelongsTo(
  data: Partial<PushPayload> | null | undefined,
  pane: PaneIdentity,
  promptRefs: readonly string[],
  activeHost: string | null = null,
): boolean {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.host === 'string' && activeHost !== null && data.host !== activeHost) return false;
  if (typeof data.paneId === 'number') return data.paneId === pane.id;
  if (typeof data.promptRef === 'string' && promptRefs.includes(data.promptRef)) return true;
  return data.project === pane.projectName && data.tab === pane.tab;
}

