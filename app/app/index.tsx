// Écran Sessions. Il répond à une seule question : qu'est-ce qui m'attend ?
//
// Aucun bouton d'approbation ici (A7, P3). `Interrompre` en revanche est disponible sur la
// carte EN ATTENTE comme sur la ligne TRAVAILLE : c'est le geste sûr, on le rend le plus
// facile possible, et le scénario S3 décrit un pane qui travaille.
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { LinkPill } from '@/ui/LinkPill';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { AwaitingCard } from '@/features/sessions/AwaitingCard';
import { SectionHeader, SessionRow } from '@/features/sessions/SessionRow';
import { useInterrupt } from '@/features/sessions/useInterrupt';
import { showPaneMenu } from '@/features/sessions/openOnMac';
import { isDegraded, useConnection } from '@/store/connection';
import { sectionize, usePanes } from '@/store/panes';
import { isAging, usePrompts } from '@/store/prompts';
import { forceReconnect } from '@/net/connection';
import { fetchPanes, postKovaLaunch } from '@/net/http';
import { clockTime } from '@/utils/time';
import { retryBoot, useBootError, useBootState } from '@/boot';
import { PUSH_UNAVAILABLE_LABEL, pushAvailable } from '@/env';
import { ErrorScreen } from '@/ui/ErrorScreen';

export default function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const boot = useBootState();
  const bootError = useBootError();
  const panes = usePanes((s) => s.panes);
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

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const snapshot = await fetchPanes();
      applySnapshot(snapshot);
    } catch {
      forceReconnect();
    } finally {
      setRefreshing(false);
    }
  }, [applySnapshot]);

  // Kova quitté (CA-123) : le daemon a vidé sa liste et l'a annoncé. Ce qui resterait en
  // cache serait des panes fantômes, on ne les montre pas.
  const kovaDown = kova === 'down';
  const { awaiting, working, idle } = sectionize(kovaDown ? [] : panes);
  const open = (paneId: number) => router.push(`/session/${paneId}`);
  const menu = (paneId: number) => showPaneMenu(paneId, setToast);

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

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
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

        {awaiting.length > 0 ? (
          <>
            <SectionHeader label="EN ATTENTE" count={awaiting.length} />
            <View style={styles.stack}>
              {awaiting.map((pane) => (
                <AwaitingCard
                  key={pane.id}
                  pane={pane}
                  prompt={prompts[pane.id]}
                  aging={isAging(prompts[pane.id])}
                  onOpen={() => open(pane.id)}
                  onLongPress={() => menu(pane.id)}
                  interruptDisabled={degraded}
                  interruptLabel={labelFor(pane.id, degraded)}
                  onInterrupt={() => void interrupt(pane.id)}
                />
              ))}
            </View>
          </>
        ) : null}

        {working.length > 0 ? (
          <>
            <SectionHeader label="TRAVAILLE" count={working.length} />
            <View style={styles.stack}>
              {working.map((pane) => (
                <SessionRow
                  key={pane.id}
                  pane={pane}
                  subtitle={pane.cwd}
                  onOpen={() => open(pane.id)}
                  onLongPress={() => menu(pane.id)}
                  interruptDisabled={degraded}
                  interruptLabel={labelFor(pane.id, degraded)}
                  onInterrupt={() => void interrupt(pane.id)}
                />
              ))}
            </View>
          </>
        ) : null}

        {idle.length > 0 ? (
          <>
            <SectionHeader label="INACTIF" count={idle.length} />
            <View style={styles.stack}>
              {idle.map((pane) => (
                <SessionRow
                  key={pane.id}
                  pane={pane}
                  onOpen={() => open(pane.id)}
                  onLongPress={() => menu(pane.id)}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + space[6] }]}>
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
  content: { paddingHorizontal: layout.screenPaddingH },
  stack: { gap: space[4] },
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
