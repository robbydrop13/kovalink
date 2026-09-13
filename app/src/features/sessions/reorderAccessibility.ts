// VoiceOver ne glisse pas : la ligne, la carte et l'en-tête d'onglet portent des actions
// « Move up » / « Move down » qui font le même déplacement, un rang à la fois.
import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native';
import { t } from '@/i18n/en';

export interface ReorderActions {
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
}

/** Les props d'accessibilité à étaler sur le `Pressable` ; rien quand le glisser est coupé. */
export function reorderAccessibility(reorder: ReorderActions | undefined): {
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
} {
  if (!reorder) return {};
  const actions: AccessibilityActionInfo[] = [];
  if (reorder.canUp) actions.push({ name: 'moveUp', label: t.reorderMoveUp });
  if (reorder.canDown) actions.push({ name: 'moveDown', label: t.reorderMoveDown });
  if (actions.length === 0) return {};
  return {
    accessibilityActions: actions,
    onAccessibilityAction: (e) => {
      if (e.nativeEvent.actionName === 'moveUp') reorder.onMove(-1);
      else if (e.nativeEvent.actionName === 'moveDown') reorder.onMove(1);
    },
  };
}
