// Écran Sessions. Il répond à deux questions : qu'est-ce qui m'attend, et où est la
// session que je cherche.
//
// La liste reproduit la STRUCTURE de Kova : un groupe par onglet, dans l'ordre de la barre
// d'onglets du Mac, avec la couleur et le nom de l'onglet, et sous chaque onglet ses panes.
// Les états sont des badges, pas des sections : un pane qui attend garde sa carte, à sa
// place. Une ligne de résumé en tête dit ce qui attend. La recherche filtre onglets et
// panes sans casser le regroupement. Ouvrir une session bascule l'onglet sur le Mac
// (réglage « Suivre sur le Mac ») : c'est le Cmd+P de Kova, `Projets` en bas son Cmd+O.
//
// Aucun bouton d'approbation ici (A7, P3). `Interrompre` en revanche est disponible sur la
// carte EN ATTENTE comme sur la ligne TRAVAILLE : c'est le geste sûr, on le rend le plus
// facile possible, et le scénario S3 décrit un pane qui travaille.
//
// Tenir 300 ms puis glisser réordonne : un pane dans son onglet, un onglet dans sa fenêtre
// (tous les onglets se replient le temps du geste). L'ordre visé s'affiche tout de suite et
// part au Mac ; sans confirmation il revient, avec un mot. Pendant le geste la liste est
// figée : les instantanés continuent d'arriver sans la refaire sous le doigt.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActionSheetIOS, LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Pane } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction, RoundButton } from '@/ui/Button';
import { LinkPill } from '@/ui/LinkPill';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { Icon } from '@/ui/Icon';
import { TabGroupView } from '@/features/sessions/TabGroupView';
import { paneHref } from '@/features/sessions/SessionRow';
import { useNextTarget } from '@/features/sessions/useNextTarget';
import { isUnread } from '@/features/sessions/unread';
import { useReads } from '@/store/reads';
import { useTabCollapse } from '@/store/tabCollapse';
import { useReorder, type ReorderFailure } from '@/store/reorder';
import { ImpactStyle, NotifyType, impact, notify } from '@/utils/haptics';
import { confirmClose, toggleBookmark } from '@/features/sessions/paneActions';
import type { SwipeActions } from '@/features/sessions/SwipeRow';
import type { ReorderActions } from '@/features/sessions/reorderAccessibility';
import { DragItem, DragScrollContext, useDragReorder, type DragScroll } from '@/features/sessions/useDragReorder';
import { applyPendingOrder, groupByTab, summaryLine, tabOrderOf, windowCount, type TabGroup } from '@/features/sessions/tabGroups';
import { useInterrupt } from '@/features/sessions/useInterrupt';
import { isDegraded, useConnection } from '@/store/connection';
import { usePanes } from '@/store/panes';
import { isAging, usePrompts } from '@/store/prompts';
import { forceReconnect } from '@/net/connection';
import { fetchPanes, fetchSessions, postKovaLaunch, postSplit } from '@/net/http';
import { clockTime } from '@/utils/time';
import { retryBoot, useBootError, useBootState } from '@/boot';
import { PUSH_UNAVAILABLE_LABEL, pushAvailable } from '@/env';
import { ErrorScreen } from '@/ui/ErrorScreen';
import { t } from '@/i18n/en';

export default function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const boot = useBootState();
  const bootError = useBootError();
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const loading = usePanes((s) => s.loading);
  const fetchedAt = usePanes((s) => s.fetchedAt);
  const applySnapshot = usePanes((s) => s.applySnapshot);
  const pendingTabs = useReorder((s) => s.tabs);
  const pendingPanes = useReorder((s) => s.panes);
  const moveTab = useReorder((s) => s.moveTab);
  const movePane = useReorder((s) => s.movePane);
  const reconcile = useReorder((s) => s.reconcile);
  const prompts = usePrompts((s) => s.byPane);
  const link = useConnection((s) => s.link);
  const kova = useConnection((s) => s.kova);
  const lastError = useConnection((s) => s.lastError);
  const degraded = isDegraded(link);
  const { run: interrupt, labelFor } = useInterrupt();
  const [refreshing, setRefreshing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** Sessions en favori dans Kova, pour l'étoile et le libellé du balayage. */
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadBookmarks = useCallback(() => {
    void fetchSessions().then(
      (res) => setBookmarked(new Set(res.sessions.filter((x) => x.bookmarked).map((x) => x.sessionId))),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const snapshot = await fetchPanes();
      applySnapshot(snapshot);
      reconcile(snapshot.tabs, snapshot.panes);
      loadBookmarks();
    } catch {
      forceReconnect();
    } finally {
      setRefreshing(false);
    }
  }, [applySnapshot, reconcile, loadBookmarks]);

  // Kova quitté (CA-123) : le daemon a vidé sa liste et l'a annoncé. Ce qui resterait en
  // cache serait des panes fantômes, on ne les montre pas.
  const kovaDown = kova === 'down';
  const groups = useMemo(() => groupByTab(kovaDown ? [] : panes, tabs), [kovaDown, panes, tabs]);
  // L'ordre visé par un déplacement encore en attente s'applique par dessus l'instantané.
  const displayGroups = useMemo(() => applyPendingOrder(groups, pendingTabs, pendingPanes), [groups, pendingTabs, pendingPanes]);
  /** La liste figée pendant un geste, du levé au lâcher. */
  const [frozen, setFrozen] = useState<TabGroup[] | null>(null);
  const shown = frozen ?? displayGroups;
  const windows = windowCount(shown);
  // Cmd+J depuis la liste : l'anneau entier (aucun pane courant), la ligne de résumé.
  const next = useNextTarget(null);
  const marks = useReads((s) => s.byPane);
  const collapsedTabs = useTabCollapse((s) => s.collapsed);
  const toggleCollapse = useTabCollapse((s) => s.toggle);
  const unreadOf = (pane: Pane) => isUnread(pane, prompts[pane.id], marks);
  const summary = kovaDown ? null : summaryLine(panes);
  const jumpNext = () => {
    if (!next.target) return;
    impact(ImpactStyle.Light);
    router.push(paneHref(next.target.entry.pane));
  };
  // Un pane sans agent s'ouvre sur la vue Term ; une session périmée propose de relancer
  // Claude dans son dossier via la feuille « Nouvelle session », préfiltrée.
  const open = (paneId: number) => {
    const pane = panes.find((p) => p.id === paneId);
    router.push(pane ? paneHref(pane) : `/session/${paneId}`);
  };
  const relaunch = (pane: Pane) =>
    router.push({ pathname: '/new-session', params: { cwd: pane.cwd } });
  // Un tap sur l'en-tête replie ou déplie l'onglet, par identifiant Kova (stable à travers
  // les réordonnancements). Un onglet sans identifiant (avant `list-tabs`) reste déplié.
  // Pendant un geste, rien : une animation de disposition casserait la géométrie mesurée.
  const toggleTab = (group: TabGroup) => {
    if (group.tabId === null || frozen) return;
    impact(ImpactStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    toggleCollapse(group.tabId);
  };

  // --- Glisser-déposer ------------------------------------------------------------------
  const scrollRef = useRef<ScrollView>(null);
  const offsetY = useRef(0);
  const viewport = useRef({ top: 0, height: 0 });
  const contentHeight = useRef(0);
  const [scrollLocked, setScrollLocked] = useState(false);
  const dragScroll = useMemo<DragScroll>(
    () => ({ scrollRef, offsetY, viewport, contentHeight, lock: setScrollLocked }),
    [],
  );
  /** Le temps d'un déplacement d'onglet, tous les onglets sont repliés (sans le persister). */
  const [tabDragging, setTabDragging] = useState(false);
  /** Miroir de `frozen` lisible depuis un rappel différé (le délai de confirmation). */
  const dragging = useRef(false);
  const freeze = () => {
    dragging.current = true;
    setFrozen(shown);
  };
  const unfreeze = () => {
    dragging.current = false;
    setFrozen(null);
  };
  // Le Mac n'a pas suivi : la liste revient à son ordre, animée sauf en plein geste (la
  // liste y est figée, l'animation s'appliquerait au lâcher et casserait la pose).
  const reportFailure = (kind: ReorderFailure) => {
    notify(kind === 'unsupported' ? NotifyType.Error : NotifyType.Warning);
    if (!dragging.current) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setToast(kind === 'unsupported' ? t.reorderNeedsKovaUpdate : t.reorderNotConfirmed);
  };
  const tabKeys = useMemo(() => shown.map((g) => g.key), [shown]);
  /** Rangs atteignables par un onglet : ceux de sa fenêtre (la liste est triée par fenêtre). */
  const windowRange = (index: number): [number, number] => {
    const window = shown[index]?.window;
    const lo = shown.findIndex((g) => g.window === window);
    return [lo, lo + shown.filter((g) => g.window === window).length - 1];
  };
  const canDragTab = (group: TabGroup, index: number): boolean => {
    const [lo, hi] = windowRange(index);
    return !degraded && group.tabId !== null && lo < hi;
  };
  /** Un onglet lâché, ou déplacé d'un rang par VoiceOver : l'ordre visé part au Mac. */
  const dropTab = (from: number, to: number) => {
    unfreeze();
    const group = shown[from];
    const target = shown[to];
    if (from === to || !group || !target || group.tabId === null || target.tabId === null) return;
    // Disparu entre le levé et le lâcher : rien à envoyer, l'instantané a déjà raison.
    if (!tabs.some((tab) => tab.id === group.tabId)) return;
    const order = tabOrderOf(shown, group.window);
    void moveTab(group.window, order, order.indexOf(group.tabId), order.indexOf(target.tabId), reportFailure);
  };
  const tabDrag = useDragReorder<string>({
    keys: tabKeys,
    gap: space[6],
    enabled: !degraded && !frozen,
    // L'écran n'est pas sous son propre fournisseur : le défilement est passé en direct.
    scroll: dragScroll,
    range: windowRange,
    onLift: () => {
      freeze();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTabDragging(true);
    },
    onDrop: dropTab,
    onSettled: () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTabDragging(false);
    },
  });
  const tabReorderFor = (group: TabGroup, index: number): ReorderActions | undefined => {
    if (!canDragTab(group, index)) return undefined;
    const [lo, hi] = windowRange(index);
    return {
      canUp: index > lo,
      canDown: index < hi,
      onMove: (dir) => {
        dropTab(index, index + dir);
        AccessibilityInfo.announceForAccessibility(t.reorderMovedTo(index + dir - lo + 1, hi - lo + 1));
      },
    };
  };
  /** Un pane lâché dans son onglet, ou déplacé d'un rang par VoiceOver. */
  const dropPane = (group: TabGroup) => (from: number, to: number) => {
    unfreeze();
    if (from === to || group.tabId === null) return;
    const order = group.panes.map((p) => p.id);
    const paneId = order[from];
    if (paneId === undefined || !panes.some((p) => p.id === paneId)) return;
    void movePane(group.tabId, order, from, to, reportFailure);
  };
  /**
   * Le `+` d'un onglet : un pane de plus dedans, avec Claude. Deux choix, le dossier de
   * l'onglet (le cas courant) ou un projet récent via la palette, en mode « Add to ».
   */
  const addPane = (group: TabGroup) => {
    if (group.tabId === null || degraded) return;
    const tabId = group.tabId;
    const folder = group.panes[0]?.projectName ?? group.title;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t.tabAddPaneTitle(group.title),
        options: [t.tabAddPaneSameFolder(folder), t.tabAddPanePick, t.actionCancel],
        cancelButtonIndex: 2,
        userInterfaceStyle: 'dark',
      },
      (index) => {
        if (index === 1) {
          router.push({ pathname: '/new-session', params: { splitTabId: String(tabId), splitTabTitle: group.title } });
          return;
        }
        if (index !== 0) return;
        impact(ImpactStyle.Medium);
        postSplit(tabId, null).then(
          (res) => router.push(res.launched ? `/session/${res.paneId}` : `/session/${res.paneId}?view=term`),
          (e: unknown) => setToast(t.projectsSplitFailed(e instanceof Error ? e.message : String(e))),
        );
      },
    );
  };
  // Balayage : les mêmes gestes que sur le Mac. Fermer est confirmé avec l'état réel.
  const swipeFor = (pane: Pane, group: TabGroup): SwipeActions => {
    const sessionId = pane.agent_session_id ?? pane.claude_session_id;
    const isBookmarked = sessionId !== null && bookmarked.has(sessionId);
    return {
      bookmarked: isBookmarked,
      onClose: () => confirmClose(pane, group.title, setToast),
      onBookmark: () =>
        void toggleBookmark(pane, isBookmarked, setToast).then((next) => {
          if (next === null || !sessionId) return;
          setBookmarked((prev) => {
            const out = new Set(prev);
            if (next) out.add(sessionId);
            else out.delete(sessionId);
            return out;
          });
        }),
      onRename: () => router.push({ pathname: '/rename', params: { paneId: String(pane.id) } }),
    };
  };
  const aging = (paneId: number) => isAging(prompts[paneId]);

  /**
   * `Lancer Kova` (design 4.1, CA-123) : `POST /v1/kova/launch`, le daemon fait `open -a
   * Kova`. La liste se remplit d'elle même quand le socket réapparaît, il n'y a rien à
   * relire ici. L'échec est montré avec la cause du daemon, jamais maquillé.
   */
  const launchKova = useCallback(async () => {
    setLaunching(true);
    try {
      const res = await postKovaLaunch();
      setToast(res.alreadyUp ? t.sessionsKovaAlreadyUp : t.sessionsKovaLaunching);
    } catch (e) {
      setToast(t.sessionsKovaLaunchFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setLaunching(false);
    }
  }, []);

  // Le portillon d'appairage vit ICI, dans une route, donc à l'intérieur du navigateur.
  // Placé dans le layout racine, il empêchait le navigateur d'exister et laissait un écran
  // blanc silencieux.
  if (boot === 'unpaired') return <Redirect href="/pair" />;

  if (boot === 'failed') {
    return (
      <ErrorScreen
        title={t.sessionsBootFailedTitle}
        error={bootError}
        hint={t.sessionsBootFailedHint}
        onRetry={retryBoot}
      />
    );
  }

  if (boot === 'loading') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <SkeletonList />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <Txt variant="title1" color={colors.text.primary}>
          {t.sessionsTitle}
        </Txt>
        <View style={styles.grow} />
        <LinkPill onPress={() => router.push('/settings')} />
        {/* Le bloc C ne dépend pas de Kova : l'accès aux fichiers reste offert même quand
            la liste des sessions est vide parce que Kova est quitté (CA-123). */}
        <LinkAction icon="folder" label={t.sessionsNavFiles} onPress={() => router.push('/files')} />
        <LinkAction icon="settings" label={t.sessionsNavSettings} onPress={() => router.push('/settings')} />
      </View>

      {degraded ? (
        <Banner
          tone={link === 'offline' ? 'offline' : 'warn'}
          text={
            link === 'offline'
              ? t.sessionsOfflineBanner(clockTime(fetchedAt))
              : t.sessionsMacAsleepBanner(clockTime(fetchedAt))
          }
          actionLabel={t.actionRetry}
          onAction={forceReconnect}
        />
      ) : null}

      {!degraded && lastError ? (
        <Banner tone="error" text={lastError} actionLabel={t.actionRetry} onAction={forceReconnect} />
      ) : null}

      {/* Bandeau discret et non bloquant : tout le reste de l'app fonctionne normalement. */}
      {!pushAvailable ? <Banner text={PUSH_UNAVAILABLE_LABEL} /> : null}

      {!kovaDown && panes.length > 0 ? (
        <View style={styles.searchRow}>
          {/* Un faux champ : un tap ouvre la palette Panes (Cmd+P), le clavier s'ouvre là-bas,
              une seule fois. La liste regroupée reste intacte derrière. */}
          <Pressable
            accessibilityRole="search"
            accessibilityLabel={t.sessionsSearchAccessibilityLabel}
            accessibilityHint={t.sessionsSearchHint}
            onPress={() => router.push('/panes')}
            style={({ pressed }) => [styles.search, pressed && styles.searchPressed]}
          >
            <Icon name="search" size={16} color={colors.text.tertiary} />
            <Txt variant="callout" color={colors.text.tertiary}>
              {t.sessionsSearchPlaceholder}
            </Txt>
          </Pressable>
          {summary ? (
            <Txt variant="footnote" color={colors.status.awaiting} numberOfLines={1}>
              {summary}
            </Txt>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!scrollLocked}
        scrollEventThrottle={16}
        onScroll={(e) => {
          offsetY.current = e.nativeEvent.contentOffset.y;
        }}
        onContentSizeChange={(_w, h) => {
          contentHeight.current = h;
        }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + layout.touchPrimary + space[8] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text.secondary} />
        }
      >
        {loading && panes.length === 0 && !kovaDown ? <SkeletonList /> : null}

        {kovaDown ? (
          // État « Kova n'est pas lancé » du design 4.1. Aucun chemin de socket, aucun
          // message technique (CA-62). `Lancer Kova` appelle `POST /v1/kova/launch`.
          <EmptyState title={t.sessionsKovaDownTitle} body={t.sessionsKovaDownBody}>
            <Button
              label={launching ? t.sessionsLaunchingKova : t.sessionsLaunchKova}
              disabled={launching || degraded}
              accessibilityHint={t.sessionsLaunchKovaHint}
              onPress={() => void launchKova()}
            />
            <Button icon="folder" label={t.sessionsBrowseMac} kind="secondary" onPress={() => router.push('/files')} />
          </EmptyState>
        ) : null}

        {!kovaDown && !loading && panes.length === 0 ? (
          <EmptyState title={t.sessionsEmptyTitle} body={t.sessionsEmptyBody} />
        ) : null}

        {!kovaDown && panes.length > 0 && shown.length === 0 ? (
          <EmptyState title={t.sessionsNoMatchTitle} body={t.sessionsNoMatchBody} />
        ) : null}

        {/* Les libellés de fenêtre sont des frères des groupes, pas dedans : ils restent en
            place quand un onglet se déplace, et la géométrie mesurée est celle des groupes. */}
        <DragScrollContext.Provider value={dragScroll}>
          <View style={styles.groups}>
            {shown.map((group, i) => {
              const previous = shown[i - 1];
              const newWindow = windows > 1 && (i === 0 || previous?.window !== group.window);
              return (
                <Fragment key={group.key}>
                  {newWindow ? (
                    <Txt variant="caption" color={colors.text.tertiary} style={styles.windowLabel}>
                      {t.sessionsWindowLabel(group.window + 1)}
                    </Txt>
                  ) : null}
                  <DragItem list={tabDrag} id={group.key}>
                    <TabGroupView
                      group={group}
                      prompts={prompts}
                      aging={aging}
                      onOpen={open}
                      onRelaunch={relaunch}
                      collapsed={tabDragging || (group.tabId !== null && collapsedTabs[group.tabId] === true)}
                      onToggle={() => toggleTab(group)}
                      onAddPane={() => addPane(group)}
                      swipeFor={swipeFor}
                      isUnread={unreadOf}
                      onInterrupt={(id) => void interrupt(id)}
                      interruptDisabled={degraded}
                      interruptLabel={(id) => labelFor(id, degraded)}
                      dragHandle={canDragTab(group, i) ? tabDrag.handlerProps(group.key) : undefined}
                      tabReorder={tabReorderFor(group, i)}
                      dragDisabled={degraded}
                      dragLocked={frozen !== null}
                      onDragLift={freeze}
                      onReorderPane={dropPane(group)}
                    />
                  </DragItem>
                </Fragment>
              );
            })}
          </View>
        </DragScrollContext.Provider>
      </ScrollView>

      {/* Barre d'action basse, zone du pouce (design 4.1) : icônes rondes, sans libellé,
          le nom est porté par l'accessibilité. Panes (Cmd+P), Projects (Cmd+O), New session
          (un projet récent dans un nouvel onglet, avec Claude) et Next (Cmd+J). */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space[3] }]}>
        <RoundButton
          icon="grid"
          label={t.sessionsPanesButton}
          disabled={kovaDown}
          accessibilityHint={t.sessionsPanesHint}
          onPress={() => router.push('/panes')}
        />
        <RoundButton
          icon="folder"
          label={t.sessionsProjectsButton}
          disabled={degraded}
          accessibilityHint={t.sessionsProjectsHint}
          onPress={() => router.push('/new-session')}
        />
        <RoundButton
          icon="plus"
          label={t.sessionsNewSessionButton}
          disabled={degraded}
          accessibilityHint={t.sessionsNewSessionHint}
          onPress={() => router.push('/new-session')}
        />
        <View style={styles.grow} />
        <RoundButton
          icon={next.target ? 'skip-forward' : 'check-circle'}
          kind={next.target?.kind === 'unread' ? 'primary' : 'secondary'}
          disabled={degraded || !next.target}
          badge={next.target?.kind === 'unread' ? next.unreadCount : next.target?.kind === 'idle' ? next.idleCount : undefined}
          badgeTone={next.target?.kind === 'unread' ? 'attention' : 'neutral'}
          label={
            next.target?.kind === 'unread'
              ? `${t.nextUnread} (${next.unreadCount})`
              : next.target?.kind === 'idle'
                ? t.nextIdle
                : t.caughtUp
          }
          accessibilityHint={next.target ? t.nextPillHint(next.target.entry.group.title, next.target.entry.pane.title ?? '') : t.nothingLeftToRead}
          onPress={jumpNext}
        />
      </View>

      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + layout.touchPrimary + space[6] }]}>
          <Txt variant="footnote" color={colors.text.primary}>
            {toast}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  nav: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: layout.screenPaddingH,
  },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: space[2] },
  groups: { gap: space[6] },
  // Le libellé garde 8 pt avec son groupe malgré les 20 pt entre frères.
  windowLabel: { letterSpacing: 0.6, marginTop: space[2], marginBottom: space[3] - space[6] },
  searchRow: { paddingHorizontal: layout.screenPaddingH, paddingVertical: space[3], gap: space[2] },
  search: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.raised,
  },
  searchPressed: { backgroundColor: colors.bg.pressed },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[3],
    backgroundColor: colors.bg.base,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  grow: { flex: 1 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: radius.full,
    backgroundColor: colors.bg.overlay,
  },
});
