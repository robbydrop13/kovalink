// Le modele de Needs you a chaque rendu, depuis les magasins : panes et erreurs, prompts,
// routines, questions. Le calcul (ordre, comptes) reste dans le protocole, appele par
// `needs.ts`. L'horloge ne sert qu'a faire revenir une question reportee et a vieillir les
// lignes ; elle tique lentement, rien ici ne court a la seconde.
import { useMemo } from 'react';
import type { NeedItem } from '@/protocol';
import { useAsks } from '@/store/asks';
import { useConnection } from '@/store/connection';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';
import { useRoutinesSnapshot } from '@/features/scheduled/useRoutines';
import { useClock } from '@/utils/useClock';
import { needInputOf, needModelOf } from './needs';

const NEEDS_TICK_MS = 30_000;

export interface NeedsView {
  items: NeedItem[];
  /** Le compte du protocole : prompts de permission et questions ouvertes. */
  waits: number;
  now: number;
}

export function useNeeds(): NeedsView {
  const panes = usePanes((s) => s.panes);
  const errorSince = usePanes((s) => s.errorSince);
  const prompts = usePrompts((s) => s.byPane);
  const routines = useRoutinesSnapshot();
  const asks = useAsks((s) => s.asks);
  const kovaDown = useConnection((s) => s.kova === 'down');
  const now = useClock(true, NEEDS_TICK_MS);
  return useMemo(() => {
    const model = needModelOf(
      needInputOf({
        panes: kovaDown ? [] : panes,
        prompts,
        routines,
        asks,
        errorSince,
        nowMs: now,
      }),
    );
    return { items: model.items, waits: model.waits, now };
  }, [panes, errorSince, prompts, routines, asks, kovaDown, now]);
}
