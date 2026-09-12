// Icônes de l'interface : Feather via `@expo/vector-icons` (livré avec Expo, aucune
// bibliothèque ajoutée, compatible OTA). SEUL point d'import de Feather : les écrans
// prennent `Icon`, jamais un glyphe textuel (`v`, `o`, `>`, `···`, `✓`...) que
// `scripts/check-icons.sh` interdit. Trois tailles du design : 16, 20, 24.
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { colors } from '@/theme';

export type IconName = ComponentProps<typeof Feather>['name'];
export type IconSize = 12 | 14 | 16 | 20 | 24;

export function Icon({
  name,
  size = 16,
  color = colors.text.secondary,
  accessibilityLabel,
}: {
  name: IconName;
  size?: IconSize;
  color?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Feather
      name={name}
      size={size}
      color={color}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'auto' : 'no-hide-descendants'}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
    />
  );
}
