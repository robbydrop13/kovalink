// Retour haptique, toujours protégé.
//
// Chaque appel est un appel de module natif qui rend une promesse. Écrit `void
// Haptics.impactAsync(...)`, un rejet devient une promesse non gérée : dans le meilleur
// cas un avertissement rouge dans Metro, dans le pire un diagnostic perdu. Le retour
// haptique est un confort, il n'a jamais le droit de peser sur le geste qu'il accompagne.
import * as Haptics from 'expo-haptics';

export function impact(style: Haptics.ImpactFeedbackStyle): void {
  void Haptics.impactAsync(style).catch(() => undefined);
}

export function notify(type: Haptics.NotificationFeedbackType): void {
  void Haptics.notificationAsync(type).catch(() => undefined);
}

export const ImpactStyle = Haptics.ImpactFeedbackStyle;
export const NotifyType = Haptics.NotificationFeedbackType;
