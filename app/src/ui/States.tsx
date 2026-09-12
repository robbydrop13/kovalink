// États vides, de chargement et d'erreur. Les états dégradés sont la moitié du travail :
// ils sont spécifiés dans le design et implémentés ici, pas improvisés au cas par cas.
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, motion, radius, space } from '@/theme';
import { Button } from './Button';
import { Txt } from './Txt';
import { Icon, type IconName } from './Icon';

export function Banner({
  text,
  tone = 'info',
  actionLabel,
  onAction,
}: {
  text: string;
  tone?: 'info' | 'warn' | 'error' | 'offline' | 'working';
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tint =
    tone === 'error'
      ? colors.status.error
      : tone === 'warn'
        ? colors.link.macUnreachable
        : tone === 'offline'
          ? colors.link.offline
          : tone === 'working'
            ? colors.status.working
            : colors.accent.primary;
  return (
    <View style={[styles.banner, { borderLeftColor: tint }]}>
      <Txt variant="footnote" color={colors.text.secondary} style={styles.bannerText}>
        {text}
      </Txt>
      {actionLabel && onAction ? (
        <Button label={actionLabel} kind="secondary" height={32} onPress={onAction} />
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  /** Icône Feather au dessus du titre. */
  icon?: IconName;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {icon ? <Icon name={icon} size={24} color={colors.text.tertiary} /> : null}
      <Txt variant="display" color={colors.text.primary} align="center">
        {title}
      </Txt>
      {body ? (
        <Txt variant="callout" color={colors.text.secondary} align="center">
          {body}
        </Txt>
      ) : null}
      <View style={styles.emptyActions}>{children}</View>
    </View>
  );
}

/** Squelette de chargement. Jamais de spinner plein écran sur la liste (design 4.1). */
function Skeleton({ height, style }: { height: number; style?: object }) {
  const [shimmer] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 0.7, duration: motion.pulse / 2, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0.35, duration: motion.pulse / 2, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);
  return (
    <Animated.View
      style={[
        { height, backgroundColor: colors.bg.raised, borderRadius: radius.lg, opacity: shimmer },
        style,
      ]}
    />
  );
}

export function SkeletonList({ count = 3, height = 64 }: { count?: number; height?: number }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[5],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.raised,
    borderLeftWidth: 3,
  },
  bannerText: { flexShrink: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
    paddingHorizontal: space[8],
  },
  emptyActions: { alignSelf: 'stretch', gap: space[3], marginTop: space[4] },
  skeletonList: { gap: space[4], padding: space[5] },
});
