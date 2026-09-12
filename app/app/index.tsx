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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Pane } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { LinkPill } from '@/ui/LinkPill';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { TabGroupView } from '@/features/sessions/TabGroupView';
import { paneHref } from '@/features/sessions/SessionRow';
import { confirmClose, promptRename, toggleBookmark } from '@/features/sessions/paneActions';
import type { SwipeActions } from '@/features/sessions/SwipeRow';
import { filterGroups, groupByTab, summaryLine, windowCount, type TabGroup } from '@/features/sessions/tabGroups';
import { useInterrupt } from '@/features/sessions/useInterrupt';
import { isDegraded, useConnection } from '@/store/connection';
import { usePanes } from '@/store/panes';
import { isAging, usePrompts } from '@/store/prompts';
import { forceReconnect } from '@/net/connection';
import { fetchPanes, fetchSessions, postKovaLaunch } from '@/net/http';
import { clockTime } from '@/utils/time';
import { retryBoot, useBootError, useBootState } from '@/boot';
import { PUSH_UNAVAILABLE_LABEL, pushAvailable } from '@/env';
import { ErrorScreen } from '@/ui/ErrorScreen';

export default function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const boot = useBootState();
  const bootError = useBootError();
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const loading = usePanes((s) => s.loading);
  const fetchedAt = usePanes((s) => s.fetchedAt);
  const applySnapshot = usePanes((s) => s.applySnapshot);
  const prompts = usePrompts((s) => s.byPane);
  const link = useConnection((s) => s.link);
  const kova = useConnection((s) => s.kova);
  const lastError = useConnection((s) => s.lastError);
  const degraded = isDegraded(link);
  const { run: interrupt, labelFor } = useInterrupt();
  const [refreshing, setRefreshing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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
      loadBookmarks();
    } catch {
      forceReconnect();
    } finally {
      setRefreshing(false);
    }
  }, [applySnapshot, loadBookmarks]);

  // Kova quitté (CA-123) : le daemon a vidé sa liste et l'a annoncé. Ce qui resterait en
  // cache serait des panes fantômes, on ne les montre pas.
  const kovaDown = kova === 'down';
  const groups = useMemo(() => groupByTab(kovaDown ? [] : panes, tabs), [kovaDown, panes, tabs]);
  const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
  const windows = windowCount(shown);
  const summary = kovaDown ? null : summaryLine(panes);
  // Un pane sans agent s'ouvre sur la vue Term ; une session périmée propose de relancer
  // Claude dans son dossier via la feuille « Nouvelle session », préfiltrée.
  const open = (paneId: number) => {
    const pane = panes.find((p) => p.id === paneId);
    router.push(pane ? paneHref(pane) : `/session/${paneId}`);
  };
  const relaunch = (pane: Pane) =>
    router.push({ pathname: '/new-session', params: { cwd: pane.cwd } });
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
      onRename: () => promptRename(pane, group.tabId === null ? null : group.title, setToast, () => void refresh()),
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
      setToast(res.alreadyUp ? 'Kova tournait déjà, mis au premier plan' : 'Kova se lance sur le Mac');
    } catch (e) {
      setToast(`Lancement impossible. ${e instanceof Error ? e.message : String(e)}`);
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
        title="Démarrage impossible"
        error={bootError}
        hint="Le stockage local n'a pas répondu. Réessaie, puis relance l'app si l'erreur persiste."
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
          Sessions
        </Txt>
        <View style={styles.grow} />
        <LinkPill onPress={() => router.push('/settings')} />
        {/* Le bloc C ne dépend pas de Kova : l'accès aux fichiers reste offert même quand
            la liste des sessions est vide parce que Kova est quitté (CA-123). */}
        <LinkAction label="Fichiers" onPress={() => router.push('/files')} />
        <LinkAction label="Réglages" onPress={() => router.push('/settings')} />
      </View>

      {degraded ? (
        <Banner
          tone={link === 'offline' ? 'offline' : 'warn'}
          text={
            link === 'offline'
              ? `iPhone hors ligne, dernier état à ${clockTime(fetchedAt)}`
              : `Mac endormi ou éteint, dernier état à ${clockTime(fetchedAt)}`
          }
          actionLabel="Réessayer"
          onAction={forceReconnect}
        />
      ) : null}

      {!degraded && lastError ? (
        <Banner tone="error" text={lastError} actionLabel="Réessayer" onAction={forceReconnect} />
      ) : null}

      {/* Bandeau discret et non bloquant : tout le reste de l'app fonctionne normalement. */}
      {!pushAvailable ? <Banner text={PUSH_UNAVAILABLE_LABEL} /> : null}

      {!kovaDown && panes.length > 0 ? (
        <View style={styles.searchRow}>
          <TextInput
            style={styles.search}
            placeholder="Onglet, projet ou titre de pane"
            placeholderTextColor={colors.text.tertiary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            keyboardAppearance="dark"
            accessibilityLabel="Rechercher une session"
          />
          {summary ? (
            <Txt variant="footnote" color={colors.status.awaiting} numberOfLines={1}>
              {summary}
            </Txt>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + layout.touchPrimary + space[8] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text.secondary} />
        }
      >
        {loading && panes.length === 0 && !kovaDown ? <SkeletonList /> : null}

        {kovaDown ? (
          // État « Kova n'est pas lancé » du design 4.1. Aucun chemin de socket, aucun
          // message technique (CA-62). `Lancer Kova` appelle `POST /v1/kova/launch`.
          <EmptyState title="Kova n’est pas lancé" body="Les fichiers du Mac restent accessibles.">
            <Button
              label={launching ? 'Lancement…' : 'Lancer Kova'}
              disabled={launching || degraded}
              accessibilityHint="Ouvre l’application Kova sur le Mac"
              onPress={() => void launchKova()}
            />
            <Button label="Parcourir le Mac" kind="secondary" onPress={() => router.push('/files')} />
          </EmptyState>
        ) : null}

        {!kovaDown && !loading && panes.length === 0 ? (
          <EmptyState
            title="Aucune session"
            body="Ouvre un pane dans Kova, il apparaîtra ici."
          />
        ) : null}

        {!kovaDown && panes.length > 0 && shown.length === 0 ? (
          <EmptyState title="Aucune session ne correspond" body="Essaie un autre mot : nom d’onglet, projet, titre de pane." />
        ) : null}

        <View style={styles.groups}>
          {shown.map((group, i) => {
            const previous = shown[i - 1];
            const newWindow = windows > 1 && (i === 0 || previous?.window !== group.window);
            return (
              <View key={group.key} style={styles.groupSlot}>
                {newWindow ? (
                  <Txt variant="caption" color={colors.text.tertiary} style={styles.windowLabel}>
                    FENÊTRE {group.window + 1}
                  </Txt>
                ) : null}
                <TabGroupView
                  group={group}
                  prompts={prompts}
                  aging={aging}
                  onOpen={open}
                  onRelaunch={relaunch}
                  onHeaderPress={() => router.push('/panes')}
                  swipeFor={swipeFor}
                  onInterrupt={(id) => void interrupt(id)}
                  interruptDisabled={degraded}
                  interruptLabel={(id) => labelFor(id, degraded)}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Barre d'action basse, zone du pouce (design 4.1) : les deux palettes de Kova,
          Cmd+P (tous les panes) et Cmd+O (projets récents, nouvelle session). La barre du
          haut est pleine (titre, pastille, Fichiers, Réglages) : ici, deux boutons larges. */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space[3] }]}>
        <View style={styles.bottomButton}>
          <Button
            label="Panes"
            kind="secondary"
            height={layout.touchPrimary}
            disabled={kovaDown}
            accessibilityHint="Palette de tous les panes, comme Cmd+P dans Kova"
            onPress={() => router.push('/panes')}
          />
        </View>
        <View style={styles.bottomButton}>
          <Button
            label="Projets"
            kind="secondary"
            height={layout.touchPrimary}
            disabled={degraded}
            accessibilityHint="Palette des projets récents, comme Cmd+O dans Kova"
            onPress={() => router.push('/new-session')}
          />
        </View>
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
  groupSlot: { gap: space[3] },
  windowLabel: { letterSpacing: 0.6, marginTop: space[2] },
  searchRow: { paddingHorizontal: layout.screenPaddingH, paddingVertical: space[3], gap: space[2] },
  search: {
    height: 36,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.raised,
    color: colors.text.primary,
    fontSize: 15,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: space[4],
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[3],
    backgroundColor: colors.bg.base,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  bottomButton: { flex: 1 },
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
