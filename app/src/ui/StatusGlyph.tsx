// Point d'état : 8 pt, dans la couleur de l'état (P03, vue Panes du proto). La forme ne
// distingue plus les états (plus d'icône Feather) : le mot d'état écrit à côté dit lequel.
// `working` pulse, comme avant.
import { useEffect, useState } from 'react';
import { Animated } from 'react-native';
import { colors, motion } from '@/theme';
import { t } from '@/i18n/en';

export type AgentState = 'awaiting' | 'working' | 'idle' | 'closed';

const DOT_COLOR: Record<AgentState, string> = {
  awaiting: colors.status.awaiting,
  working: colors.status.working,
  idle: colors.status.idle,
  closed: colors.status.closed,
};

export function StatusGlyph({ state, size = 8 }: { state: AgentState; size?: number }) {
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (state !== 'working') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: motion.pulse / 2, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.pulse / 2, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  const label =
    state === 'awaiting'
      ? t.glyphWaiting
      : state === 'working'
        ? t.glyphWorking
        : state === 'closed'
          ? t.glyphClosed
          : t.glyphIdle;
  return (
    <Animated.View
      accessible
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: DOT_COLOR[state],
        opacity: pulse,
      }}
    />
  );
}
