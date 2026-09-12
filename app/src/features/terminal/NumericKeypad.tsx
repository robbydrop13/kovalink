// Pavé numérique, affiché UNIQUEMENT quand `awaiting` est vrai sur ce pane, c'est à dire
// quand on arrive ici depuis l'état `unparsable`. Il évite d'ouvrir le clavier système pour
// taper un seul chiffre.
//
// Lot 1 : chaque chiffre est inséré dans le composer et part par le chemin de texte libre,
// qui porte sa propre garde d'état et son Face ID. Le type énuméré de touches
// (`pane.sendKeys`) est en lot 2 : le promouvoir ici ramènerait `enter` et les chiffres dans
// le lot 1 par une porte dérobée.
import { Pressable, StyleSheet, View } from 'react-native';
import { ImpactStyle, impact } from '@/utils/haptics';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function NumericKeypad({ onDigit }: { onDigit: (digit: number) => void }) {
  return (
    <View style={styles.row}>
      {DIGITS.map((d) => (
        <Pressable
          key={d}
          accessibilityRole="button"
          accessibilityLabel={`Chiffre ${d}`}
          onPress={() => {
            impact(ImpactStyle.Light);
            onDigit(d);
          }}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
        >
          <Txt variant="monoCode" color={colors.text.primary}>
            {d}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.overlay,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  chip: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  pressed: { backgroundColor: colors.bg.pressed },
});
