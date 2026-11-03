// Barre d'onglets de l'accueil (P02) : Panes, Asks, Agents, Scheduled, et au milieu le
// bouton dictee qui ouvre claap-agent micro lance. 49 pt de contenu,
// plus l'encoche basse. Elle est posee par dessus l'ecran : la liste de Panes reserve sa
// hauteur dans son padding bas, sinon la derniere ligne passe dessous.
//
// Le badge des Asks compte les questions dues. D01 fera entrer `waitsOnYou` par le
// protocole, ce compteur deviendra la somme des deux.
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/theme';
import { Icon, type IconName } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { t } from '@/i18n/en';
import type { HomeTab } from '@/store/homeTab';

/** Hauteur du contenu de la barre, hors encoche basse. */
export const TAB_BAR_HEIGHT = 49;

const TABS: readonly { key: HomeTab; icon: IconName; label: string }[] = [
  { key: 'panes', icon: 'sidebar', label: t.homeTabPanes },
  { key: 'asks', icon: 'message-circle', label: t.homeTabAsks },
  { key: 'agents', icon: 'users', label: t.homeTabAgents },
  { key: 'scheduled', icon: 'clock', label: t.homeTabScheduled },
];

export function TabBar({
  active,
  onSelect,
  askCount,
  scheduledFailed = false,
  onDictate,
}: {
  active: HomeTab;
  onSelect: (tab: HomeTab) => void;
  /** Questions dues, celles que l'onglet Asks ouvre. */
  askCount: number;
  /** Une routine active a echoue : un point rouge, comme sur le Mac. */
  scheduledFailed?: boolean;
  /** Bouton du milieu : dicter un message a claap-agent. */
  onDictate: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
      {TABS.flatMap((item, index) => {
        const selected = item.key === active;
        const tint = selected ? colors.accent.primary : colors.text.tertiary;
        const badge = item.key === 'asks' ? askCount : 0;
        const tab = (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={item.key === 'asks' ? t.homeTabAsksA11y(askCount) : item.label}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <View>
              <Icon name={item.icon} size={22} color={tint} />
              {badge > 0 ? (
                <View style={styles.badge}>
                  <Txt variant="caption" color={colors.text.onFill}>
                    {badge > 99 ? '99+' : String(badge)}
                  </Txt>
                </View>
              ) : null}
              {item.key === 'scheduled' && scheduledFailed ? <View style={styles.dot} /> : null}
            </View>
            <Txt variant="tabLabel" color={tint}>
              {item.label}
            </Txt>
          </Pressable>
        );
        if (index !== 1) return [tab];
        return [
          tab,
          <View key="dictate" style={styles.tab}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.homeDictateA11y}
              onPress={onDictate}
              style={({ pressed }) => [styles.dictate, pressed && styles.pressed]}
            >
              <Icon name="mic" size={22} color={colors.text.onFill} />
            </Pressable>
          </View>,
        ];
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.bg.raised,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  tab: {
    flex: 1,
    height: TAB_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  pressed: { opacity: 0.7 },
  dictate: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.primary,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: radius.full,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.primary,
    borderWidth: 1.5,
    borderColor: colors.bg.raised,
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.status.error,
  },
});
