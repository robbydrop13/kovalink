// Texte typé sur les tokens. Aucun `fontSize` en dur ailleurs dans l'app.
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { MONO_FAMILY, type, type TypeToken } from '@/theme';

interface Props extends TextProps {
  variant?: TypeToken;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
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
          fontWeight: t.weight as TextStyle['fontWeight'],
          letterSpacing: t.tracking,
          ...(isMono ? { fontFamily: MONO_FAMILY } : {}),
          ...(color ? { color } : {}),
          ...(align ? { textAlign: align } : {}),
        },
        style,
      ]}
    />
  );
}
