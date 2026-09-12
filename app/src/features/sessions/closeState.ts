// État réel d'un pane pour la feuille de confirmation de fermeture. Pur, testé.
import type { Pane } from '@/protocol';

export function closeStateLabel(pane: Pick<Pane, 'working' | 'awaiting' | 'agent'>): { label: string; danger: boolean } {
  if (pane.working) return { label: 'The agent is working right now: closing interrupts the task.', danger: true };
  if (pane.awaiting) return { label: 'The agent is waiting for your answer.', danger: false };
  if (pane.agent) return { label: 'The agent is idle.', danger: false };
  return { label: 'Plain shell, no agent.', danger: false };
}
