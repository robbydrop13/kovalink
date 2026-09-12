// Un onglet Kova et ses panes, comme dans la barre d'onglets du Mac : barre de couleur à
// gauche (les six couleurs Kova, 0 rouge à 5 violet), nom de l'onglet, marque `actif`
// pour l'onglet au premier plan, puis les panes dans l'ordre. Un pane qui attend garde sa
// carte, à sa place dans l'onglet, jamais extrait dans une section à part.
import { Pressable, StyleSheet, View } from 'react-native';
import type { Pane, Prompt } from '@/protocol';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { AwaitingCard } from './AwaitingCard';
import { SessionRow } from './SessionRow';
import type { TabGroup } from './tabGroups';

interface Props {
  group: TabGroup;
  prompts: Record<number, Prompt>;
  aging: (paneId: number) => boolean;
  onOpen: (paneId: number) => void;
  onOpenOnMac: (paneId: number) => void;
  onRelaunch: (pane: Pane) => void;
  /** Tap sur l'en-tête d'onglet : la palette des panes (Cmd+P). */
  onHeaderPress: () => void;
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
  onOpenOnMac,
  onRelaunch,
  onHeaderPress,
  onInterrupt,
  interruptDisabled,
  interruptLabel,
}: Props) {
  const tint = tabTint(group.color);
  return (
    <View
      style={[styles.group, { borderLeftColor: tint }]}
      accessibilityLabel={`Onglet ${group.tabIndex + 1}, ${group.title}${group.active ? ', actif sur le Mac' : ''}, ${group.panes.length} pane${group.panes.length > 1 ? 's' : ''}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Onglet ${group.title}, ouvrir la palette des panes`}
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
              actif
            </Txt>
          </View>
        ) : null}
      </Pressable>
      <View style={styles.panes}>
        {group.panes.map((pane: Pane) =>
          pane.awaiting ? (
            <AwaitingCard
              key={pane.id}
              pane={pane}
              prompt={prompts[pane.id]}
              aging={aging(pane.id)}
              onOpen={() => onOpen(pane.id)}
              onOpenOnMac={() => onOpenOnMac(pane.id)}
              interruptDisabled={interruptDisabled}
              interruptLabel={interruptLabel(pane.id)}
              onInterrupt={() => onInterrupt(pane.id)}
            />
          ) : (
            <SessionRow
              key={pane.id}
              pane={pane}
              prompt={prompts[pane.id]}
              onOpen={() => onOpen(pane.id)}
              onOpenOnMac={() => onOpenOnMac(pane.id)}
              onRelaunch={() => onRelaunch(pane)}
              interruptDisabled={interruptDisabled}
              interruptLabel={interruptLabel(pane.id)}
              onInterrupt={() => onInterrupt(pane.id)}
            />
          ),
        )}
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
