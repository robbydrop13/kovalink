// Glyphe d'état. Chaque état est décodable par la FORME et la position, pas seulement par la
// couleur (P4) : losange plein pour `awaiting`, barre pleine animée pour `working`, cercle
// creux pour `idle`.
import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { colors, motion } from '@/theme';

export type AgentState = 'awaiting' | 'working' | 'idle' | 'closed';

export function StatusGlyph({ state, size = 12 }: { state: AgentState; size?: number }) {
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (state !== 'working') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: motion.pulse / 2,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 1, duration: motion.pulse / 2, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  if (state === 'awaiting') {
    return (
      <View
        accessibilityLabel="en attente"
        style={{
          width: size,
          height: size,
          backgroundColor: colors.status.awaiting,
          transform: [{ rotate: '45deg' }],
        }}
      />
    );
  }

  if (state === 'working') {
    return (
      <Animated.View
        accessibilityLabel="travaille"
        style={{
          width: size * 0.35,
          height: size,
          borderRadius: 2,
          backgroundColor: colors.status.working,
          opacity: pulse,
        }}
      />
    );
  }

  if (state === 'closed') {
    return (
      <View
        accessibilityLabel="fermé"
        style={{
          width: size * 0.5,
          height: size,
          borderRightWidth: 2,
          borderTopWidth: 2,
          borderBottomWidth: 2,
          borderColor: colors.status.closed,
        }}
      />
    );
  }

  return (
    <View
      accessibilityLabel="inactif"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: colors.status.idle,
      }}
    />
  );
}
