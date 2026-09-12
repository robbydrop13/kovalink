// Palette des panes : le Cmd+P de Kova sur l'iPhone. Tous les panes de tous les onglets
// en lignes compactes (pastille et nom de l'onglet, titre du pane, projet, état), PUIS les
// sessions fermées (PRD 3.4, design 4.11) avec leur dernier accès. Recherche en haut avec
// le clavier ouvert. Un tap ouvre la session ouverte (ou la vue Term pour un shell) ;
// sur une fermée, une feuille propose de la lire ou de la reprendre ; un appui long la
// lit directement. Feuille modale : balayage vers le bas pour fermer.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';

import type { KovaSessionEntry, Pane, RecentProject } from '@/protocol';
import { colors } from '@/theme';
import { Banner } from '@/ui/States';
import { Palette, type PaletteRow } from '@/ui/Palette';
import { paneBadge, paneHref, paneLabel } from '@/features/sessions/SessionRow';
import { tabTint } from '@/features/sessions/TabGroupView';
import { groupByTab, isStaleSession, paletteEntries } from '@/features/sessions/tabGroups';
import { closedMatching } from '@/features/sessions/closedSessions';
import { isUnread } from '@/features/sessions/unread';
import { useReads } from '@/store/reads';
import { askResume, readSession, sessionAge } from '@/features/sessions/resume';
import { confirmClose, toggleBookmark } from '@/features/sessions/paneActions';
import type { SwipeActions } from '@/features/sessions/SwipeRow';
import { fetchRecentProjects, fetchSessions, postNewTab } from '@/net/http';
import { matchesQuery } from '@/utils/search';
import { ImpactStyle, impact } from '@/utils/haptics';
import { useConnection } from '@/store/connection';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';
import { t } from '@/i18n/en';

const CLOSED_PREFIX = 'closed:';
const PROJECT_PREFIX = 'project:';

export default function PanesPaletteScreen() {
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const prompts = usePrompts((s) => s.byPane);
  const marks = useReads((s) => s.byPane);
  const kova = useConnection((s) => s.kova);
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<KovaSessionEntry[] | null>(null);
  /** Projets récents de Kova : « New session in … » quand la saisie correspond (Cmd+O fusionné). */
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [launching, setLaunching] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchSessions().then(
      (res) => setSessions(res.sessions),
      (e: unknown) => {
        setSessions([]);
        setNotice(t.panesClosedUnavailable(e instanceof Error ? e.message : String(e)));
      },
    );
  }, []);
  useEffect(() => {
    load();
    void fetchRecentProjects().then(
      (res) => setProjects(res.projects),
      () => setProjects([]),
    );
  }, [load]);
  const projectMatches = useMemo(
    () => (query.trim().length === 0 ? [] : projects.filter((p) => matchesQuery(`${p.label} ${p.path}`, query)).slice(0, 5)),
    [projects, query],
  );
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
        onRename: () => router.push({ pathname: '/rename', params: { paneId: String(pane.id) } }),
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
        title: paneLabel(pane),
        subtitle: pane.agent && pane.agent !== pane.title ? `${pane.projectName} · ${pane.agent}` : pane.projectName,
        badge: paneBadge(pane, prompts[pane.id]),
        // Non lu (Cmd+J) : le badge passe à l'accent, pour que Cmd+P montre ce que Cmd+J va parcourir.
        badgeColor: isUnread(pane, prompts[pane.id], marks)
          ? colors.accent.primary
          : pane.awaiting
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
      badge: t.panesClosedBadge(sessionAge(s)),
      badgeColor: colors.status.closed,
      starred: s.bookmarked,
    }));
    // Les favoris en tête, ouverts ou fermés, puis les panes ouverts, puis les fermées.
    const starred = [...open, ...closedRows].filter((r) => r.starred);
    const rest = (list: PaletteRow[]) => list.filter((r) => !r.starred);
    const out: PaletteRow[] = [];
    if (starred.length > 0) out.push({ key: 'section:bookmarks', tint: null, title: t.panesSectionBookmarks, subtitle: '', section: true }, ...starred);
    if (starred.length > 0 && rest(open).length > 0) out.push({ key: 'section:open', tint: null, title: t.panesSectionOpen, subtitle: '', section: true });
    out.push(...rest(open));
    if (rest(closedRows).length > 0) {
      out.push({ key: 'section:closed', tint: null, title: t.panesSectionClosed(rest(closedRows).length), subtitle: '', section: true }, ...rest(closedRows));
    }
    // Sous les résultats : créer une session sur un projet récent qui correspond à la saisie (Cmd+O fusionné).
    if (projectMatches.length > 0) {
      out.push({ key: 'section:projects', tint: null, title: t.panesSectionProjects, subtitle: '', section: true });
      for (const p of projectMatches) {
        const busy = launching === p.index;
        out.push({
          key: `${PROJECT_PREFIX}${p.index}`,
          tint: colors.accent.primary,
          title: t.panesNewSessionIn(p.label),
          subtitle: p.path,
          badge: busy ? t.projectsCreating : undefined,
          badgeColor: colors.status.working,
          disabled: launching !== null,
        });
      }
    }
    return out;
  }, [entries, closed, prompts, bookmarked, swipeFor, marks, projectMatches, launching]);

  const closedOf = (row: PaletteRow): KovaSessionEntry | undefined =>
    row.key.startsWith(CLOSED_PREFIX) ? closed.find((s) => s.sessionId === row.key.slice(CLOSED_PREFIX.length)) : undefined;

  const pick = (row: PaletteRow) => {
    if (row.key.startsWith(PROJECT_PREFIX)) {
      const project = projectMatches.find((p) => String(p.index) === row.key.slice(PROJECT_PREFIX.length));
      if (!project || launching !== null) return;
      setLaunching(project.index);
      impact(ImpactStyle.Medium);
      void postNewTab(project).then(
        (res) => router.replace(res.launched ? `/session/${res.paneId}` : `/session/${res.paneId}?view=term`),
        (e: unknown) => {
          setNotice(t.projectsCreateFailed(e instanceof Error ? e.message : String(e)));
          setLaunching(null);
        },
      );
      return;
    }
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
      title={t.panesTitle}
      placeholder={t.panesPlaceholder}
      rows={sessions === null && entries.length === 0 ? null : rows}
      query={query}
      onQuery={setQuery}
      onPick={pick}
      onLongPress={longPress}
      emptyTitle={query ? t.panesNoMatchTitle : t.panesEmptyTitle}
      emptyBody={query ? t.panesNoMatchBody : t.panesEmptyBody}
      accessibilityLabel={t.panesSearchAccessibilityLabel}
      banners={
        <>
          {kova === 'down' ? <Banner tone="warn" text={t.kovaNotRunningOnMac} /> : null}
          {notice ? <Banner tone="error" text={notice} /> : null}
        </>
      }
    />
  );
}
