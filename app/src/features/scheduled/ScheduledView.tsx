// Onglet Scheduled (P07) : les routines locales, groupées comme sur le Mac. Chaque section
// est une carte du design system (fond bg1, bord b3, rayon 12) et chaque routine une ligne
// de 52 pt : nom, horaire et prochaine échéance, point d'état à droite. Un tap déplie la
// ligne : description, prochaine échéance, dernier passage et trois gestes.
//
// Pas d'édition du prompt ni de suppression ici : ces deux gestes restent sur le Mac
// (décision de Robin). Lancer et suspendre demandent une confirmation, jamais la reprise.
import { useState } from 'react';
import { ActionSheetIOS, LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Routine } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Button } from '@/ui/Button';
import { ErrorScreen } from '@/ui/ErrorScreen';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt, interFamily } from '@/ui/Txt';
import { TAB_BAR_HEIGHT } from '@/features/home/TabBar';
import { postRoutinePause, postRoutineResume, postRoutineRun } from '@/net/http';
import { ImpactStyle, impact } from '@/utils/haptics';
import { useClock } from '@/utils/useClock';
import { t } from '@/i18n/en';
import {
  groupRoutines,
  inWords,
  lastRunOf,
  lastWords,
  nextWords,
  statusOf,
  type RoutineSectionKey,
  type RoutineStatusKind,
} from './group';
import { useRoutines } from './useRoutines';

/** Rayon des cartes de l'accueil (proto : 12). */
const CARD_RADIUS = 12;

const SECTION_TITLE: Record<RoutineSectionKey, string> = {
  attention: t.scheduledSectionAttention,
  today: t.scheduledSectionToday,
  week: t.scheduledSectionWeek,
  later: t.scheduledSectionLater,
  off: t.scheduledSectionOff,
};

const STATUS_COLOR: Record<RoutineStatusKind, string> = {
  ok: colors.status.success,
  failed: colors.status.error,
  running: colors.status.working,
  never: colors.text.tertiary,
};

type Action = 'run' | 'pause' | 'resume';

/** La ligne sous le nom : l'horaire du Mac, puis l'échéance ou l'état suspendu. */
function subtitle(routine: Routine, now: number): string {
  const schedule = routine.scheduleWords || (routine.manual ? t.scheduledManual : '');
  const next = routine.enabled
    ? routine.nextRun !== null
      ? nextWords(routine.nextRun, now)
      : ''
    : t.scheduledPaused;
  return [schedule, next].filter((part) => part.length > 0).join(' · ');
}

export function ScheduledView() {
  const insets = useSafeAreaInsets();
  const { routines, error, refreshing, refresh, reload } = useRoutines();
  const now = useClock(true, 60_000);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name: string; action: Action } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (routine: Routine, action: Action): Promise<void> => {
    setPending({ name: routine.name, action });
    setNotice(null);
    try {
      if (action === 'run') await postRoutineRun(routine.name);
      else if (action === 'pause') await postRoutinePause(routine.name);
      else await postRoutineResume(routine.name);
      impact(ImpactStyle.Medium);
      await reload();
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setNotice(
        action === 'run'
          ? t.scheduledRunFailed(why)
          : action === 'pause'
            ? t.scheduledPauseFailed(why)
            : t.scheduledResumeFailed(why),
      );
    } finally {
      setPending(null);
    }
  };

  /** Lancer et suspendre demandent un choix explicite ; reprendre est l'inverse, sans risque. */
  const confirm = (routine: Routine, action: 'run' | 'pause'): void => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: action === 'run' ? t.scheduledRunConfirm(routine.name) : t.scheduledPauseConfirm(routine.name),
        options: [action === 'run' ? t.scheduledRunNow : t.scheduledPause, t.actionCancel],
        cancelButtonIndex: 1,
        userInterfaceStyle: 'dark',
      },
      (index) => {
        if (index === 0) void act(routine, action);
      },
    );
  };

  const toggle = (name: string): void => {
    impact(ImpactStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((current) => (current === name ? null : name));
  };

  if (routines === null) {
    if (error !== null) {
      return (
        <ErrorScreen
          title={t.scheduledErrorTitle}
          error={error}
          hint={t.scheduledErrorHint}
          onRetry={() => void reload()}
        />
      );
    }
    return (
      <View style={styles.loading}>
        <SkeletonList count={4} height={52} />
      </View>
    );
  }

  const sections = groupRoutines(routines, now);

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
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.text.secondary} />
        }
      >
        {sections.length === 0 ? <EmptyState title={t.scheduledEmpty} /> : null}

        {sections.map((section) => (
          <View key={section.key} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Txt variant="caption" color={colors.text.tertiary} style={styles.sectionTitle}>
                {SECTION_TITLE[section.key].toUpperCase()}
              </Txt>
              <Txt variant="caption" color={colors.text.tertiary}>
                {section.routines.length}
              </Txt>
            </View>
            <View style={styles.card}>
              {section.routines.map((routine, index) => {
                const status = statusOf(routine);
                const line = subtitle(routine, now);
                const expanded = open === routine.name;
                const busy = pending?.name === routine.name;
                const locked = pending !== null;
                return (
                  <View key={routine.name}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.scheduledRowA11y(routine.name, line, status.label)}
                      accessibilityHint={t.scheduledRowHint}
                      accessibilityState={{ expanded }}
                      onPress={() => toggle(routine.name)}
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    >
                      <View style={styles.rowText}>
                        <Txt variant="callout" color={colors.text.primary} numberOfLines={1} style={styles.name}>
                          {routine.name}
                        </Txt>
                        <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1}>
                          {line}
                        </Txt>
                      </View>
                      <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[status.kind] }]} />
                    </Pressable>

                    {expanded ? (
                      <View style={styles.detail}>
                        {routine.description.length > 0 ? (
                          <Txt variant="footnote" color={colors.text.secondary}>
                            {routine.description}
                          </Txt>
                        ) : null}
                        {status.kind === 'running' ? (
                          <Txt variant="footnote" color={colors.status.working}>
                            {t.scheduledRunningNow}
                          </Txt>
                        ) : null}
                        {routine.enabled && routine.nextRun !== null ? (
                          <Txt variant="footnote" color={colors.text.secondary}>
                            {t.scheduledNext(nextWords(routine.nextRun, now), inWords(routine.nextRun, now))}
                          </Txt>
                        ) : null}
                        <Txt variant="footnote" color={colors.text.tertiary}>
                          {routine.last === null
                            ? t.scheduledLastRunNever
                            : t.scheduledLastRun(lastRunOf(routine).label, lastWords(routine.last.end, now))}
                        </Txt>

                        <Button
                          label={busy && pending?.action === 'run' ? t.scheduledSending : t.scheduledRunNow}
                          height={40}
                          disabled={locked || routine.running}
                          onPress={() => confirm(routine, 'run')}
                        />
                        <View style={styles.secondaryActions}>
                          <Button
                            kind="secondary"
                            height={40}
                            style={styles.grow}
                            label={
                              busy && (pending?.action === 'pause' || pending?.action === 'resume')
                                ? t.scheduledSending
                                : routine.enabled
                                  ? t.scheduledPause
                                  : t.scheduledResume
                            }
                            disabled={locked}
                            onPress={() =>
                              routine.enabled ? confirm(routine, 'pause') : void act(routine, 'resume')
                            }
                          />
                          <Button
                            kind="secondary"
                            height={40}
                            style={styles.grow}
                            label={t.scheduledOpenLog}
                            disabled={locked}
                            onPress={() => router.push({ pathname: '/routine-log', params: { name: routine.name } })}
                          />
                        </View>
                      </View>
                    ) : null}

                    {index < section.routines.length - 1 ? <View style={styles.separator} /> : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, paddingTop: space[4] },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: space[2], gap: space[6] },
  section: { gap: space[3] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[1] },
  sectionTitle: { letterSpacing: 0.6 },
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
  rowPressed: { backgroundColor: colors.bg.pressed },
  rowText: { flex: 1, gap: space[1] },
  // Inter Medium n'est pas synthétisable sur iOS : la famille porte la graisse (15/500).
  name: { fontFamily: interFamily('500') },
  statusDot: { width: 8, height: 8, borderRadius: radius.full },
  detail: { paddingHorizontal: space[5], paddingBottom: space[4], gap: space[3] },
  secondaryActions: { flexDirection: 'row', gap: space[3] },
  grow: { flex: 1 },
  separator: { position: 'absolute', left: space[5], right: space[5], bottom: 0, height: 1, backgroundColor: colors.border.subtle },
});
