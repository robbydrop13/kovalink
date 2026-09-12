// Choix de l'état affiché par le bandeau de session. Pur, testé sous Node : l'ordre de
// priorité (fermée, hors ligne, attend, travaille, terminé, inactif) est le contrat.
import { duration, shortAgeMs } from '@/utils/time';

export type AgentStatusKind = 'offline' | 'closed' | 'awaiting' | 'working' | 'done' | 'idle';

export interface AgentStatusInput {
  degraded: boolean;
  closed: boolean;
  awaiting: boolean;
  working: boolean;
  /** Début du travail en cours, en ms epoch, connu par le store des panes. */
  workingSince: number | null;
  /** Dernière fin de tour connue, en ms epoch. */
  finishedAt: number | null;
}

/** Choix de l'état et du libellé. Pur, testable : l'ordre de priorité est le contrat. */
export function agentStatus(input: AgentStatusInput, now = Date.now()): { kind: AgentStatusKind; label: string } {
  if (input.closed) return { kind: 'closed', label: 'Session fermée' };
  if (input.degraded) return { kind: 'offline', label: 'Hors ligne, état figé' };
  if (input.awaiting) return { kind: 'awaiting', label: 'Attend ta réponse' };
  if (input.working) {
    const since = input.workingSince;
    return {
      kind: 'working',
      label: since !== null ? `Travaille · ${duration(now - since)}` : 'Travaille',
    };
  }
  if (input.finishedAt !== null) {
    return { kind: 'done', label: `Terminé il y a ${shortAgeMs(now - input.finishedAt)}` };
  }
  return { kind: 'idle', label: 'Inactif' };
}

