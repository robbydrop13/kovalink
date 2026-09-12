// État réel d'un pane pour la feuille de confirmation de fermeture. Pur, testé.
import type { Pane } from '@/protocol';
import { t } from '@/i18n/en';

export function closeStateLabel(pane: Pick<Pane, 'working' | 'awaiting' | 'agent'>): { label: string; danger: boolean } {
  if (pane.working) return { label: t.closeStateWorking, danger: true };
  if (pane.awaiting) return { label: t.closeStateAwaiting, danger: false };
  if (pane.agent) return { label: t.closeStateIdle, danger: false };
  return { label: t.closeStateShell, danger: false };
}
