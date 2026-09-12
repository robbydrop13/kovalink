// Ligne TRAVAILLE et ligne INACTIF.
//
// `Interrompre` est présent sur la ligne TRAVAILLE parce que le scénario S3 (l'agent est
// parti de travers) décrit un pane `working: true`, pas un pane `awaiting` : le geste le
// plus urgent du produit ne doit pas demander d'ouvrir la session (C21, C32).
import { Pressable, StyleSheet, View } from 'react-native';
import type { Pane } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { LinkAction } from '@/ui/Button';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { Txt } from '@/ui/Txt';
import { shortAge } from '@/utils/time';
import { PaneTitle, PermissionNote, bypassAccessibilitySuffix } from './PaneIdentity';

interface Props {
  pane: Pane;
  subtitle?: string | null;
  onOpen: () => void;
  /** Appui long : menu `Ouvrir sur le Mac` (design 4.1). */
  onLongPress?: () => void;
  onInterrupt?: () => void;
  interruptDisabled?: boolean;
  interruptLabel?: string;
}

export function SessionRow({
  pane,
  subtitle,
  onOpen,
  onLongPress,
  onInterrupt,
  interruptDisabled = false,
  interruptLabel = 'Interrompre',
}: Props) {
  const working = pane.working;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pane.projectName}, ${working ? 'travaille' : 'inactif'}${bypassAccessibilitySuffix(pane.permissionMode)}`}
      onPress={onOpen}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <StatusGlyph state={working ? 'working' : 'idle'} />
      <View style={styles.body}>
        <View style={styles.line}>
          <PaneTitle pane={pane} />
          <View style={styles.spacer} />
          <Txt variant="footnote" color={colors.text.tertiary}>
            {working ? 'en cours' : shortAge(pane.awaiting_since)}
          </Txt>
        </View>
        <PermissionNote mode={pane.permissionMode} />
        {subtitle ? (
          <Txt variant="footnote" color={colors.text.secondary} numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
        {working && onInterrupt ? (
          <View style={styles.actions}>
            <LinkAction
              label={interruptLabel}
              color={colors.action.interrupt.text}
              disabled={interruptDisabled}
              onPress={onInterrupt}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.rowMinHeight,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.bg.raised,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  body: { flex: 1, gap: space[2] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  spacer: { flex: 1 },
  actions: { alignItems: 'flex-end' },
  section: { marginTop: space[5], marginBottom: space[3], letterSpacing: 0.6 },
});

export function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <Txt variant="caption" color={colors.text.tertiary} style={styles.section}>
      {label} · {count}
    </Txt>
  );
}
