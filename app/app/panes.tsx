// Palette des panes : le Cmd+P de Kova sur l'iPhone. Tous les panes de tous les onglets
// en lignes compactes (pastille et nom de l'onglet, titre du pane, projet, état), PUIS les
// sessions fermées (PRD 3.4, design 4.11) avec leur dernier accès. Recherche en haut avec
// le clavier ouvert. Un tap ouvre la session ouverte (ou la vue Term pour un shell) ;
// sur une fermée, une feuille propose de la lire ou de la reprendre ; un appui long la
// lit directement. Feuille modale : balayage vers le bas pour fermer.
import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';

import type { KovaSessionEntry } from '@/protocol';
import { colors } from '@/theme';
import { Banner } from '@/ui/States';
import { Palette, type PaletteRow } from '@/ui/Palette';
import { paneBadge, paneHref } from '@/features/sessions/SessionRow';
import { tabTint } from '@/features/sessions/TabGroupView';
import { groupByTab, isStaleSession, paletteEntries } from '@/features/sessions/tabGroups';
import { closedMatching } from '@/features/sessions/closedSessions';
import { askResume, readSession, sessionAge } from '@/features/sessions/resume';
import { fetchSessions } from '@/net/http';
import { useConnection } from '@/store/connection';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';

const CLOSED_PREFIX = 'closed:';

export default function PanesPaletteScreen() {
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const prompts = usePrompts((s) => s.byPane);
  const kova = useConnection((s) => s.kova);
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<KovaSessionEntry[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void fetchSessions().then(
      (res) => setSessions(res.sessions),
      (e: unknown) => {
        setSessions([]);
        setNotice(`Sessions fermées indisponibles. ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }, []);

  const groups = useMemo(() => groupByTab(kova === 'down' ? [] : panes, tabs), [kova, panes, tabs]);
  const entries = useMemo(() => paletteEntries(groups, query), [groups, query]);
  const closed = useMemo(() => closedMatching(sessions ?? [], query), [sessions, query]);

  const rows = useMemo<PaletteRow[]>(() => {
    const open: PaletteRow[] = entries.map(({ pane, group }) => ({
      key: String(pane.id),
      tint: tabTint(group.color),
      prefix: group.title,
      title: pane.title ?? pane.agent ?? 'pane',
      subtitle: pane.agent && pane.agent !== pane.title ? `${pane.projectName} · ${pane.agent}` : pane.projectName,
      badge: paneBadge(pane, prompts[pane.id]),
      badgeColor: pane.awaiting
        ? colors.status.awaiting
        : pane.working
          ? colors.status.working
          : isStaleSession(pane)
            ? colors.status.awaiting
            : colors.text.tertiary,
    }));
    const closedRows: PaletteRow[] = closed.map((s) => ({
      key: `${CLOSED_PREFIX}${s.sessionId}`,
      tint: null,
      prefix: s.projectName,
      title: s.title,
      subtitle: s.cwd,
      badge: `fermée · ${sessionAge(s)}`,
      badgeColor: colors.status.closed,
    }));
    if (closedRows.length === 0) return open;
    return [
      ...open,
      { key: 'section:closed', tint: null, title: `FERMÉES · ${closedRows.length}`, subtitle: '', section: true },
      ...closedRows,
    ];
  }, [entries, closed, prompts]);

  const closedOf = (row: PaletteRow): KovaSessionEntry | undefined =>
    row.key.startsWith(CLOSED_PREFIX) ? closed.find((s) => s.sessionId === row.key.slice(CLOSED_PREFIX.length)) : undefined;

  const pick = (row: PaletteRow) => {
    const session = closedOf(row);
    if (session) {
      askResume(session, setNotice);
      return;
    }
    const entry = entries.find((e) => String(e.pane.id) === row.key);
    if (entry) router.replace(paneHref(entry.pane));
  };

  const longPress = (row: PaletteRow) => {
    const session = closedOf(row);
    if (session) readSession(session);
  };

  return (
    <Palette
      title="Panes"
      placeholder="Onglet, projet, titre ou session fermée"
      rows={sessions === null && entries.length === 0 ? null : rows}
      query={query}
      onQuery={setQuery}
      onPick={pick}
      onLongPress={longPress}
      emptyTitle={query ? 'Aucun pane ne correspond' : 'Aucun pane'}
      emptyBody={query ? 'Essaie un autre mot.' : 'Ouvre un pane dans Kova, il apparaîtra ici.'}
      accessibilityLabel="Rechercher un pane ou une session"
      banners={
        <>
          {kova === 'down' ? <Banner tone="warn" text="Kova n’est pas lancé sur le Mac" /> : null}
          {notice ? <Banner tone="error" text={notice} /> : null}
        </>
      }
    />
  );
}
