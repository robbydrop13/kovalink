import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { ImpactStyle, impact } from '@/utils/haptics';
import { colors, layout, radius } from '@/theme';
import { Txt } from './Txt';
import { Icon, type IconName } from './Icon';

export type ButtonKind = 'primary' | 'secondary' | 'interrupt' | 'destructive';

interface Props {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  height?: number;
  style?: ViewStyle;
  /** Icône Feather devant le libellé. */
  icon?: IconName;
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
  icon,
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
      {icon ? <Icon name={icon} size={20} color={labelColor(kind, disabled)} /> : null}
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

/**
 * Bouton rond, icône seule : les actions de la barre basse (Panes, New session, Next).
 * Pas de libellé visible, il est porté par `accessibilityLabel`. Un point de compteur
 * optionnel en haut à droite (les non lus).
 */
export function RoundButton({
  icon,
  label,
  onPress,
  kind = 'secondary',
  disabled = false,
  size = layout.touchPrimary,
  badge,
  accessibilityHint,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  size?: number;
  badge?: number;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        impact(ImpactStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2 },
        kindStyle(kind, pressed, disabled),
      ]}
    >
      <Icon name={icon} size={20} color={labelColor(kind, disabled)} />
      {badge !== undefined && badge > 0 ? (
        <Txt variant="caption" color={colors.bg.base} style={styles.badge}>
          {badge > 99 ? '99+' : String(badge)}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/** Lien secondaire de 32 pt, cible tactile étendue par `hitSlop`. */
export function LinkAction({
  label,
  onPress,
  color = colors.accent.primary,
  disabled = false,
  accessibilityHint,
  icon,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  accessibilityHint?: string;
  /** Icône Feather devant le libellé. */
  icon?: IconName;
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
      {icon ? <Icon name={icon} size={14} color={disabled ? colors.text.disabled : color} /> : null}
      <Txt variant="footnote" color={disabled ? colors.text.disabled : color}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  round: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    lineHeight: 16,
    paddingHorizontal: 4,
    textAlign: 'center',
    borderRadius: 10,
    overflow: 'hidden',
    // Ambre sur texte sombre, avec un liseré couleur écran : lisible sur le bouton bleu
    // comme sur le gris, là où un bleu sur bleu se fondait dans le fond.
    backgroundColor: colors.status.awaiting,
    borderWidth: 2,
    borderColor: colors.bg.base,
    fontWeight: '700',
  },
  base: {
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  link: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
});
