// Le menu des commandes `/`, au-dessus de la barre de message : la carte du terminal de
// Claude Code, en tactile. Une ligne par commande, `/nom` en mono accentué, la
// description à droite, l'origine (`user`, `project`, `plugin`) en étiquette discrète.
// Toucher une ligne remplit le champ ; le clavier reste ouvert.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { SlashCommand } from '@/protocol';
import { t } from '@/i18n/en';
import { fetchCommands } from '@/net/http';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { matchCommands, sourceTag } from './slashCommands';

const ROW_HEIGHT = 44;
const VISIBLE_ROWS = 5.5;
const CACHE_MS = 60_000;

const cache = new Map<number, { at: number; commands: SlashCommand[] }>();

/**
 * Les commandes du pane, chargées à la première frappe de `/` et gardées une minute.
 * Un échec réseau donne une liste vide : le menu ne s'affiche pas, rien de plus.
 */
export function useSlashCommands(paneId: number, active: boolean): SlashCommand[] {
  const [commands, setCommands] = useState<SlashCommand[]>(() => cache.get(paneId)?.commands ?? []);
  useEffect(() => {
    if (!active) return;
    const hit = cache.get(paneId);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setCommands(hit.commands);
      return;
    }
    let alive = true;
    fetchCommands(paneId).then(
      (res) => {
        cache.set(paneId, { at: Date.now(), commands: res.commands });
        if (alive) setCommands(res.commands);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [paneId, active]);
  return commands;
}

export function SlashSuggestions({
  commands,
  query,
  onPick,
}: {
  commands: readonly SlashCommand[];
  query: string;
  onPick: (command: SlashCommand) => void;
}) {
  const items = matchCommands(commands, query);
  if (items.length === 0) return null;
  return (
    <View style={styles.card} accessibilityLabel={t.composerCommandsA11y}>
      <ScrollView
        style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS }}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
      >
        {items.map((c, i) => {
          const tag = sourceTag(c.source);
          return (
            <Pressable
              key={c.name}
              accessibilityRole="button"
              accessibilityLabel={`/${c.name}`}
              accessibilityHint={t.composerCommandHint(c.name)}
              onPress={() => onPick(c)}
              style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, pressed && styles.rowPressed]}
            >
              <Txt variant="monoCodeInline" color={colors.accent.primary} numberOfLines={1} style={styles.name}>
                /{c.name}
              </Txt>
              <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1} style={styles.desc}>
                {c.description}
              </Txt>
              {tag ? (
                <Txt variant="caption" color={colors.text.disabled} style={styles.tag}>
                  {tag}
                </Txt>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: space[3],
    borderRadius: radius.lg,
    backgroundColor: colors.bg.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: ROW_HEIGHT, paddingHorizontal: space[4] },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle },
  rowPressed: { backgroundColor: colors.bg.pressed },
  name: { flexShrink: 1 },
  desc: { flex: 1 },
  tag: { flexShrink: 0 },
});
