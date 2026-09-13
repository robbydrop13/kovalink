// Choix de l'état affiché par le bandeau de session. Pur, testé sous Node : l'ordre de
// priorité (fermée, hors ligne, démarre, attend, travaille, terminé, inactif) est le contrat.
import { t } from '@/i18n/en';
import { shortAgeMs } from '@/utils/time';

export type AgentStatusKind = 'offline' | 'closed' | 'starting' | 'awaiting' | 'working' | 'done' | 'idle';

export interface AgentStatusInput {
  degraded: boolean;
  closed: boolean;
  /** Le daemon vient de lancer `claude` ici et Kova ne voit pas encore l'agent. */
  launching?: boolean;
  awaiting: boolean;
  working: boolean;
  /** Début du travail en cours, en ms epoch, connu par le store des panes. */
  workingSince: number | null;
  /** Dernière fin de tour connue, en ms epoch. */
  finishedAt: number | null;
}

/** Durée compacte du bandeau (`1m 12s`), plus courte que `duration()` du reste de l'app. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return t.statusElapsed(Math.floor(total / 60), total % 60);
}

/** Choix de l'état et du libellé. Pur, testable : l'ordre de priorité est le contrat. */
export function agentStatus(input: AgentStatusInput, now = Date.now()): { kind: AgentStatusKind; label: string } {
  if (input.closed) return { kind: 'closed', label: t.statusClosed };
  if (input.degraded) return { kind: 'offline', label: t.statusOffline };
  if (input.launching) return { kind: 'starting', label: t.statusStarting };
  if (input.awaiting) return { kind: 'awaiting', label: t.statusAwaiting };
  if (input.working) {
    const since = input.workingSince;
    return {
      kind: 'working',
      label: since !== null ? t.statusWorkingFor(elapsed(now - since)) : t.statusWorking,
    };
  }
  if (input.finishedAt !== null) {
    return { kind: 'done', label: t.statusDoneAgo(shortAgeMs(now - input.finishedAt)) };
  }
  return { kind: 'idle', label: t.statusIdle };
}

