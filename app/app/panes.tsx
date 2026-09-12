// Palette des panes : le Cmd+P de Kova sur l'iPhone. Tous les panes de tous les onglets
// en lignes compactes (pastille et nom de l'onglet, titre du pane, projet, état), PUIS les
// sessions fermées (PRD 3.4, design 4.11) avec leur dernier accès. Recherche en haut avec
// le clavier ouvert. Un tap ouvre la session ouverte (ou la vue Term pour un shell) ;
// sur une fermée, une feuille propose de la lire ou de la reprendre ; un appui long la
// lit directement. Feuille modale : balayage vers le bas pour fermer.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';

import type { KovaSessionEntry, Pane } from '@/protocol';
import { colors } from '@/theme';
import { Banner } from '@/ui/States';
import { Palette, type PaletteRow } from '@/ui/Palette';
import { paneBadge, paneHref } from '@/features/sessions/SessionRow';
import { tabTint } from '@/features/sessions/TabGroupView';
import { groupByTab, isStaleSession, paletteEntries } from '@/features/sessions/tabGroups';
import { closedMatching } from '@/features/sessions/closedSessions';
import { askResume, readSession, sessionAge } from '@/features/sessions/resume';
import { confirmClose, promptRename, toggleBookmark } from '@/features/sessions/paneActions';
import type { SwipeActions } from '@/features/sessions/SwipeRow';
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

  const load = useCallback(() => {
    void fetchSessions().then(
      (res) => setSessions(res.sessions),
      (e: unknown) => {
        setSessions([]);
        setNotice(`Closed sessions unavailable. ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const bookmarked = useMemo(() => new Set((sessions ?? []).filter((x) => x.bookmarked).map((x) => x.sessionId)), [sessions]);

  const groups = useMemo(() => groupByTab(kova === 'down' ? [] : panes, tabs), [kova, panes, tabs]);
  const entries = useMemo(() => paletteEntries(groups, query), [groups, query]);
  const closed = useMemo(() => closedMatching(sessions ?? [], query), [sessions, query]);

  const swipeFor = useCallback(
    (pane: Pane, tabTitle: string): SwipeActions => {
      const sessionId = pane.agent_session_id ?? pane.claude_session_id;
      const isBookmarked = sessionId !== null && bookmarked.has(sessionId);
      return {
        bookmarked: isBookmarked,
        onClose: () => confirmClose(pane, tabTitle, setNotice),
        onBookmark: () => void toggleBookmark(pane, isBookmarked, setNotice).then(() => load()),
        onRename: () => promptRename(pane, tabTitle, setNotice),
      };
    },
    [bookmarked, load],
  );

  const rows = useMemo<PaletteRow[]>(() => {
    const open: PaletteRow[] = entries.map(({ pane, group }) => {
      const sessionId = pane.agent_session_id ?? pane.claude_session_id;
      return {
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
        starred: sessionId !== null && bookmarked.has(sessionId),
        swipe: swipeFor(pane, group.title),
      };
    });
    const closedRows: PaletteRow[] = closed.map((s) => ({
      key: `${CLOSED_PREFIX}${s.sessionId}`,
      tint: null,
      prefix: s.projectName,
      title: s.title,
      subtitle: s.cwd,
      badge: `closed · ${sessionAge(s)}`,
      badgeColor: colors.status.closed,
      starred: s.bookmarked,
    }));
    // Les favoris en tête, ouverts ou fermés, puis les panes ouverts, puis les fermées.
    const starred = [...open, ...closedRows].filter((r) => r.starred);
    const rest = (list: PaletteRow[]) => list.filter((r) => !r.starred);
    const out: PaletteRow[] = [];
    if (starred.length > 0) out.push({ key: 'section:bookmarks', tint: null, title: 'BOOKMARKS', subtitle: '', section: true }, ...starred);
    if (starred.length > 0 && rest(open).length > 0) out.push({ key: 'section:open', tint: null, title: 'OPEN', subtitle: '', section: true });
    out.push(...rest(open));
    if (rest(closedRows).length > 0) {
      out.push({ key: 'section:closed', tint: null, title: `CLOSED · ${rest(closedRows).length}`, subtitle: '', section: true }, ...rest(closedRows));
    }
    return out;
  }, [entries, closed, prompts, bookmarked, swipeFor]);

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
      placeholder="Tab, project, title or closed session"
      rows={sessions === null && entries.length === 0 ? null : rows}
      query={query}
      onQuery={setQuery}
      onPick={pick}
      onLongPress={longPress}
      emptyTitle={query ? 'No matching pane' : 'No panes'}
      emptyBody={query ? 'Try another word.' : 'Open a pane in Kova and it will show up here.'}
      accessibilityLabel="Search panes and sessions"
      banners={
        <>
          {kova === 'down' ? <Banner tone="warn" text="Kova is not running on the Mac" /> : null}
          {notice ? <Banner tone="error" text={notice} /> : null}
        </>
      }
    />
  );
}
