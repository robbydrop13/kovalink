// La cible de Cmd+J recalculée à chaque rendu depuis les stores : panes et onglets, prompts
// lisibles, marques de lecture. Pane courant exclu. Le repli « inactive » suit.
import { useMemo } from 'react';
import { useConnection } from '@/store/connection';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';
import { useReads } from '@/store/reads';
import { groupByTab, paletteEntries } from './tabGroups';
import { idleRing, nextTarget, unreadRing, type NextTarget } from './unread';

export interface NextState {
  target: NextTarget;
  unreadCount: number;
  idleCount: number;
}

export function useNextTarget(currentId: number | null): NextState {
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const prompts = usePrompts((s) => s.byPane);
  const marks = useReads((s) => s.byPane);
  const kova = useConnection((s) => s.kova);
  return useMemo(() => {
    const entries = paletteEntries(groupByTab(kova === 'down' ? [] : panes, tabs), '');
    return {
      target: nextTarget(entries, prompts, marks, currentId),
      unreadCount: unreadRing(entries, prompts, marks, currentId).length,
      idleCount: idleRing(entries, prompts, marks, currentId).length,
    };
  }, [panes, tabs, prompts, marks, kova, currentId]);
}
