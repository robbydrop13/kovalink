// Un onglet Kova et ses panes, comme dans la barre d'onglets du Mac : barre de couleur à
// gauche (les six couleurs Kova, 0 rouge à 5 violet), nom de l'onglet, marque `actif`
// pour l'onglet au premier plan, puis les panes dans l'ordre. Un pane qui attend garde sa
// carte, à sa place dans l'onglet, jamais extrait dans une section à part.
import { Pressable, StyleSheet, View } from 'react-native';
import type { Pane, Prompt } from '@/protocol';
import { colors, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { AwaitingCard } from './AwaitingCard';
import { SessionRow } from './SessionRow';
import { SwipeRow, type SwipeActions } from './SwipeRow';
import type { TabGroup } from './tabGroups';
import { t } from '@/i18n/en';

interface Props {
  group: TabGroup;
  prompts: Record<number, Prompt>;
  aging: (paneId: number) => boolean;
  onOpen: (paneId: number) => void;
  onRelaunch: (pane: Pane) => void;
  /** Tap sur l'en-tête d'onglet : la palette des panes (Cmd+P). */
  onHeaderPress: () => void;
  /** Le `+` de l'en-tête : un pane de plus dans cet onglet. */
  onAddPane: () => void;
  /** Balayage d'une ligne : fermer, favori, renommer. */
  swipeFor: (pane: Pane, group: TabGroup) => SwipeActions;
  /** Cmd+J : le pane est non lu sur ce téléphone. */
  isUnread: (pane: Pane) => boolean;
  onInterrupt: (paneId: number) => void;
  interruptDisabled: boolean;
  interruptLabel: (paneId: number) => string;
}

/** Couleur d'onglet Kova vers token, gris neutre sans couleur. */
export function tabTint(color: number | null): string {
  return color === null ? colors.tabNone : (colors.tab[color] ?? colors.tabNone);
}

export function TabGroupView({
  group,
  prompts,
  aging,
  onOpen,
  onRelaunch,
  onHeaderPress,
  onAddPane,
  swipeFor,
  isUnread,
  onInterrupt,
  interruptDisabled,
  interruptLabel,
}: Props) {
  const tint = tabTint(group.color);
  return (
    <View
      style={[styles.group, { borderLeftColor: tint }]}
      accessibilityLabel={t.tabGroupAccessibilityLabel(group.tabIndex + 1, group.title, group.active, group.panes.length)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.tabHeaderAccessibilityLabel(group.title)}
        onPress={onHeaderPress}
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
      >
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1} style={styles.title}>
          {group.title}
        </Txt>
        {group.active ? (
          <View style={styles.activeChip}>
            <Txt variant="caption" color={colors.text.secondary}>
              {t.tabActiveChip}
            </Txt>
          </View>
        ) : null}
        <View style={styles.grow} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.tabAddPane}
          hitSlop={8}
          onPress={onAddPane}
          style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
        >
          <Icon name="plus" size={16} color={colors.text.secondary} />
        </Pressable>
      </Pressable>
      <View style={styles.panes}>
        {group.panes.map((pane: Pane) => (
          <SwipeRow key={pane.id} actions={swipeFor(pane, group)}>
            {pane.awaiting ? (
              <AwaitingCard
                pane={pane}
                prompt={prompts[pane.id]}
                aging={aging(pane.id)}
                onOpen={() => onOpen(pane.id)}
                interruptDisabled={interruptDisabled}
                interruptLabel={interruptLabel(pane.id)}
                onInterrupt={() => onInterrupt(pane.id)}
              />
            ) : (
              <SessionRow
                pane={pane}
                prompt={prompts[pane.id]}
                unread={isUnread(pane)}
                onOpen={() => onOpen(pane.id)}
                onRelaunch={() => onRelaunch(pane)}
                interruptDisabled={interruptDisabled}
                interruptLabel={interruptLabel(pane.id)}
                onInterrupt={() => onInterrupt(pane.id)}
              />
            )}
          </SwipeRow>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingLeft: space[4],
    gap: space[3],
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 32, borderRadius: radius.sm },
  headerPressed: { backgroundColor: colors.bg.pressed },
  dot: { width: 10, height: 10, borderRadius: 5 },
  grow: { flex: 1 },
  add: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
    marginRight: space[1],
  },
  addPressed: { backgroundColor: colors.bg.pressed },
  title: { flexShrink: 1 },
  activeChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.strong,
  },
  panes: { gap: space[3] },
});
