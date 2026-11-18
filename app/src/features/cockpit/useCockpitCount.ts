// Le nombre de cartes du Cockpit, pour la ligne « Cockpit · N » de Needs you : la derniere
// lecture de la file, sans en declencher une (le Cockpit et l'onglet qui le monte sondent).
// Le meme compte que le filtre `Tout` du Cockpit.
import { useMemo } from 'react';
import { useAttentionStore } from '@/features/asks/useAttention';
import { visibleEntries } from './gesture';
import { PAGE_SIZE, cockpitPage } from './rules';
import { useCockpit } from './useCockpit';
import { useClock } from '@/utils/useClock';

export function useCockpitCount(): number {
  const entries = useAttentionStore((s) => s.entries);
  const hidden = useCockpit((s) => s.hidden);
  const now = useClock(true, 30_000);
  return useMemo(() => cockpitPage(visibleEntries(entries ?? [], hidden, now), 'all', PAGE_SIZE).total, [entries, hidden, now]);
}
