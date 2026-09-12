// « Thinking… » avec un reflet lumineux qui traverse LE TEXTE, caractère par caractère, de
// gauche à droite en boucle (1,6 s, courbe douce) : chaque glyphe passe de `text.tertiary`
// à `text.primary` quand la lumière le touche, le fond reste plat. Sans lui, on se demande
// s'il se passe vraiment quelque chose. Couvre l'attente AVANT que le texte n'arrive.
//
// Pas de masque dans ce build natif : `@react-native-masked-view/masked-view` n'est pas
// lié, et un masque de dégradé demanderait aussi `expo-linear-gradient`. À ajouter au
// prochain build pour le vrai masque ; d'ici là l'animation de couleur par caractère
// (`Animated` sur le fil JS, une seule valeur partagée, une interpolation par glyphe)
// donne le même mouvement continu. `reduceMotion` iOS : trois points animés lentement.
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, space } from '@/theme';
import { Txt } from '@/ui/Txt';

const CYCLE_MS = 1600;
/** Largeur du reflet, en fraction du texte : environ trois caractères éclairés à la fois. */
const BEAM = 0.18;

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
    const loop = Animated.loop(Animated.timing(phase, { toValue: 3, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
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
            { opacity: phase.interpolate({ inputRange: [i, i + 0.5, i + 1, 3], outputRange: [0.3, 1, 0.3, 0.3], extrapolate: 'clamp' }) },
          ]}
        />
      ))}
    </View>
  );
}

export function Shimmer({ label }: { label: string }) {
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const chars = [...label];

  useEffect(() => {
    if (reduce) return;
    progress.setValue(0);
    // La couleur n'est pas animable sur le fil natif : boucle JS, un seul `Animated.Value`.
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: CYCLE_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, progress, label]);

  if (reduce) {
    return (
      <View style={styles.wrap} accessibilityLabel={label} accessibilityLiveRegion="polite">
        <Txt variant="footnote" color={colors.text.secondary}>
          {label}
        </Txt>
        <Dots />
      </View>
    );
  }

  return (
    <View style={styles.wrap} accessibilityLabel={label} accessibilityLiveRegion="polite">
      <View style={styles.line} accessible={false}>
        {chars.map((c, i) => {
          // Position du glyphe dans le texte, de 0 à 1 ; le reflet va de -BEAM à 1+BEAM.
          const at = chars.length > 1 ? i / (chars.length - 1) : 0.5;
          const center = progress.interpolate({ inputRange: [0, 1], outputRange: [-BEAM, 1 + BEAM] });
          const color = Animated.subtract(center, at).interpolate({
            inputRange: [-BEAM, 0, BEAM],
            outputRange: [colors.text.tertiary, colors.text.primary, colors.text.tertiary],
            extrapolate: 'clamp',
          });
          return (
            <Animated.Text key={i} style={[styles.glyph, { color }]}>
              {c}
            </Animated.Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  line: { flexDirection: 'row', flexWrap: 'wrap' },
  glyph: { fontSize: 13, lineHeight: 18 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.text.secondary },
});
