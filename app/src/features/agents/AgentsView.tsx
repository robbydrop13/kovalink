// Onglet Agents (P06) : la vue du prototype, quatre comptes en tete, puis la liste du
// compte selectionne, les panes par onglet de Kova et le trombinoscope de `team`.
//
// Les comptes des panes viennent de l'instantane pousse par le daemon ; la tuile
// « Need you » vient du compte `waitsOnYou` (permissions comprises), avec les questions
// dues en repli quand le daemon est plus ancien. Le trombinoscope est une lecture de
// `team list --json` sur le Mac : il se relit a l'ouverture et chaque minute, et un seul
// geste y est possible, rouvrir une session fermee, toujours confirme.
import { useMemo, useState, type ReactNode } from 'react';
import {
  ActionSheetIOS,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Pane } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Banner, SkeletonList } from '@/ui/States';
import { Txt, interFamily } from '@/ui/Txt';
import { TAB_BAR_HEIGHT } from '@/features/home/TabBar';
import { paneHref, paneLabel } from '@/features/sessions/SessionRow';
import { tabTint } from '@/features/sessions/TabGroupView';
import { dueAsks, useAsks } from '@/store/asks';
import { usePanes } from '@/store/panes';
import { useClock } from '@/utils/useClock';
import { shortAgeMs } from '@/utils/time';
import { ImpactStyle, impact } from '@/utils/haptics';
import { HttpError, postAgentReopen } from '@/net/http';
import { t } from '@/i18n/en';
import {
  rosterRows,
  splitPanes,
  tabCounts,
  tabNameFor,
  workingFirst,
  type AgentFilter,
  type RosterRow,
} from './agents';
import { useRoster } from './useRoster';

/** Rayon des cartes de l'accueil (proto : 12). */
const CARD_RADIUS = 12;

/** Largeur d'une colonne de « By tab », en pt. Aligne les chiffres et la legende. */
const COUNT_COL = 28;

const FILTER_LABEL: Record<AgentFilter, string> = {
  working: t.agentsWorking,
  needYou: t.agentsNeedYou,
  idle: t.agentsIdle,
  error: t.agentsError,
};

const FILTER_DOT: Record<AgentFilter, string> = {
  working: colors.status.working,
  needYou: colors.status.awaiting,
  idle: colors.status.idle,
  error: colors.status.error,
};

const FILTER_TITLE: Record<AgentFilter, string> = {
  working: t.agentsWorkingNow,
  needYou: t.agentsNeedYou,
  idle: t.agentsIdle,
  error: t.agentsError,
};

function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Txt variant="footnote" color={colors.text.secondary} style={styles.sectionTitle}>
        {title}
      </Txt>
      {meta !== undefined ? (
        <Txt variant="caption" color={colors.text.tertiary}>
          {meta}
        </Txt>
      ) : null}
    </View>
  );
}

interface RowData {
  key: string;
  title: string;
  subtitle?: string | undefined;
  meta?: string | undefined;
  metaColor?: string | undefined;
  dot: string;
  onPress: () => void;
}

/** Une ligne de 52 pt, dans une carte : titre, sous-titre, puis un mot a droite. */
function Row({ row, last }: { row: RowData; last: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.subtitle ? `${row.title}, ${row.subtitle}` : row.title}
      accessibilityHint={t.agentsRowHint}
      onPress={row.onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && styles.rowPressed]}
    >
      <View style={[styles.rowDot, { backgroundColor: row.dot }]} />
      <View style={styles.rowText}>
        <Txt variant="callout" color={colors.text.primary} numberOfLines={1} style={styles.rowTitle}>
          {row.title}
        </Txt>
        {row.subtitle && row.subtitle.length > 0 ? (
          <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={2}>
            {row.subtitle}
          </Txt>
        ) : null}
      </View>
      {row.meta && row.meta.length > 0 ? (
        <Txt variant="caption" color={row.metaColor ?? colors.text.tertiary} style={styles.rowMeta}>
          {row.meta}
        </Txt>
      ) : null}
    </Pressable>
  );
}

function ListCard({ rows }: { rows: RowData[] }) {
  return (
    <View style={styles.card}>
      {rows.length === 0 ? (
        <View style={styles.row}>
          <Txt variant="footnote" color={colors.text.tertiary}>
            {t.agentsEmpty}
          </Txt>
        </View>
      ) : (
        rows.map((row, index) => <Row key={row.key} row={row} last={index === rows.length - 1} />)
      )}
    </View>
  );
}

/** Le petit bouton d'une session fermee : 28 pt, il ne prend pas la ligne entiere. */
function OpenPill({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.agentsOpen}
      accessibilityHint={t.agentsOpenHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        impact(ImpactStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed, disabled && styles.pillDisabled]}
    >
      <Txt variant="caption" color={disabled ? colors.text.disabled : colors.text.primary} style={styles.pillLabel}>
        {t.agentsOpen}
      </Txt>
    </Pressable>
  );
}

function RosterCard({
  rows,
  pending,
  onOpen,
  onReopen,
}: {
  rows: RosterRow[];
  pending: string | null;
  onOpen: (pane: Pane) => void;
  onReopen: (row: RosterRow) => void;
}) {
  return (
    <View style={styles.card}>
      {rows.length === 0 ? (
        <View style={styles.row}>
          <Txt variant="footnote" color={colors.text.tertiary}>
            {t.agentsEmpty}
          </Txt>
        </View>
      ) : (
        rows.map((row, index) => {
          const role = row.entry.role;
          const line = row.open ? role : [role, t.agentsNotOpen].filter((part) => part.length > 0).join(' · ');
          const dotColor =
            row.entry.state === 'working'
              ? colors.status.working
              : row.open
                ? colors.status.success
                : colors.status.closed;
          const last = index === rows.length - 1;
          const pane = row.pane;
          const body = (
            <>
              <View style={[styles.rowDot, { backgroundColor: dotColor }, !row.open && styles.dotDimmed]} />
              <View style={styles.rowText}>
                <Txt variant="callout" color={colors.text.primary} numberOfLines={1} style={styles.rowTitle}>
                  {row.entry.name}
                </Txt>
                <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1}>
                  {line}
                </Txt>
              </View>
            </>
          );
          return row.open && pane !== null ? (
            <Pressable
              key={row.entry.name}
              accessibilityRole="button"
              accessibilityLabel={`${row.entry.name}, ${line}`}
              accessibilityHint={t.agentsRowHint}
              onPress={() => onOpen(pane)}
              style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && styles.rowPressed]}
            >
              {body}
            </Pressable>
          ) : (
            <View key={row.entry.name} style={[styles.row, !last && styles.rowBorder]}>
              {body}
              {row.open ? null : (
                <OpenPill disabled={pending !== null} onPress={() => onReopen(row)} />
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

function LegendDot({ color, ring = false }: { color: string; ring?: boolean }) {
  return (
    <View style={styles.legendCol}>
      <View
        style={[
          styles.legendDot,
          ring ? { borderWidth: 1.5, borderColor: colors.text.tertiary } : { backgroundColor: color },
        ]}
      />
    </View>
  );
}

export function AgentsView() {
  const insets = useSafeAreaInsets();
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const since = usePanes((s) => s.workingSince);
  const asks = useAsks((s) => s.asks);
  const waitsOnYou = useAsks((s) => s.waitsOnYou);
  const { roster, error, refreshing, refresh, reload } = useRoster();
  const [filter, setFilter] = useState<AgentFilter>('working');
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const now = useClock(true, 30_000);

  const due = useMemo(() => dueAsks(asks), [asks]);
  const split = useMemo(() => splitPanes(panes), [panes]);
  const tabTable = useMemo(() => tabCounts(panes, tabs), [panes, tabs]);
  const working = useMemo(() => workingFirst(split.working, since), [split, since]);
  const team = useMemo(() => (roster === null ? null : rosterRows(roster.managers, panes)), [roster, panes]);
  const dedicated = useMemo(() => (roster === null ? null : rosterRows(roster.dedicated, panes)), [roster, panes]);

  const counts: Record<AgentFilter, number> = {
    working: split.working.length,
    needYou: waitsOnYou ?? due.length,
    idle: split.idle.length,
    error: split.error.length,
  };

  const paneRow = (pane: Pane, kind: AgentFilter): RowData => {
    if (kind === 'error' && pane.error) {
      return {
        key: String(pane.id),
        title: paneLabel(pane),
        subtitle: pane.error.text,
        meta: pane.error.kind,
        metaColor: colors.status.error,
        dot: FILTER_DOT.error,
        onPress: () => router.push(paneHref(pane)),
      };
    }
    const tab = tabNameFor(pane, tabs);
    const started = kind === 'working' ? since[pane.id] : undefined;
    return {
      key: String(pane.id),
      title: paneLabel(pane),
      subtitle: [tab, pane.projectName].filter((part) => part.length > 0).join(' · '),
      meta: started === undefined ? undefined : shortAgeMs(now - started),
      dot: FILTER_DOT[kind],
      onPress: () => router.push(paneHref(pane)),
    };
  };

  const rows: RowData[] =
    filter === 'needYou'
      ? due.map((ask) => ({
          key: ask.id,
          title: ask.from,
          subtitle: ask.message,
          meta: shortAgeMs(now - ask.askedAtMs),
          metaColor: colors.status.awaiting,
          dot: FILTER_DOT.needYou,
          onPress: () => router.push(`/ask/${ask.id}`),
        }))
      : (filter === 'working' ? working : filter === 'idle' ? split.idle : split.error).map((pane) =>
          paneRow(pane, filter),
        );

  const reopen = async (name: string): Promise<void> => {
    setPending(name);
    setNotice(null);
    try {
      const res = await postAgentReopen(name);
      if (!res.applied) {
        setNotice(t.agentsOpenFailed(res.reason ?? 'team_failed'));
      } else {
        impact(ImpactStyle.Medium);
        await reload();
      }
    } catch (e) {
      // `busy` : une reouverture tourne deja pour ce nom, ce n'est pas une panne du Mac.
      if (e instanceof HttpError && e.code === 'AGENT_BUSY') setNotice(t.agentsBusy);
      else setNotice(t.agentsOpenFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setPending(null);
    }
  };

  const confirmReopen = (row: RosterRow): void => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t.agentsOpenConfirm(row.entry.name),
        options: [t.agentsOpen, t.actionCancel],
        cancelButtonIndex: 1,
        userInterfaceStyle: 'dark',
      },
      (index) => {
        if (index === 0) void reopen(row.entry.name);
      },
    );
  };

  const rosterSection = (rowsFor: RosterRow[] | null): ReactNode =>
    rowsFor === null ? (
      <SkeletonList count={2} height={52} />
    ) : (
      <RosterCard
        rows={rowsFor}
        pending={pending}
        onOpen={(pane) => router.push(paneHref(pane))}
        onReopen={confirmReopen}
      />
    );

  return (
    <View style={styles.screen}>
      {notice !== null ? <Banner tone="error" text={notice} /> : null}
      {error !== null ? (
        <Banner tone="error" text={error} actionLabel={t.actionRetry} onAction={() => void reload()} />
      ) : null}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + space[8] },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.text.secondary}
          />
        }
      >
        <Txt variant="footnote" color={colors.text.tertiary} style={styles.subtitle}>
          {t.agentsSessions(panes.length, tabTable.length)}
        </Txt>

        <View style={styles.statGrid}>
          {(Object.keys(FILTER_LABEL) as AgentFilter[]).map((key) => {
            const selected = filter === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${FILTER_LABEL[key]}, ${counts[key]}`}
                onPress={() => {
                  impact(ImpactStyle.Light);
                  setFilter(key);
                }}
                style={({ pressed }) => [
                  styles.stat,
                  selected && styles.statSelected,
                  pressed && styles.statPressed,
                ]}
              >
                <Txt variant="display" color={colors.text.primary} style={styles.statValue}>
                  {counts[key]}
                </Txt>
                <View style={styles.statLabel}>
                  <View style={[styles.statDot, { backgroundColor: FILTER_DOT[key] }]} />
                  <Txt variant="footnote" color={colors.text.tertiary}>
                    {FILTER_LABEL[key]}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.section}>
          <SectionHeader
            title={FILTER_TITLE[filter]}
            {...(filter === 'working' ? { meta: t.agentsLongestFirst } : {})}
          />
          <ListCard rows={rows} />
        </View>

        <View style={styles.section}>
          <SectionHeader title={t.agentsByTab} />
          <View style={styles.card}>
            <View style={styles.tabHeader}>
              <View style={styles.tabName} />
              <LegendDot color={FILTER_DOT.needYou} />
              <LegendDot color={FILTER_DOT.working} />
              <LegendDot color={FILTER_DOT.error} />
              <LegendDot color={FILTER_DOT.idle} ring />
            </View>
            {tabTable.length === 0 ? (
              <View style={styles.tabRow}>
                <Txt variant="footnote" color={colors.text.tertiary}>
                  {t.agentsEmpty}
                </Txt>
              </View>
            ) : null}
            {tabTable.map((tab) => (
              <View key={tab.key} style={styles.tabRow}>
                <View style={[styles.tabDot, { backgroundColor: tabTint(tab.color) }]} />
                <Txt variant="footnote" color={colors.text.secondary} numberOfLines={1} style={styles.tabName}>
                  {tab.title}
                </Txt>
                {[tab.counts.needYou, tab.counts.working, tab.counts.error, tab.counts.idle].map(
                  (value, index) => (
                    <Txt key={index} variant="caption" color={colors.text.secondary} style={styles.countCol}>
                      {value > 0 ? String(value) : ''}
                    </Txt>
                  ),
                )}
              </View>
            ))}
          </View>
        </View>

        {roster === null && error !== null ? null : (
          <>
            <View style={styles.section}>
              <SectionHeader title={t.agentsTeam} />
              {rosterSection(team)}
            </View>
            <View style={styles.section}>
              <SectionHeader title={t.agentsDedicated} />
              {rosterSection(dedicated)}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: space[1], gap: space[6] },
  subtitle: { paddingHorizontal: space[1] },
  section: { gap: space[3] },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[1],
  },
  sectionTitle: { fontFamily: interFamily('600') },
  card: {
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[1],
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  rowPressed: { backgroundColor: colors.bg.pressed },
  rowText: { flex: 1, gap: space[1] },
  // Inter Medium n'est pas synthetisee sur iOS : la famille porte la graisse.
  rowTitle: { fontFamily: interFamily('500') },
  rowDot: { width: 8, height: 8, borderRadius: radius.full },
  dotDimmed: { opacity: 0.4 },
  rowMeta: { fontVariant: ['tabular-nums'] },
  pill: {
    height: 28,
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.bg.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPressed: { backgroundColor: colors.bg.pressed },
  pillDisabled: { opacity: 0.5 },
  pillLabel: { fontFamily: interFamily('500') },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  stat: {
    flexGrow: 1,
    flexBasis: '42%',
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: CARD_RADIUS,
    padding: space[4],
    gap: space[2],
  },
  statSelected: { borderColor: colors.border.focus },
  statPressed: { backgroundColor: colors.bg.pressed },
  statValue: { fontVariant: ['tabular-nums'] },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  statDot: { width: 6, height: 6, borderRadius: radius.full },
  tabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[5],
    paddingTop: space[2],
    paddingBottom: space[1],
  },
  legendCol: { width: COUNT_COL, alignItems: 'center' },
  legendDot: { width: 6, height: 6, borderRadius: radius.full },
  tabRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[5],
  },
  tabDot: { width: 8, height: 8, borderRadius: radius.full },
  tabName: { flex: 1, marginRight: space[2] },
  countCol: { width: COUNT_COL, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
