// Bouton d'option de la barre de validation.
//
// Règle vérifiable à la revue de code : le nombre imprimé dans le badge EST la valeur
// envoyée (`optionIndex`). Le badge n'est pas une décoration, c'est la représentation
// visible de la charge utile. S'ils divergent, c'est un bug bloquant.
//
// La POSITION est dérivée de l'`index`, jamais du `kind` (B8, P3). Le `kind` ne pilote que
// la teinte : une erreur de l'heuristique fait au pire un bouton mal coloré, jamais un
// bouton mal placé.
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { ImpactStyle, impact } from '@/utils/haptics';
import type { PromptOption } from '@/protocol';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { t } from '@/i18n/en';

interface Props {
  option: PromptOption;
  height: number;
  /** Gabarit C : aucune teinte sémantique n'est devinée, tout est neutre. */
  forceNeutral?: boolean;
  sending: boolean;
  disabled: boolean;
  confirming?: boolean;
  onPress: () => void;
  style?: ViewStyle;
}

function fill(kind: PromptOption['kind'], pressed: boolean, neutral: boolean) {
  if (neutral) return { bg: colors.action.neutral.bg, text: colors.action.neutral.text };
  switch (kind) {
    case 'approve':
      return {
        bg: pressed ? colors.action.approve.bgPressed : colors.action.approve.bg,
        text: colors.action.approve.text,
      };
    case 'reject':
      return {
        bg: pressed ? colors.action.reject.bgPressed : colors.action.reject.bg,
        text: colors.action.reject.text,
      };
    case 'approve_always':
      return { bg: colors.action.always.bg, text: colors.action.always.text };
    default:
      return { bg: colors.action.neutral.bg, text: colors.action.neutral.text };
  }
}

export function OptionButton({
  option,
  height,
  forceNeutral = false,
  sending,
  disabled,
  confirming = false,
  onPress,
  style,
}: Props) {
  const outlined = option.kind === 'approve_always' && !forceNeutral && !confirming;
  const label = confirming ? t.optionConfirmAlways : option.label;

  return (
    <Pressable
      accessibilityRole="button"
      // VoiceOver énonce le chiffre puis le libellé : l'information n'est jamais portée par
      // la seule couleur (design 7.4).
      accessibilityLabel={t.optionAccessibilityLabel(option.index, label)}
      accessibilityState={{ disabled: disabled || sending }}
      disabled={disabled || sending}
      onPress={() => {
        impact(ImpactStyle.Medium);
        onPress();
      }}
      style={({ pressed }) => {
        const f = confirming
          ? { bg: colors.action.approve.bg, text: colors.action.approve.text }
          : fill(option.kind, pressed, forceNeutral);
        return [
          styles.button,
          { height, backgroundColor: outlined ? colors.action.always.bg : f.bg },
          outlined && { borderWidth: 1, borderColor: colors.action.always.border },
          pressed && !disabled && styles.pressed,
          (disabled || sending) && styles.disabled,
          style,
        ];
      }}
    >
      <View style={styles.badge}>
        {sending ? (
          <Txt variant="caption" color={colors.text.onFill}>
            …
          </Txt>
        ) : (
          <Txt variant="caption" color={colors.text.onFill}>
            {option.index}
          </Txt>
        )}
      </View>
      <Txt
        variant="bodyStrong"
        numberOfLines={1}
        color={
          confirming
            ? colors.action.approve.text
            : outlined
              ? colors.action.always.text
              : fill(option.kind, false, forceNeutral).text
        }
        style={styles.label}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    gap: space[4],
  },
  pressed: { transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.5 },
  badge: {
    width: 20,
    height: 20,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  label: { flex: 1, textAlign: 'center' },
});
