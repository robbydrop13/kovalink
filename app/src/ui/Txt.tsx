// Texte typé sur les tokens. Aucun `fontSize` en dur ailleurs dans l'app.
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { MONO_FAMILY, type, type TypeToken } from '@/theme';

interface Props extends TextProps {
  variant?: TypeToken;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
}

/**
 * Inter, embarquée par le plugin `expo-font` : sur iOS une famille ajoutée ne synthétise
 * pas ses graisses, chaque graisse est donc sa propre famille (nom PostScript).
 */
export function interFamily(weight: string | undefined): string {
  const w = Number(weight ?? 400);
  if (w >= 700) return 'Inter-Bold';
  if (w >= 600) return 'Inter-SemiBold';
  if (w >= 500) return 'Inter-Medium';
  return 'Inter-Regular';
}

export function Txt({ variant = 'body', color, align, style, ...rest }: Props) {
  const t = type[variant];
  const isMono = 'mono' in t && t.mono === true;
  return (
    <Text
      {...rest}
      // Les tokens mono sont exclus de la mise à l'échelle Dynamic Type et fixés en dur.
      allowFontScaling={!isMono}
      style={[
        {
          fontSize: t.size,
          lineHeight: t.line,
          letterSpacing: t.tracking,
          fontFamily: isMono ? MONO_FAMILY : interFamily(t.weight),
          ...(color ? { color } : {}),
          ...(align ? { textAlign: align } : {}),
        },
        style,
      ]}
    />
  );
}
