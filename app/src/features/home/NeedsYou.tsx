// La carte « Needs you » en tete de Panes (P04) : ce qui ne se reglera pas tout seul.
// Erreurs et routines en echec passent toujours, les questions remplissent les quatre
// lignes restantes (deux au minimum) ; le reste se deplie. Un tap mene la ou se regle la
// chose : le pane pour une erreur ou une permission, l'ecran de la question pour un ask,
// l'onglet Scheduled pour une routine.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { NeedItem } from '@/protocol';
import { colors, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt, interFamily } from '@/ui/Txt';
import { shortAgeMs } from '@/utils/time';
import { t } from '@/i18n/en';
import { askIdOf, needCounts, visibleNeedItems } from './needs';

interface Props {
  items: readonly NeedItem[];
  now: number;
  onOpenPane: (paneId: number) => void;
  onOpenAsk: (askId: string) => void;
  onShowScheduled: () => void;
}

export function NeedsYou({ items, now, onOpenPane, onOpenAsk, onShowScheduled }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const counts = needCounts(items);
  const shown = visibleNeedItems(items, expanded);
  const hidden = items.length - shown.length;

  const open = (item: NeedItem): void => {
    if (item.kind === 'failed_routine') {
      onShowScheduled();
      return;
    }
    const askId = askIdOf(item);
    if (askId !== null) {
      onOpenAsk(askId);
      return;
    }
    if (item.pane_id !== null) onOpenPane(item.pane_id);
  };

  const parts: { text: string; color: string }[] = [];
  if (counts.needYou > 0) parts.push({ text: t.needsYouNeedYou(counts.needYou), color: colors.status.awaiting });
  if (counts.errors > 0) parts.push({ text: t.needsYouErrors(counts.errors), color: colors.status.error });
  if (counts.failed > 0) parts.push({ text: t.needsYouFailed(counts.failed), color: colors.status.error });

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Txt variant="footnote" color={colors.text.secondary} style={styles.headerTitle}>
          {t.needsYouTitle}
        </Txt>
        <View style={styles.grow} />
        {parts.map((part, index) => (
          <View key={part.text} style={styles.summaryPart}>
            {index > 0 ? (
              <Txt variant="footnote" color={colors.text.tertiary}>
                ·
              </Txt>
            ) : null}
            <Txt variant="footnote" color={part.color} numberOfLines={1}>
              {part.text}
            </Txt>
          </View>
        ))}
      </View>

      {shown.map((item) => {
        const age = shortAgeMs(now - item.since * 1000);
        const dot =
          item.kind === 'error'
            ? colors.status.error
            : item.kind === 'failed_routine'
              ? colors.status.error
              : colors.status.awaiting;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={t.needsYouRowA11y(item.title, item.detail, age ? `${age} ago` : '')}
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            {item.kind === 'failed_routine' ? (
              <View style={styles.marker}>
                <Icon name="x-circle" size={14} color={colors.status.error} />
              </View>
            ) : (
              <View style={styles.marker}>
                <View style={[styles.dot, { backgroundColor: dot }]} />
              </View>
            )}
            <Txt variant="callout" color={colors.text.primary} numberOfLines={1} style={styles.title}>
              {item.title}
            </Txt>
            <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1} style={styles.detail}>
              {item.detail}
            </Txt>
            <Txt
              variant="caption"
              color={item.kind === 'ask' ? colors.status.awaiting : colors.status.error}
              numberOfLines={1}
            >
              {age}
            </Txt>
          </Pressable>
        );
      })}

      {hidden > 0 || expanded ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
        >
          <Txt variant="footnote" color={colors.text.tertiary}>
            {expanded ? t.needsYouShowLess : t.needsYouShowAll(items.length)}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Rayon de la carte du design system (proto : 12), comme la carte d'onglet. */
const CARD_RADIUS = 12;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: CARD_RADIUS,
    paddingVertical: space[1],
    marginBottom: space[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[1],
  },
  headerTitle: { fontFamily: interFamily('600') },
  grow: { flex: 1 },
  summaryPart: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 44,
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
  },
  rowPressed: { backgroundColor: colors.bg.pressed },
  marker: { width: 16, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flexShrink: 0, maxWidth: '46%', fontFamily: interFamily('500') },
  detail: { flex: 1 },
  more: {
    alignSelf: 'flex-start',
    marginLeft: space[4],
    marginTop: space[1],
    paddingVertical: space[1],
    paddingRight: space[2],
  },
  morePressed: { opacity: 0.7 },
});
