// Le bouton flottant de Cmd+J (docs/16, retouche du 12 septembre) : un rond de 44 pt en
// bas à droite, icône `skip-forward` seule et badge du compte, au dessus de la barre de
// message ; le fil garde un padding bas égal pour que sa dernière ligne reste lisible.
// Rond accent tant qu'il reste du non lu, neutre pour `Next idle`, `check-circle` 1 600 ms
// quand le dernier non lu vient d'être lu. Masqué par le parent (clavier, brouillon,
// envoi). Appui long : la palette Unread.
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
  const tint = mode === 'next' ? colors.accent.primary : mode === 'idle' ? colors.text.secondary : colors.status.success;
  const dest = state.target ? t.nextPillHint(state.target.entry.group.title, state.target.entry.pane.title ?? state.target.entry.pane.agent ?? '') : '';

  return (
    <Animated.View pointerEvents={hidden ? 'none' : 'auto'} style={[styles.wrap, { opacity }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={mode === 'caughtUp' ? t.allCaughtUp : mode === 'idle' ? `${t.nextIdle}, ${badge}` : t.nextPillA11y(badge)}
        accessibilityHint={dest}
        disabled={mode === 'caughtUp'}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={({ pressed }) => [styles.round, mode === 'next' && styles.roundNext, pressed && styles.pressed]}
      >
        <Icon name={mode === 'caughtUp' ? 'check-circle' : 'skip-forward'} size={20} color={mode === 'next' ? colors.text.onFill : tint} />
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

/** Hauteur du bouton rond plus sa marge : le fil garde ce padding bas. */
export const NEXT_BUTTON_SPACE = 44 + space[4];

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: space[5], bottom: space[4] },
  round: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.overlay,
    borderWidth: 1,
    borderColor: colors.border.strong,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  roundNext: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: colors.bg.base,
  },
  badgeNext: { backgroundColor: colors.accent.primary },
  badgeIdle: { backgroundColor: colors.bg.pressed },
});
