// « Thinking… » avec un reflet lumineux qui balaye le texte de gauche à droite en boucle
// (1,6 s par cycle, courbe douce), comme l'indicateur de Claude : sans lui, on se demande
// s'il se passe vraiment quelque chose. Couvre l'attente AVANT que le texte n'arrive ; le
// point pulsant reste pour un tour en cours de rédaction.
//
// Pas de masque de dégradé dans ce build natif (ni reanimated, ni expo-linear-gradient) :
// une bande claire semi-transparente traverse le texte dans un conteneur à débordement
// caché, avec l'`Animated` de React Native sur le fil natif. `reduceMotion` iOS : trois
// points animés lentement, sans balayage.
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, space } from '@/theme';
import { Txt } from '@/ui/Txt';

const CYCLE_MS = 1600;
const BAND_WIDTH = 56;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduce(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

function Dots() {
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(phase, { toValue: 3, duration: 2400, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: phase.interpolate({
                inputRange: [i, i + 0.5, i + 1, 3],
                outputRange: [0.3, 1, 0.3, 0.3],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

export function Shimmer({ label }: { label: string }) {
  const reduce = useReduceMotion();
  const [x] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (reduce || width === 0) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: CYCLE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, width, x]);

  return (
    <View style={styles.wrap} accessibilityLabel={label} accessibilityLiveRegion="polite">
      <View style={styles.textBox} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Txt variant="footnote" color={colors.text.secondary}>
          {label}
        </Txt>
        {!reduce && width > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.band,
              {
                transform: [
                  { translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-BAND_WIDTH, width + BAND_WIDTH] }) },
                  { rotate: '12deg' },
                ],
              },
            ]}
          />
        ) : null}
      </View>
      {reduce ? <Dots /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  textBox: { overflow: 'hidden', paddingHorizontal: space[1], borderRadius: 4 },
  band: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    width: BAND_WIDTH,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: BAND_WIDTH / 2,
  },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.text.secondary },
});
