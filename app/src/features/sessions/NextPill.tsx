// La pastille de Cmd+J (proto, vue Panes du téléphone) : un galet accent à rayon complet,
// icône play, mot `Next` 15 Semibold blanc, badge rond blanc à texte accent. Elle flotte
// au dessus du fil ; `docked`, elle prend place dans un en-tête et ne change que sa pose.
// Mode neutre pour `Next idle`, `check-circle` 1 600 ms quand le dernier non lu vient
// d'être lu. Masquée par le parent (clavier, brouillon, envoi). Appui long : la palette
// Unread.
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { t } from '@/i18n/en';
import { colors, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { NotifyType, notify } from '@/utils/haptics';
import type { NextState } from './useNextTarget';

const CAUGHT_UP_MS = 1600;
/** Texte du proto : la pastille ne porte pas d'autre mot. */
const NEXT_LABEL = 'Next';

export type PillMode = 'next' | 'caughtUp' | 'idle';

export function NextPill({
  state,
  hidden,
  onPress,
  onLongPress,
  docked = false,
}: {
  state: NextState;
  hidden: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** Pose dans un en-tete plutot que flottant au dessus du fil (accueil, P02). */
  docked?: boolean;
}) {
  const [flash, setFlash] = useState(false);
  const previousUnread = useRef<number | null>(null);
  const [opacity] = useState(() => new Animated.Value(hidden ? 0 : 1));

  // Le flash « All caught up » ne salue qu'une fin vécue : le compteur est tombé à zéro
  // pendant que l'écran était ouvert, pas un écran ouvert sur zéro.
  useEffect(() => {
    const before = previousUnread.current;
    previousUnread.current = state.unreadCount;
    if (before !== null && before > 0 && state.unreadCount === 0) {
      setFlash(true);
      notify(NotifyType.Success);
      const timer = setTimeout(() => setFlash(false), CAUGHT_UP_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state.unreadCount]);

  useEffect(() => {
    Animated.timing(opacity, { toValue: hidden ? 0 : 1, duration: 120, useNativeDriver: true }).start();
  }, [hidden, opacity]);

  const target = state.target;
  const pending = target?.kind === 'need' || target?.kind === 'scheduled';
  const mode: PillMode | null =
    flash && !pending ? 'caughtUp' : target === null ? null : target.kind === 'idle' ? 'idle' : 'next';
  if (mode === null) return null;

  const badge = mode === 'next' ? state.waitCount : mode === 'idle' ? state.idleCount : 0;
  const accent = mode === 'next';
  const tint = mode === 'next' ? colors.text.onFill : mode === 'idle' ? colors.text.secondary : colors.status.success;
  const dest =
    target === null
      ? ''
      : target.kind === 'need'
        ? t.nextPillHint(t.needsYouTitle, target.item.title)
        : target.kind === 'scheduled'
          ? t.homeTabScheduled
          : t.nextPillHint(
              target.entry.group.title,
              target.entry.pane.title ?? target.entry.pane.agent ?? '',
            );

  return (
    <Animated.View pointerEvents={hidden ? 'none' : 'auto'} style={[styles.wrap, docked && styles.docked, { opacity }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={mode === 'caughtUp' ? t.allCaughtUp : mode === 'idle' ? `${t.nextIdle}, ${badge}` : t.nextPillA11y(badge)}
        accessibilityHint={dest}
        disabled={mode === 'caughtUp'}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={({ pressed }) => [
          styles.pill,
          mode === 'caughtUp' && styles.pillCaughtUp,
          accent && styles.pillAccent,
          badge > 0 ? styles.pillBadged : null,
          pressed && styles.pressed,
        ]}
      >
        <Icon name={mode === 'caughtUp' ? 'check-circle' : 'play'} size={mode === 'caughtUp' ? 16 : 12} color={tint} />
        {mode === 'caughtUp' ? null : (
          <Txt variant="calloutStrong" color={tint}>
            {NEXT_LABEL}
          </Txt>
        )}
        {badge > 0 ? (
          <View style={[styles.badge, accent ? styles.badgeAccent : styles.badgeIdle]}>
            <Txt variant="footnote" color={accent ? colors.accent.primary : colors.text.secondary}>
              {badge}
            </Txt>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** Hauteur du bouton plus sa marge : le fil garde ce padding bas. */
export const NEXT_BUTTON_SPACE = 44 + space[4];

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: space[5], bottom: space[4] },
  docked: { position: 'relative', right: 0, bottom: 0 },
  pill: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: space[4],
    paddingRight: space[4],
    borderRadius: radius.full,
    backgroundColor: colors.bg.overlay,
    borderWidth: 1,
    borderColor: colors.border.strong,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  pillAccent: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  pillCaughtUp: { width: 44, paddingLeft: 0, paddingRight: 0, justifyContent: 'center' },
  pillBadged: { paddingRight: space[2] },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
  badgeAccent: { backgroundColor: colors.text.onFill },
  badgeIdle: { backgroundColor: colors.bg.pressed },
});
