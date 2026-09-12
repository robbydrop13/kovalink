// Écran Activité (PRD C7). Lecture seule, 30 jours.
//
// Deux onglets. `Fichiers` répond à la seule question qui compte pour un accès total en
// lecture : qu'est-ce qui est sorti de mon Mac, et qu'est-ce qui y est entré. `Diagnostic`
// répond à la seconde : est-ce que les notifications marchent encore.
//
// Aucun contenu de fichier n'apparaît ici, jamais : le journal porte des chemins, des
// tailles et des motifs, pas des octets.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AuditResponse } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { fetchAudit } from '@/net/files';
import { humanSize, truncateMiddle } from '@/features/files/format';
import { describe } from '@/store/transfers';
import { shortAgeMs } from '@/utils/time';
import { t } from '@/i18n/en';

type Tab = 'files' | 'diagnostic';

const ACTION_LABEL: Record<string, string> = {
  'fs.list': t.activityActionList,
  'fs.read': t.activityActionRead,
  'fs.text': t.activityActionText,
  'fs.quickdests': t.activityActionQuickDests,
  'fs.upload.init': t.activityActionUploadInit,
  'fs.upload.complete': t.activityActionUploadComplete,
  'fs.upload.abort': t.activityActionUploadAbort,
};

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('files');
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Tous les `setState` ont lieu APRÈS l'attente : en poser un dans le corps de l'effet
  // déclencherait un rendu en cascade à chaque montage.
  const load = useCallback(async () => {
    try {
      const res = await fetchAudit();
      setData(res);
      setError(null);
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // L'effet n'appelle rien qui puisse poser un état avant la première attente : il ouvre
  // la requête, et tous les `setState` ont lieu après elle.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchAudit();
        if (!alive) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (alive) setError(describe(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <LinkAction icon="chevron-left" label={t.activityBack} onPress={() => router.back()} />
        <Txt variant="title2" color={colors.text.primary}>
          {t.activityTitle}
        </Txt>
        <View style={styles.grow} />
      </View>

      <View style={styles.tabs}>
        <TabButton label={t.activityTabFiles} active={tab === 'files'} onPress={() => setTab('files')} />
        <TabButton label={t.activityTabDiagnostic} active={tab === 'diagnostic'} onPress={() => setTab('diagnostic')} />
      </View>

      {error ? (
        <Banner tone="error" text={error} actionLabel={t.activityRetry} onAction={() => void load()} />
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.text.secondary}
          />
        }
      >
        {loading ? <SkeletonList count={6} height={56} /> : null}

        {!loading && !error && data && tab === 'files' ? (
          data.files.length === 0 ? (
            <EmptyState
              icon="activity"
              title={t.activityEmptyTitle}
              body={t.activityEmptyBody(data.retentionDays)}
            />
          ) : (
            data.files.map((entry, i) => (
              <View key={`${entry.ts}-${i}`} style={styles.row}>
                <View style={styles.rowHead}>
                  <Txt
                    variant="calloutStrong"
                    color={entry.result === 'denied' ? colors.status.error : colors.text.primary}
                  >
                    {ACTION_LABEL[entry.action] ?? entry.action}
                  </Txt>
                  <View style={styles.grow} />
                  <Txt variant="caption" color={colors.text.tertiary}>
                    {entry.ts.slice(11, 16)} · {entry.ts.slice(0, 10)}
                  </Txt>
                </View>
                {entry.path ? (
                  <Txt variant="monoPath" color={colors.text.secondary} numberOfLines={1}>
                    {truncateMiddle(entry.path, 46)}
                  </Txt>
                ) : null}
                <View style={styles.rowHead}>
                  <Txt variant="caption" color={colors.text.tertiary}>
                    {entry.direction === 'read' ? t.activityDirectionRead : entry.direction === 'write' ? t.activityDirectionWrite : '·'}
                    {entry.bytes !== null ? ` · ${humanSize(entry.bytes)}` : ''}
                  </Txt>
                  <View style={styles.grow} />
                  {/* Le motif du refus, tel que le daemon l'a formulé : la règle de liste
                      noire déclenchée, pas un « refusé » muet. */}
                  {entry.result !== 'ok' ? (
                    <Txt variant="caption" color={colors.status.error}>
                      {entry.result === 'denied' ? t.activityResultDenied : t.activityResultError}
                      {entry.detail ? ` · ${entry.detail}` : ''}
                    </Txt>
                  ) : null}
                </View>
              </View>
            ))
          )
        ) : null}

        {!loading && !error && data && tab === 'diagnostic' ? (
          <View style={styles.diag}>
            <DiagRow label={t.activityDiagParseFailed} value={String(data.diagnostic.parseFailed)} />
            <DiagRow label={t.activityDiagNseFailed} value={String(data.diagnostic.nseFailed)} />
            <DiagRow
              label={t.activityDiagLastNotification}
              value={
                data.diagnostic.lastNotificationAgeMs === null
                  ? t.activityDiagNone
                  : t.activityDiagAgo(shortAgeMs(data.diagnostic.lastNotificationAgeMs))
              }
            />
            <DiagRow label={t.activityDiagNotificationsToday} value={String(data.diagnostic.notificationsToday)} />
            <DiagRow label={t.activityDiagReadToday} value={humanSize(data.diagnostic.bytesReadToday)} />
            <DiagRow label={t.activityDiagWrittenToday} value={humanSize(data.diagnostic.bytesWrittenToday)} />
            <Button label={t.activityRefresh} kind="secondary" onPress={() => void load()} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Txt variant="calloutStrong" color={active ? colors.text.primary : colors.text.tertiary}>
        {label}
      </Txt>
    </Pressable>
  );
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.diagRow}>
      <Txt variant="footnote" color={colors.text.secondary} style={styles.grow}>
        {label}
      </Txt>
      <Txt variant="monoPath" color={colors.text.primary}>
        {value}
      </Txt>
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
  grow: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    gap: space[2],
    padding: space[2],
    marginHorizontal: layout.screenPaddingH,
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
  },
  tab: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.bg.overlay },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: space[4], gap: space[3] },
  row: { gap: space[2], padding: space[4], borderRadius: radius.md, backgroundColor: colors.bg.raised },
  rowHead: { flexDirection: 'row', alignItems: 'center' },
  diag: { gap: space[3] },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
  },
});
