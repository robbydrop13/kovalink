// Journal d'une routine locale (P07). Les 200 dernières lignes, en Menlo 12, ouvertes sur
// la fin : c'est là que se trouve la cause d'un échec. Le bouton Reload relit le Mac ;
// quitter la feuille ne touche à rien.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, space } from '@/theme';
import { RoundButton } from '@/ui/Button';
import { ErrorScreen } from '@/ui/ErrorScreen';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { fetchRoutineLog } from '@/net/http';
import { t } from '@/i18n/en';

const CARD_RADIUS = 12;

export default function RoutineLogScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ name: string }>();
  const name = String(params.name ?? '');
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    let alive = true;
    void fetchRoutineLog(name).then(
      (res) => {
        if (!alive) return;
        setLines(res.lines);
        setError(null);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [name]);

  const reload = useCallback(() => {
    setLoading(true);
    return fetchRoutineLog(name).then(
      (res) => {
        setLines(res.lines);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
  }, [name]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[3] }]}>
      <View style={styles.header}>
        <Txt variant="title2" color={colors.text.primary} numberOfLines={1} style={styles.title}>
          {name}
        </Txt>
        <View style={styles.grow} />
        <RoundButton
          icon="refresh-cw"
          size={32}
          label={t.scheduledLogReload}
          disabled={loading}
          onPress={() => void reload()}
        />
        <RoundButton icon="x" size={32} label={t.actionClose} onPress={() => router.back()} />
      </View>

      {lines === null ? (
        error !== null ? (
          <ErrorScreen title={t.scheduledLogUnavailable} error={error} onRetry={() => void reload()} />
        ) : (
          <View style={styles.loading}>
            <SkeletonList count={5} height={40} />
          </View>
        )
      ) : lines.length === 0 ? (
        <EmptyState title={t.scheduledLogEmpty} />
      ) : (
        <>
          {error !== null ? (
            <Banner tone="error" text={error} actionLabel={t.actionRetry} onAction={() => void reload()} />
          ) : null}
          <ScrollView
            ref={scroll}
            style={[styles.log, { marginBottom: insets.bottom + space[6] }]}
            contentContainerStyle={styles.logContent}
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Txt variant="monoTerminal" color={colors.text.secondary} selectable>
                {lines.join('\n')}
              </Txt>
            </ScrollView>
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: space[3],
  },
  title: { flexShrink: 1 },
  grow: { flex: 1 },
  loading: { flex: 1, paddingTop: space[4] },
  log: {
    flex: 1,
    marginHorizontal: layout.screenPaddingH,
    marginTop: space[2],
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  logContent: { padding: space[4] },
});
