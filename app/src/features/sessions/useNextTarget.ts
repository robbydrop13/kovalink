// La cible de Cmd+J recalculée à chaque rendu depuis les stores : Needs you d'abord
// (erreurs, permissions, questions), puis l'onglet Scheduled pour une routine en échec,
// puis les non lus, puis le repli « inactive ». Pane courant exclu.
import { useMemo } from 'react';
import { useConnection } from '@/store/connection';
import { useHomeTab } from '@/store/homeTab';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';
import { useReads } from '@/store/reads';
import { useNeeds } from '@/features/home/useNeeds';
import { nextNeedDecision } from '@/features/home/needs';
import { groupByTab, paletteEntries } from './tabGroups';
import { idleRing, nextTarget, unreadRing, type NextTarget } from './unread';

export interface NextState {
  target: NextTarget;
  unreadCount: number;
  idleCount: number;
  /** Ce qui attend une réponse (permissions et questions), le compte de la pastille. */
  waitCount: number;
}

export function useNextTarget(currentId: number | null): NextState {
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const prompts = usePrompts((s) => s.byPane);
  const marks = useReads((s) => s.byPane);
  const kova = useConnection((s) => s.kova);
  const homeTab = useHomeTab((s) => s.tab);
  const needs = useNeeds();
  return useMemo(() => {
    const entries = paletteEntries(groupByTab(kova === 'down' ? [] : panes, tabs), '');
    const decision = nextNeedDecision(needs.items, currentId, homeTab === 'scheduled');
    const target: NextTarget =
      decision === null
        ? nextTarget(entries, prompts, marks, currentId)
        : decision.kind === 'need'
          ? { kind: 'need', item: decision.item, others: decision.others }
          : { kind: 'scheduled', others: decision.others };
    return {
      target,
      unreadCount: unreadRing(entries, prompts, marks, currentId).length,
      idleCount: idleRing(entries, prompts, marks, currentId).length,
      waitCount: needs.waits,
    };
  }, [panes, tabs, prompts, marks, kova, currentId, homeTab, needs.items, needs.waits]);
}
