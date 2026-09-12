// Balayage à la WhatsApp sur une ligne de session : vers la gauche, `Close` (rouge) et
// `Bookmark` (jaune) ; vers la droite, `Rename`. Les actions sont des boutons révélés,
// jamais un geste qui agit tout seul : fermer passe par sa confirmation.
import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { Icon, type IconName } from '@/ui/Icon';
import { ImpactStyle, impact } from '@/utils/haptics';
import { t } from '@/i18n/en';

export interface SwipeActions {
  onClose: () => void;
  onBookmark: () => void;
  onRename: () => void;
  bookmarked?: boolean;
}

const ACTION_WIDTH = 84;

function ActionButton({
  icon,
  label,
  color,
  textColor,
  onPress,
}: {
  icon: IconName;
  label: string;
  color: string;
  textColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: color }, pressed && styles.pressed]}
    >
      <Icon name={icon} size={20} color={textColor} />
      <Txt variant="footnote" color={textColor}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function SwipeRow({ actions, children }: { actions: SwipeActions; children: ReactNode }) {
  const ref = useRef<Swipeable>(null);
  const run = (fn: () => void): void => {
    ref.current?.close();
    fn();
  };
  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      rightThreshold={40}
      leftThreshold={40}
      onSwipeableWillOpen={() => impact(ImpactStyle.Light)}
      renderRightActions={() => (
        <View style={styles.group}>
          <ActionButton
            icon="star"
            label={actions.bookmarked ? t.swipeUnbookmark : t.swipeBookmark}
            color={colors.status.awaiting}
            textColor={colors.text.inverse}
            onPress={() => run(actions.onBookmark)}
          />
          <ActionButton icon="x" label={t.swipeClose} color={colors.action.reject.bg} textColor={colors.action.reject.text} onPress={() => run(actions.onClose)} />
        </View>
      )}
      renderLeftActions={() => (
        <View style={styles.group}>
          <ActionButton icon="edit-2" label={t.swipeRename} color={colors.accent.primary} textColor={colors.text.onFill} onPress={() => run(actions.onRename)} />
        </View>
      )}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[2] },
  action: { width: ACTION_WIDTH, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.md },
  pressed: { opacity: 0.8 },
});
