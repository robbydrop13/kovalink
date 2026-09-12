// Fil d'Ariane. Défile horizontalement et se recale toujours à droite : le segment
// courant doit être visible sans geste, c'est lui qui dit où on est.
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { breadcrumb } from './format';

export function Breadcrumb({
  path,
  home,
  onNavigate,
}: {
  path: string;
  home: string | null;
  onNavigate: (path: string) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const segments = breadcrumb(path, home);

  useEffect(() => {
    // Sans ce recalage, un chemin profond affiche `~ / dev / projet-a …` et cache
    // précisément le dossier dans lequel on vient d'entrer.
    const timer = setTimeout(() => ref.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [path]);

  return (
    <View style={styles.bar}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {segments.map((segment, i) => {
          const current = i === segments.length - 1;
          return (
            <View key={segment.path} style={styles.segment}>
              {i > 0 ? (
                <Txt variant="footnote" color={colors.text.tertiary}>
                  /
                </Txt>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Aller dans ${segment.label}`}
                disabled={current}
                hitSlop={{ top: 8, bottom: 8 }}
                onPress={() => onNavigate(segment.path)}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              >
                <Txt
                  variant="monoPath"
                  color={current ? colors.text.primary : colors.accent.primary}
                  numberOfLines={1}
                >
                  {segment.label}
                </Txt>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 36,
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
  },
  content: { alignItems: 'center', paddingHorizontal: space[4], gap: space[1] },
  segment: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  chip: { paddingHorizontal: space[2], paddingVertical: space[2], borderRadius: radius.xs },
  pressed: { backgroundColor: colors.bg.pressed },
});
