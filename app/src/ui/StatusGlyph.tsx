// Glyphe d'état, en icônes Feather : chaque état reste décodable par la FORME, pas
// seulement par la couleur (P4) : `pause-circle` pour `awaiting`, `activity` qui pulse
// pour `working`, `circle` creux pour `idle`, `x-circle` pour `closed`.
import { useEffect, useState } from 'react';
import { Animated } from 'react-native';
import { colors, motion } from '@/theme';
import { t } from '@/i18n/en';
import { Icon } from './Icon';

export type AgentState = 'awaiting' | 'working' | 'idle' | 'closed';

const ICON = {
  awaiting: { name: 'pause-circle', color: colors.status.awaiting },
  working: { name: 'activity', color: colors.status.working },
  idle: { name: 'circle', color: colors.status.idle },
  closed: { name: 'x-circle', color: colors.status.closed },
} as const;

export function StatusGlyph({ state, size = 14 }: { state: AgentState; size?: 12 | 14 | 16 | 20 | 24 }) {
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
  const icon = <Icon name={ICON[state].name} size={size} color={ICON[state].color} accessibilityLabel={label} />;
  if (state !== 'working') return icon;
  return <Animated.View style={{ opacity: pulse }}>{icon}</Animated.View>;
}
