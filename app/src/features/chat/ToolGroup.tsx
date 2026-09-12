// Groupe d'actions consécutives : « 8 actions », replié, un tap le déplie en lignes.
//
// Le résumé d'état à droite est celui du pire cas : un échec l'emporte sur un « en cours »,
// qui l'emporte sur « terminé ». Quand le groupe est court, les lignes sont montrées
// directement : un en-tête pour trois actions coûterait un tap sans rien cacher.
//
// Ce que Robin déplie ou replie à la main est mémorisé dans le store de session, par
// identifiant du premier appel du groupe, jamais par position (docs/13, point 9), et rien
// ne se replie tout seul dans le temps ni à l'arrivée d'un événement (point 10).
import { Pressable, StyleSheet, View } from 'react-native';
import type { ToolResultBlock, ToolUseBlock } from '@/protocol';
import { colors, radius, space } from '@/theme';
import { useSession } from '@/store/session';
import { Txt } from '@/ui/Txt';
import { StateGlyph, TOOL_ROW_HEIGHT, ToolRow } from './ToolRow';
import { groupState, isCollapsible, isEditTool, toolRowState } from './toolLabel';


interface Props {
  calls: ToolUseBlock[];
  results: ReadonlyMap<string, ToolResultBlock>;
  working: boolean;
}

export function ToolGroup({ calls, results, working }: Props) {
  const states = calls.map((c) => {
    const r = results.get(c.id);
    return toolRowState(r !== undefined, r?.isError === true, working);
  });
  const summary = groupState(states);
  // Un échec ou une modification de fichier ne se cache pas derrière un en-tête.
  const mustShow = summary === 'failed' || calls.some((c) => isEditTool(c.name));
  const groupId = calls[0]?.id ?? '';
  const chosen = useSession((s) => s.groupsOpen[groupId]);
  const setGroupOpen = useSession((s) => s.setGroupOpen);
  const open = chosen ?? mustShow;
  const setOpen = (next: boolean) => setGroupOpen(groupId, next);
  const collapsible = isCollapsible(calls.length);

  if (!collapsible || open) {
    return (
      <View style={styles.group}>
        {collapsible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: true }}
            onPress={() => setOpen(false)}
            style={styles.header}
          >
            <StateGlyph state={summary} />
            <Txt variant="footnote" color={colors.text.tertiary}>
              {`${calls.length} actions`}
            </Txt>
            <Txt variant="footnote" color={colors.text.tertiary}>
              replier
            </Txt>
          </Pressable>
        ) : null}
        {calls.map((call) => (
          <ToolRow key={call.id} call={call} result={results.get(call.id)} working={working} />
        ))}
      </View>
    );
  }

  const done = states.filter((s) => s === 'done').length;
  const failed = states.filter((s) => s === 'failed').length;
  const detail =
    summary === 'running'
      ? `${done} sur ${calls.length} terminées`
      : failed > 0
        ? `${failed} en échec`
        : summary === 'done'
          ? 'terminées'
          : '';
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        accessibilityLabel={`${calls.length} actions, ${detail}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <StateGlyph state={summary} />
        <Txt variant="action" color={colors.text.secondary}>
          {`${calls.length} actions`}
        </Txt>
        <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1} style={styles.detail}>
          {detail}
        </Txt>
        <Txt variant="footnote" color={colors.text.tertiary}>
          {'>'}
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    marginVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
    paddingVertical: space[1],
  },
  header: {
    height: TOOL_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  detail: { flex: 1 },
});
