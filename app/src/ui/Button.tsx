import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { ImpactStyle, impact } from '@/utils/haptics';
import { colors, layout, radius } from '@/theme';
import { Txt } from './Txt';

export type ButtonKind = 'primary' | 'secondary' | 'interrupt' | 'destructive';

interface Props {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  height?: number;
  style?: ViewStyle;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled = false,
  height = layout.touchPrimary,
  style,
  accessibilityHint,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint ?? ''}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        impact(ImpactStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [styles.base, { height }, kindStyle(kind, pressed, disabled), style]}
    >
      <Txt variant="bodyStrong" color={labelColor(kind, disabled)} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

function kindStyle(kind: ButtonKind, pressed: boolean, disabled: boolean): ViewStyle {
  if (disabled) return { backgroundColor: colors.bg.raised, borderWidth: 0 };
  switch (kind) {
    case 'primary':
      return { backgroundColor: pressed ? colors.accent.primaryPressed : colors.accent.primary };
    case 'secondary':
      return {
        backgroundColor: pressed ? colors.bg.pressed : colors.bg.overlay,
        borderWidth: 1,
        borderColor: colors.border.strong,
      };
    case 'interrupt':
      return {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.action.interrupt.border,
      };
    case 'destructive':
      return {
        backgroundColor: pressed ? colors.action.reject.bgPressed : colors.action.reject.bg,
      };
    default:
      return {};
  }
}

function labelColor(kind: ButtonKind, disabled: boolean): string {
  if (disabled) return colors.text.disabled;
  if (kind === 'interrupt') return colors.action.interrupt.text;
  if (kind === 'secondary') return colors.text.primary;
  return colors.text.onFill;
}

/** Lien secondaire de 32 pt, cible tactile étendue par `hitSlop`. */
export function LinkAction({
  label,
  onPress,
  color = colors.accent.primary,
  disabled = false,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8, left: 10, right: 10 }}
      onPress={onPress}
      style={styles.link}
    >
      <Txt variant="footnote" color={disabled ? colors.text.disabled : color}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  link: { minHeight: 32, justifyContent: 'center' },
});
