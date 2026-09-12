// Le bouton flottant de Cmd+J (docs/16, 6.1 et 6.2) : `Next unread (3)`, puis
// `All caught up` 1 600 ms quand le dernier non lu vient d'être lu, puis `Next idle (2)`
// ou rien. Jamais d'animation d'attention ; masqué par le parent (clavier, brouillon,
// envoi en cours). Appui long : la palette Unread.
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { t } from '@/i18n/en';
import { colors, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { NotifyType, notify } from '@/utils/haptics';
import type { NextState } from './useNextTarget';

const CAUGHT_UP_MS = 1600;

export type PillMode = 'next' | 'caughtUp' | 'idle';

export function NextPill({
  state,
  hidden,
  onPress,
  onLongPress,
}: {
  state: NextState;
  hidden: boolean;
  onPress: () => void;
  onLongPress?: () => void;
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

  const mode: PillMode | null = flash ? 'caughtUp' : state.target?.kind === 'unread' ? 'next' : state.target?.kind === 'idle' ? 'idle' : null;
  if (mode === null) return null;

  const badge = mode === 'next' ? state.unreadCount : mode === 'idle' ? state.idleCount : 0;
  const label = mode === 'next' ? t.nextUnread : mode === 'idle' ? t.nextIdle : t.allCaughtUp;
  const tint = mode === 'next' ? colors.accent.primary : mode === 'idle' ? colors.text.secondary : colors.status.success;
  const dest = state.target ? t.nextPillHint(state.target.entry.group.title, state.target.entry.pane.title ?? state.target.entry.pane.agent ?? '') : '';

  return (
    <Animated.View pointerEvents={hidden ? 'none' : 'auto'} style={[styles.wrap, { opacity }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={mode === 'caughtUp' ? t.allCaughtUp : t.nextPillA11y(badge)}
        accessibilityHint={dest}
        disabled={mode === 'caughtUp'}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <Icon name={mode === 'caughtUp' ? 'check-circle' : 'skip-forward'} size={16} color={tint} />
        <Txt variant="calloutStrong" color={mode === 'caughtUp' ? colors.status.success : mode === 'idle' ? colors.text.secondary : colors.text.primary}>
          {label}
        </Txt>
        {badge > 0 ? (
          <View style={[styles.badge, mode === 'idle' ? styles.badgeIdle : styles.badgeNext]}>
            <Txt variant="caption" color={mode === 'idle' ? colors.text.secondary : colors.text.onFill}>
              {badge}
            </Txt>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: space[5], bottom: space[4] },
  pill: {
    minWidth: 140,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    borderRadius: radius.full,
    backgroundColor: colors.bg.overlay,
    borderWidth: 1,
    borderColor: colors.border.strong,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  pressed: { backgroundColor: colors.bg.pressed, transform: [{ scale: 0.97 }] },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeNext: { backgroundColor: colors.accent.primary },
  badgeIdle: { backgroundColor: colors.bg.pressed },
});
