// Le Cockpit, vue autonome : la meme liste que le Cockpit de Kova sur le Mac (sections
// Urgent / Aujourd'hui / Cette semaine, filtre Tout / Claap / Perso, 10 cartes puis
// `Voir plus`), les memes gestes, et les toasts qui disent ce qu'un geste a donne. Elle ne
// sait pas ou elle est montee : un seul `<CockpitView />` suffit, la navigation viendra.
//
// Une carte que la file ne decrit pas encore par ses gestes (daemon ou `attn` plus anciens)
// garde la ligne d'avant (`AttentionRow`).
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { t } from '@/i18n/en';
import { colors, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt, interFamily } from '@/ui/Txt';
import { EmptyState } from '@/ui/States';
import { isDegraded, useConnection } from '@/store/connection';
import { useClock } from '@/utils/useClock';
import { AttentionRow } from '@/features/asks/AttentionList';
import { useAttention } from '@/features/asks/useAttention';
import { CockpitCard } from './CockpitCard';
import { visibleEntries, type CockpitToast } from './gesture';
import { cockpitLegacy, cockpitPage, type CockpitFilter, type CockpitPrio } from './rules';
import { useCockpit } from './useCockpit';

/** Un toast reste 5 s, comme celui de Kova. */
const TOAST_MS = 5_000;

const FILTERS: { key: CockpitFilter; label: string }[] = [
  { key: 'all', label: t.cockpitFilterAll },
  { key: 'claap', label: t.cockpitScopeClaap },
  { key: 'perso', label: t.cockpitScopePerso },
];

/** La pastille d'une section ; son nom est toujours ecrit a cote. */
const SECTION_DOT: Record<CockpitPrio, string> = {
  1: colors.status.error,
  2: colors.status.awaiting,
  3: colors.status.idle,
};

export function CockpitView({
  style,
  contentPaddingBottom = 0,
  showTitle = true,
}: {
  style?: ViewStyle;
  contentPaddingBottom?: number;
  /** Faux quand l'ecran qui le monte porte deja le titre (l'onglet de l'accueil). */
  showTitle?: boolean;
}) {
  const entries = useAttention();
  const filter = useCockpit((s) => s.filter);
  const limit = useCockpit((s) => s.limit);
  const hidden = useCockpit((s) => s.hidden);
  const degraded = isDegraded(useConnection((s) => s.link));
  const now = useClock(true, 30_000);

  useEffect(() => {
    if (entries !== null) useCockpit.getState().prune(entries);
  }, [entries]);

  const page = useMemo(
    // L'horloge de la vue (30 s) : une carte classee il y a moins de 60 s reste cachee.
    () => cockpitPage(visibleEntries(entries ?? [], hidden, now), filter, limit),
    [entries, hidden, filter, limit, now],
  );

  return (
    <View style={[styles.root, style]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={[styles.content, { paddingBottom: contentPaddingBottom + space[8] }]}
      >
        <View style={styles.header}>
          {showTitle ? (
            <Txt variant="title1" color={colors.text.primary}>
              {t.cockpitTitle}
            </Txt>
          ) : null}
          {entries !== null ? (
            <Txt variant="footnote" color={colors.text.secondary}>
              {t.cockpitSubtitle(page.total, page.urgent)}
            </Txt>
          ) : null}
        </View>

        <View style={styles.filters} accessibilityRole="tablist">
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable
                key={f.key}
                accessibilityRole="tab"
                accessibilityLabel={t.cockpitFilterA11y(f.label, page.filterCounts[f.key])}
                accessibilityState={{ selected: active }}
                onPress={() => useCockpit.getState().setFilter(f.key)}
                style={[styles.filter, active && styles.filterActive]}
              >
                <Txt variant="footnote" color={active ? colors.text.primary : colors.text.secondary} style={active ? styles.bold : undefined}>
                  {`${f.label} ${page.filterCounts[f.key]}`}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        {entries !== null && page.total === 0 ? <EmptyState icon="check-circle" title={t.cockpitEmpty} body="" /> : null}

        {page.sections.map((section) => (
          <View key={section.prio} style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={[styles.dot, { backgroundColor: SECTION_DOT[section.prio] }]} />
              <Txt variant="caption" color={colors.text.secondary} style={styles.sectionName}>
                {section.name.toUpperCase()}
              </Txt>
              <Txt variant="caption" color={colors.text.tertiary}>
                {String(section.count)}
              </Txt>
            </View>
            {section.cards.map((entry) =>
              cockpitLegacy(entry) ? (
                <AttentionRow key={entry.id} entry={entry} now={now} unavailable={degraded} />
              ) : (
                <CockpitCard key={entry.id} entry={entry} now={now} unavailable={degraded} />
              ),
            )}
          </View>
        ))}

        {page.more > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.cockpitMore(page.more)}
            onPress={() => useCockpit.getState().showMore()}
            style={styles.more}
          >
            <Txt variant="footnote" color={colors.text.primary}>
              {t.cockpitMore(page.more)}
            </Txt>
          </Pressable>
        ) : null}
      </ScrollView>
      <CockpitToasts bottom={contentPaddingBottom} />
    </View>
  );
}

/** Les toasts empiles, le plus recent en dernier, 5 s chacun, une croix pour fermer. */
function CockpitToasts({ bottom }: { bottom: number }) {
  const toasts = useCockpit((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <View style={[styles.toasts, { bottom: bottom + space[3] }]} pointerEvents="box-none">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </View>
  );
}

function ToastRow({ toast }: { toast: CockpitToast }) {
  useEffect(() => {
    const timer = setTimeout(() => useCockpit.getState().dismissToast(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id]);
  // Une icone et des mots disent l'issue, jamais la couleur seule.
  const icon = toast.neutral ? 'help-circle' : toast.ok ? 'check-circle' : 'alert-triangle';
  const color = toast.neutral ? colors.text.secondary : toast.ok ? colors.status.success : colors.status.error;
  return (
    <View style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Icon name={icon} size={16} color={color} />
      <View style={styles.toastText}>
        <Txt variant="footnote" color={colors.text.primary} style={styles.bold}>
          {toast.head}
        </Txt>
        <Txt variant="footnote" color={colors.text.secondary} numberOfLines={2}>
          {toast.title}
        </Txt>
        {toast.more ? (
          <Txt variant="caption" color={colors.text.secondary}>
            {toast.more}
          </Txt>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.cockpitToastClose}
        hitSlop={8}
        onPress={() => useCockpit.getState().dismissToast(toast.id)}
      >
        <Icon name="x" size={14} color={colors.text.tertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space[4], paddingTop: space[3], gap: space[3] },
  header: { gap: space[1] },
  bold: { fontFamily: interFamily('600') },
  filters: { flexDirection: 'row', gap: space[2] },
  filter: {
    paddingHorizontal: space[3],
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  filterActive: { backgroundColor: colors.bg.overlay, borderColor: colors.border.strong },
  section: { gap: space[2] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[1] },
  sectionName: { letterSpacing: 0.6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  more: {
    alignSelf: 'center',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.action.neutral.bg,
  },
  toasts: { position: 'absolute', left: space[3], right: space[3], gap: space[2] },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.bg.overlay,
  },
  toastText: { flex: 1, gap: 2 },
});
