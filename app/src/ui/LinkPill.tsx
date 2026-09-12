// Pastille de liaison. Affichée en permanence, jamais bloquante (P5). Cinq états, dont deux
// qui se ressemblent et ne doivent surtout pas être confondus : `Hors ligne` est actionnable
// par Robin, `Mac injoignable` ne l'est pas.
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius } from '@/theme';
import { LINK_LABEL, useConnection, type LinkState } from '@/store/connection';
import { Txt } from './Txt';

const TINT: Record<LinkState, string> = {
  connecting: colors.link.connecting,
  direct: colors.link.direct,
  relayed: colors.link.relayed,
  macUnreachable: colors.link.macUnreachable,
  offline: colors.link.offline,
};

export function LinkPill({ compact = false, onPress }: { compact?: boolean; onPress?: () => void }) {
  const link = useConnection((s) => s.link);
  const latency = useConnection((s) => s.latencyMs);
  const tint = TINT[link];
  const label =
    (link === 'direct' || link === 'relayed') && latency !== null
      ? `${LINK_LABEL[link]} ${latency} ms`
      : LINK_LABEL[link];

  if (compact) {
    return <View accessibilityLabel={label} style={[styles.dot, { backgroundColor: tint }]} />;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Liaison : ${label}`}
      hitSlop={{ top: 11, bottom: 11, left: 8, right: 8 }}
      onPress={onPress ?? (() => undefined)}
      style={styles.pill}
    >
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Txt variant="caption" color={tint}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent.subtleBg,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
