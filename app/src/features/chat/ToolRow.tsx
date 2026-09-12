// Ligne d'action compacte, convention de l'app Claude (docs/13-chat-lisibilite.md, point 3).
//
// Une hauteur fixe de 36 pt : glyphe, verbe, cible, état à droite. En cours : point qui
// pulse. Terminé : coche. Échec : croix rouge. Un tap déplie le résultat, replié par défaut,
// sauf pour les modifications de fichiers et les échecs, que Robin doit voir (design 4.2).
//
// L'état de droite n'existe que grâce à la jointure `tool_use` vers `tool_result` faite
// par l'écran (F1) : sans résultat rattaché, tout serait « en cours » pour toujours.
import { useEffect, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { ToolResultBlock, ToolUseBlock } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, motion, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { isEditTool, toolLabel, toolRowState, type ToolRowState } from './toolLabel';

const MAX_LINES = 40;
export const TOOL_ROW_HEIGHT = 36;

interface Props {
  call: ToolUseBlock;
  result: ToolResultBlock | undefined;
  /** Le pane travaille encore : un appel sans résultat est « en cours ». */
  working: boolean;
}

export function ToolRow({ call, result, working }: Props) {
  const state = toolRowState(result !== undefined, result?.isError === true, working);
  const [open, setOpen] = useState(state === 'failed' || isEditTool(call.name));
  const label = toolLabel(call);
  const body = result?.preview ?? '';
  const lines = body.split('\n');
  const shown = lines.slice(0, MAX_LINES).join('\n');
  const hidden = Math.max(0, lines.length - MAX_LINES);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t.toolRowA11y(label.verb, label.target, STATE_LABEL[state])}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <StateGlyph state={state} />
        <Txt variant="action" color={colors.text.secondary}>
          {label.verb}
        </Txt>
        <Txt variant="action" color={colors.text.primary} numberOfLines={1} style={styles.target}>
          {label.target}
        </Txt>
        {label.stats ? (
          <Txt variant="footnote" color={colors.text.tertiary}>
            {label.stats}
          </Txt>
        ) : null}
        {state === 'failed' ? (
          <Txt variant="caption" color={colors.status.error}>
            {t.toolStateFailed}
          </Txt>
        ) : null}
      </Pressable>

      {open && body.length > 0 ? (
        <View style={styles.body}>
          {/* Défilement horizontal, jamais de retour à la ligne : un résultat est du code. */}
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <Txt variant="monoCode" color={result?.isError ? colors.status.error : colors.text.secondary}>
              {shown}
            </Txt>
          </ScrollView>
          {hidden > 0 ? (
            <Txt variant="caption" color={colors.text.tertiary}>
              {t.toolRowMoreLines(hidden)}
            </Txt>
          ) : null}
          {result?.truncated ? (
            <Txt variant="caption" color={colors.text.tertiary}>
              {t.toolRowTruncated}
            </Txt>
          ) : null}
        </View>
      ) : null}
      {open && body.length === 0 && state === 'done' ? (
        <View style={styles.body}>
          <Txt variant="caption" color={colors.text.tertiary}>
            {t.toolRowNoOutput}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const STATE_LABEL: Record<ToolRowState, string> = {
  running: t.toolStateRunning,
  done: t.toolStateDone,
  failed: t.toolStateFailed,
  unknown: t.toolStateUnknown,
};

/** Glyphe d'état, décodable par la forme et pas seulement la couleur (P4). */
export function StateGlyph({ state }: { state: ToolRowState }) {
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (state !== 'running') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: motion.pulse / 2, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.pulse / 2, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  if (state === 'running') {
    return <Animated.View style={[styles.dot, { backgroundColor: colors.status.working, opacity: pulse }]} />;
  }
  if (state === 'done') {
    return (
      <Txt variant="footnote" color={colors.status.success} style={styles.glyph}>
        ✓
      </Txt>
    );
  }
  if (state === 'failed') {
    return (
      <Txt variant="footnote" color={colors.status.error} style={styles.glyph}>
        ✕
      </Txt>
    );
  }
  return <View style={[styles.dot, styles.dotHollow]} />;
}

const styles = StyleSheet.create({
  row: {
    height: TOOL_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  target: { flexShrink: 1 },
  glyph: { width: 14, textAlign: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 3 },
  dotHollow: { borderWidth: 1.5, borderColor: colors.text.disabled },
  body: {
    gap: space[3],
    padding: space[4],
    marginLeft: space[6],
    marginBottom: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.bg.inset,
  },
});
