// Palette des panes : le Cmd+P de Kova sur l'iPhone. Tous les panes de tous les onglets
// en lignes compactes (pastille et nom de l'onglet, titre du pane, projet, état), recherche
// en haut avec le clavier ouvert, un tap ouvre la session (ou la vue Term pour un shell).
// Feuille modale : balayage vers le bas pour fermer.
import { useMemo, useState } from 'react';
import { router } from 'expo-router';

import { colors } from '@/theme';
import { Banner } from '@/ui/States';
import { Palette, type PaletteRow } from '@/ui/Palette';
import { paneBadge, paneHref } from '@/features/sessions/SessionRow';
import { tabTint } from '@/features/sessions/TabGroupView';
import { groupByTab, isStaleSession, paletteEntries } from '@/features/sessions/tabGroups';
import { useConnection } from '@/store/connection';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';

export default function PanesPaletteScreen() {
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const prompts = usePrompts((s) => s.byPane);
  const kova = useConnection((s) => s.kova);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => groupByTab(kova === 'down' ? [] : panes, tabs), [kova, panes, tabs]);
  const entries = useMemo(() => paletteEntries(groups, query), [groups, query]);

  const rows = useMemo<PaletteRow[]>(
    () =>
      entries.map(({ pane, group }) => {
        const badge = paneBadge(pane, prompts[pane.id]);
        return {
          key: String(pane.id),
          tint: tabTint(group.color),
          prefix: group.title,
          title: pane.title ?? pane.agent ?? 'pane',
          subtitle: pane.agent && pane.agent !== pane.title ? `${pane.projectName} · ${pane.agent}` : pane.projectName,
          badge,
          badgeColor: pane.awaiting
            ? colors.status.awaiting
            : pane.working
              ? colors.status.working
              : isStaleSession(pane)
                ? colors.status.awaiting
                : colors.text.tertiary,
        };
      }),
    [entries, prompts],
  );

  const pick = (row: PaletteRow) => {
    const entry = entries.find((e) => String(e.pane.id) === row.key);
    if (!entry) return;
    router.replace(paneHref(entry.pane));
  };

  return (
    <Palette
      title="Panes"
      placeholder="Onglet, projet ou titre de pane"
      rows={rows}
      query={query}
      onQuery={setQuery}
      onPick={pick}
      emptyTitle={query ? 'Aucun pane ne correspond' : 'Aucun pane'}
      emptyBody={query ? 'Essaie un autre mot.' : 'Ouvre un pane dans Kova, il apparaîtra ici.'}
      accessibilityLabel="Rechercher un pane"
      banners={kova === 'down' ? <Banner tone="warn" text="Kova n’est pas lancé sur le Mac" /> : null}
    />
  );
}
