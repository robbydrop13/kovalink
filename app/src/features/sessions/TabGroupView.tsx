// Un onglet Kova et ses panes, comme dans la barre d'onglets du Mac : barre de couleur à
// gauche (les six couleurs Kova, 0 rouge à 5 violet), nom de l'onglet, marque `actif`
// pour l'onglet au premier plan, puis les panes dans l'ordre. Un pane qui attend garde sa
// carte, à sa place dans l'onglet, jamais extrait dans une section à part. Un tap sur
// l'en-tête replie ou déplie les panes ; replié, l'en-tête garde un résumé (nombre de
// panes, point ambre si un pane attend, bleu si un pane travaille).
//
// Tenir une ligne 300 ms la soulève : on la glisse à un autre rang de l'onglet, le Mac
// suit. Tenir la partie gauche de l'en-tête soulève l'onglet entier (geste porté par
// l'écran, qui passe `dragHandle`) ; le `+` reste hors de la zone de prise.
import { useMemo } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { PanGestureHandler, type PanGestureHandlerProps } from 'react-native-gesture-handler';
import type { Pane, Prompt } from '@/protocol';
import { colors, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { AwaitingCard } from './AwaitingCard';
import { SessionRow } from './SessionRow';
import { SwipeRow, type SwipeActions } from './SwipeRow';
import { reorderAccessibility, type ReorderActions } from './reorderAccessibility';
import { collapsedSummary, type TabGroup } from './tabGroups';
import { DragItem, useDragReorder } from './useDragReorder';
import { t } from '@/i18n/en';

interface Props {
  group: TabGroup;
  prompts: Record<number, Prompt>;
  aging: (paneId: number) => boolean;
  onOpen: (paneId: number) => void;
  onRelaunch: (pane: Pane) => void;
  /** Panes repliés : l'en-tête seul, avec son résumé. */
  collapsed: boolean;
  /** Tap sur l'en-tête d'onglet : replier ou déplier ses panes. */
  onToggle: () => void;
  /** Le `+` de l'en-tête : un pane de plus dans cet onglet. */
  onAddPane: () => void;
  /** Balayage d'une ligne : fermer, favori, renommer. */
  swipeFor: (pane: Pane, group: TabGroup) => SwipeActions;
  /** Cmd+J : le pane est non lu sur ce téléphone. */
  isUnread: (pane: Pane) => boolean;
  onInterrupt: (paneId: number) => void;
  interruptDisabled: boolean;
  interruptLabel: (paneId: number) => string;
  /** Geste de l'écran pour déplacer l'onglet : posé sur la partie gauche de l'en-tête. */
  dragHandle?: PanGestureHandlerProps | undefined;
  /** VoiceOver : déplacer l'onglet d'un rang. */
  tabReorder?: ReorderActions | undefined;
  /** Liaison dégradée : aucun déplacement de pane ne part. */
  dragDisabled: boolean;
  /** Un autre geste est en cours quelque part dans la liste. */
  dragLocked: boolean;
  onDragLift: () => void;
  /** Un pane lâché (ou déplacé par VoiceOver) : `to` peut valoir `from`. */
  onReorderPane: (from: number, to: number) => void;
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
  collapsed,
  onToggle,
  onAddPane,
  swipeFor,
  isUnread,
  onInterrupt,
  interruptDisabled,
  interruptLabel,
  dragHandle,
  tabReorder,
  dragDisabled,
  dragLocked,
  onDragLift,
  onReorderPane,
}: Props) {
  const tint = tabTint(group.color);
  const summary = collapsed ? collapsedSummary(group) : null;
  const keys = useMemo(() => group.panes.map((p) => p.id), [group.panes]);
  const canDrag = !dragDisabled && group.tabId !== null && keys.length > 1;
  const paneReorder = (index: number): ReorderActions | undefined =>
    canDrag
      ? {
          canUp: index > 0,
          canDown: index < keys.length - 1,
          onMove: (dir) => {
            onReorderPane(index, index + dir);
            AccessibilityInfo.announceForAccessibility(t.reorderMovedTo(index + dir + 1, keys.length));
          },
        }
      : undefined;
  /** Le contenu d'une ligne, sans ses gestes : rendu dans la liste et par la copie flottante. */
  const row = (pane: Pane, index: number) =>
    pane.awaiting ? (
      <AwaitingCard
        pane={pane}
        prompt={prompts[pane.id]}
        aging={aging(pane.id)}
        onOpen={() => onOpen(pane.id)}
        interruptDisabled={interruptDisabled}
        interruptLabel={interruptLabel(pane.id)}
        onInterrupt={() => onInterrupt(pane.id)}
        reorder={paneReorder(index)}
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
        reorder={paneReorder(index)}
      />
    );
  const paneDrag = useDragReorder<number>({
    keys,
    gap: space[3],
    radius: radius.md,
    enabled: canDrag && !dragLocked,
    ghost: (id) => {
      const index = keys.indexOf(id);
      const pane = group.panes[index];
      return pane ? row(pane, index) : null;
    },
    onLift: onDragLift,
    onDrop: onReorderPane,
  });
  const header = (
    <>
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1} style={styles.title}>
        {group.title}
      </Txt>
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.text.secondary} />
      {summary ? (
        <View style={styles.summary}>
          {summary.awaiting ? <View style={[styles.stateDot, { backgroundColor: colors.status.awaiting }]} /> : null}
          {summary.working ? <View style={[styles.stateDot, { backgroundColor: colors.status.working }]} /> : null}
          <Txt variant="caption" color={colors.text.tertiary}>
            {t.tabCollapsedCount(summary.count)}
          </Txt>
        </View>
      ) : null}
      {group.active ? (
        <View style={styles.activeChip}>
          <Txt variant="caption" color={colors.text.secondary}>
            {t.tabActiveChip}
          </Txt>
        </View>
      ) : null}
    </>
  );
  return (
    <View
      style={[styles.group, { borderLeftColor: tint }]}
      accessibilityLabel={t.tabGroupAccessibilityLabel(group.tabIndex + 1, group.title, group.active, group.panes.length)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.tabHeaderAccessibilityLabel(group.title, collapsed)}
        accessibilityHint={dragHandle ? t.reorderDragHint : undefined}
        accessibilityState={{ expanded: !collapsed }}
        {...reorderAccessibility(tabReorder)}
        onPress={onToggle}
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
      >
        {dragHandle ? (
          <PanGestureHandler {...dragHandle}>
            <Animated.View collapsable={false} style={styles.grab}>
              {header}
            </Animated.View>
          </PanGestureHandler>
        ) : (
          <View style={styles.grab}>{header}</View>
        )}
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
      {collapsed ? null : (
        <View style={styles.panes}>
          {paneDrag.placeholder}
          {group.panes.map((pane: Pane, index: number) => (
            <DragItem key={pane.id} list={paneDrag} id={pane.id}>
              <PanGestureHandler {...paneDrag.handlerProps(pane.id)}>
                <Animated.View collapsable={false}>
                  <SwipeRow actions={swipeFor(pane, group)} enabled={!dragLocked && paneDrag.active === null}>
                    {row(pane, index)}
                  </SwipeRow>
                </Animated.View>
              </PanGestureHandler>
            </DragItem>
          ))}
          {paneDrag.ghost}
        </View>
      )}
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
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 32, borderRadius: radius.sm },
  headerPressed: { backgroundColor: colors.bg.pressed },
  /** La zone de prise : tout l'en-tête sauf le `+`. */
  grab: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 32 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  add: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
    marginRight: space[1],
    marginLeft: space[3],
  },
  addPressed: { backgroundColor: colors.bg.pressed },
  title: { flexShrink: 1 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  activeChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.strong,
  },
  panes: { gap: space[3] },
});
