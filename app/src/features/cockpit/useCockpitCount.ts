// Le nombre de cartes du Cockpit, pour la ligne « Cockpit · N » de Needs you : la derniere
// lecture de la file, sans en declencher une (le Cockpit et l'onglet qui le monte sondent).
// Le meme compte que le filtre `Tout` du Cockpit.
import { useEffect, useMemo } from 'react';
import { useAttentionStore } from '@/features/asks/useAttention';
import { useAsks } from '@/store/asks';
import { visibleEntries } from './gesture';
import { PAGE_SIZE, cockpitBadgeCount, cockpitPage } from './rules';
import { useCockpit } from './useCockpit';
import { useClock } from '@/utils/useClock';

export function useCockpitCount(): number {
  const entries = useAttentionStore((s) => s.entries);
  const hidden = useCockpit((s) => s.hidden);
  const now = useClock(true, 30_000);
  return useMemo(() => cockpitPage(visibleEntries(entries ?? [], hidden, now), 'all', PAGE_SIZE).total, [entries, hidden, now]);
}

/**
 * Le badge de l'onglet Cockpit (`now` et Urgentes). Hors de l'onglet, rien ne sonde : la
 * file est relue quand le `waitsOnYou` du daemon bouge, ce qu'une carte `now` ou Urgente
 * ouverte ou fermee sur le Mac fait.
 */
export function useCockpitBadge(): number {
  const entries = useAttentionStore((s) => s.entries);
  const hidden = useCockpit((s) => s.hidden);
  const waits = useAsks((s) => s.waitsOnYou);
  const now = useClock(true, 30_000);
  useEffect(() => {
    void useAttentionStore.getState().load();
  }, [waits]);
  return useMemo(() => cockpitBadgeCount(visibleEntries(entries ?? [], hidden, now)), [entries, hidden, now]);
}
