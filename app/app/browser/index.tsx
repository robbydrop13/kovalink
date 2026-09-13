// Navigateur : les onglets de Mira, le navigateur du Mac, toutes fenêtres confondues.
//
// Quand un agent bute sur un flux web (connexion, consentement OAuth, captcha, un bouton
// à cliquer), Robin choisit l'onglet ici puis termine le geste depuis le miroir. L'écran
// ne dépend pas de Kova : il parle à la socket de Mira via le daemon, et Mira absent est
// un état affiché, pas une erreur.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MiraTab } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { Icon } from '@/ui/Icon';
import { hostOf } from '@/features/browser/geometry';
import { unlockMirror } from '@/features/browser/unlock';
import { fetchMiraTabs } from '@/net/http';
import { describe } from '@/store/transfers';

export default function BrowserTabsScreen() {
  const insets = useSafeAreaInsets();
  const [tabs, setTabs] = useState<MiraTab[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchMiraTabs();
      setAvailable(res.available);
      setTabs(res.tabs);
      setError(null);
    } catch (e) {
      setError(describe(e));
      setTabs((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  /** Face ID avant le miroir : l'écran expose le navigateur connecté de Robin. */
  const open = (tab: MiraTab): void => {
    void (async () => {
      if (!(await unlockMirror())) return;
      router.push({ pathname: '/browser/[tabId]', params: { tabId: tab.id } });
    })();
  };

  const loading = tabs === null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <LinkAction icon="chevron-left" label={t.browserBack} onPress={() => router.back()} />
        <Txt variant="title2" color={colors.text.primary} numberOfLines={1}>
          {t.browserTitle}
        </Txt>
        <View style={styles.grow} />
      </View>

      {error ? <Banner tone="error" text={error} actionLabel={t.actionRetry} onAction={() => void load()} /> : null}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.text.secondary} />}
      >
        {loading ? <SkeletonList count={6} height={60} /> : null}

        {!loading && !available ? (
          <EmptyState icon="globe" title={t.browserUnavailable} body={t.browserUnavailableBody}>
            <Button label={t.actionRetry} onPress={() => void load()} />
          </EmptyState>
        ) : null}

        {!loading && available && tabs.length === 0 ? (
          <EmptyState icon="globe" title={t.browserTabsEmpty} body={t.browserTabsEmptyBody} />
        ) : null}

        {!loading && available ? tabs.map((tab) => <TabRow key={tab.id} tab={tab} onPress={() => open(tab)} />) : null}
      </ScrollView>
    </View>
  );
}

function TabRow({ tab, onPress }: { tab: MiraTab; onPress: () => void }) {
  const host = hostOf(tab.url);
  const title = tab.title || host || tab.url;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.browserTabA11y(title, host)}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {/* Point d'activité : l'onglet visible de sa fenêtre, ou un onglet endormi. */}
      <View
        style={[
          styles.dot,
          { backgroundColor: tab.active ? colors.status.success : tab.asleep ? colors.status.closed : colors.bg.pressed },
        ]}
      />
      <View style={styles.body}>
        <Txt variant="body" color={tab.asleep ? colors.text.secondary : colors.text.primary} numberOfLines={1}>
          {title}
        </Txt>
        <Txt variant="caption" color={colors.text.tertiary} numberOfLines={1}>
          {host}
          {tab.active ? ` · ${t.browserTabActive}` : tab.asleep ? ` · ${t.browserTabAsleep}` : ''}
        </Txt>
      </View>
      <Icon name="chevron-right" size={16} color={colors.text.tertiary} />
    </Pressable>
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
  grow: { flex: 1 },
  content: { paddingHorizontal: space[2], paddingTop: space[2] },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: space[1] },
});
