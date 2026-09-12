// Bandeau d'état fixe de la session (docs/13-chat-lisibilite.md, point 1).
//
// Toujours visible, sous le sous-titre : `Working · 1m 12s` avec un glyphe qui pulse,
// `Waiting for you`, `Done 3 min ago`, `Offline`. Robin doit savoir d'un coup
// d'oeil si le modèle travaille, sans chercher un indicateur de frappe en bas du fil.
import { StyleSheet, View } from 'react-native';
import { t } from '@/i18n/en';
import { colors, layout, space } from '@/theme';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { Txt } from '@/ui/Txt';
import { useClock } from '@/utils/useClock';
import { agentStatus, type AgentStatusInput } from './statusLabel';

export function AgentStatus(props: AgentStatusInput) {
  const now = useClock(props.working || props.finishedAt !== null);

  const { kind, label } = agentStatus(props, now);
  const color =
    kind === 'working'
      ? colors.status.working
      : kind === 'awaiting'
        ? colors.status.awaiting
        : kind === 'offline'
          ? colors.link.offline
          : kind === 'closed'
            ? colors.status.closed
            : colors.text.secondary;
  const glyph =
    kind === 'working' ? 'working' : kind === 'awaiting' ? 'awaiting' : kind === 'closed' ? 'closed' : 'idle';

  return (
    <View
      accessibilityRole="header"
      accessibilityLabel={t.statusA11y(label)}
      style={[styles.bar, { borderLeftColor: color }]}
    >
      <StatusGlyph state={glyph} size={10} />
      <Txt variant="calloutStrong" color={color} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: layout.screenPaddingH,
    borderLeftWidth: 3,
    backgroundColor: colors.bg.raised,
  },
});
