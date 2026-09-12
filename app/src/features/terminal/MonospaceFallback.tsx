// Repli monospace, lot 1.
//
// Ce n'est PAS xterm.js : c'est le texte de `get-pane-content` en `mode: "visible"`, rendu
// en monospace, non interactif, environ 30 lignes. Le terminal complet est en lot 2.
// A6 règle 2 en fait la destination obligatoire de l'état `unparsable`.
//
// `mode: "scrollback"` n'est jamais utilisé : il renvoie zéro octet sur un pane Claude Code,
// qui occupe l'écran alterné (A15).
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, layout, space } from '@/theme';
import { Txt } from '@/ui/Txt';

interface Props {
  /** Écran visible du pane, tel que le daemon l'a lu. Déjà nettoyé de l'ANSI. */
  screen: string;
  cols: number;
  rows: number;
  paneLabel: string;
  /** Vrai quand le pane est fermé, hors ligne ou injoignable : lecture seule signalée. */
  frozen?: string | null;
}

export function MonospaceFallback({ screen, cols, rows, paneLabel, frozen }: Props) {
  const lines = screen.split('\n').slice(-layout.monospaceFallbackLines);

  return (
    <View style={styles.wrap}>
      <View style={styles.info}>
        <Txt variant="footnote" color={colors.text.secondary} numberOfLines={1}>
          {paneLabel}
        </Txt>
        <View style={styles.grow} />
        <Txt variant="footnote" color={colors.text.tertiary}>
          {cols}x{rows}
        </Txt>
      </View>

      {frozen ? (
        <View style={styles.frozen}>
          <Txt variant="footnote" color={colors.text.tertiary}>
            {frozen}
          </Txt>
        </View>
      ) : null}

      {/* Défilement horizontal : le pane fait couramment plus de 200 colonnes, on ne
          rétrécit jamais le texte pour le faire rentrer (P4). */}
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.hscroll}>
        <ScrollView showsVerticalScrollIndicator>
          <Txt variant="monoTerminal" color={colors.text.primary} selectable>
            {lines.join('\n')}
          </Txt>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg.inset },
  info: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: layout.screenPaddingH,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  frozen: { paddingHorizontal: layout.screenPaddingH, paddingVertical: space[2] },
  hscroll: { flex: 1, padding: space[3] },
  grow: { flex: 1 },
});
