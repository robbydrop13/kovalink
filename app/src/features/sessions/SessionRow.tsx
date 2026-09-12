// Ligne d'un pane SOUS son onglet Kova : titre du pane, projet et agent, état en badge.
//
// `Interrompre` est présent sur un pane qui travaille parce que le scénario S3 (l'agent est
// parti de travers) décrit un pane `working: true`, pas un pane `awaiting` : le geste le
// plus urgent du produit ne doit pas demander d'ouvrir la session (C21, C32). `Sur le Mac`
// (`focus-pane`) est un lien visible, sans appui long : c'est le Cmd+P de Kova.
import { Pressable, StyleSheet, View } from 'react-native';
import type { Pane, Prompt } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { LinkAction } from '@/ui/Button';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { Txt } from '@/ui/Txt';
import { shortAge } from '@/utils/time';
import { PermissionNote, bypassAccessibilitySuffix } from './PaneIdentity';

interface Props {
  pane: Pane;
  prompt?: Prompt | undefined;
  onOpen: () => void;
  /** `Ouvrir sur le Mac` : `focus-pane`, en lien visible. */
  onOpenOnMac?: () => void;
  onInterrupt?: () => void;
  interruptDisabled?: boolean;
  interruptLabel?: string;
}

/** Libellé d'état en badge : travaille, terminé il y a N, inactif, ou shell sans agent. */
export function paneBadge(pane: Pane, prompt: Prompt | undefined, now = Date.now()): string {
  if (pane.awaiting) return 'attend';
  if (pane.working) return 'travaille';
  if (prompt?.state === 'turn_end') return `terminé il y a ${shortAge(prompt.endedAt, now)}`;
  return pane.agent ? 'inactif' : 'shell';
}

/** Titre d'un pane tel que Kova le montre, le projet venant en sous-titre. */
export function paneLabel(pane: Pane): string {
  return pane.title ?? pane.agent ?? 'pane';
}

export const OPEN_ON_MAC_LABEL = 'Sur le Mac';

export function SessionRow({
  pane,
  prompt,
  onOpen,
  onOpenOnMac,
  onInterrupt,
  interruptDisabled = false,
  interruptLabel = 'Interrompre',
}: Props) {
  const working = pane.working;
  const badge = paneBadge(pane, prompt);
  const subtitle = pane.agent && pane.agent !== pane.title ? `${pane.projectName} · ${pane.agent}` : pane.projectName;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${paneLabel(pane)}, ${pane.projectName}, ${badge}${bypassAccessibilitySuffix(pane.permissionMode)}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.glyph}>
        <StatusGlyph state={working ? 'working' : 'idle'} />
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1} style={styles.title}>
            {paneLabel(pane)}
          </Txt>
          <View style={[styles.badge, working && styles.badgeWorking]}>
            <Txt variant="caption" color={working ? colors.status.working : colors.text.tertiary}>
              {badge}
            </Txt>
          </View>
        </View>
        <Txt variant="footnote" color={colors.text.secondary} numberOfLines={1}>
          {subtitle}
        </Txt>
        <PermissionNote mode={pane.permissionMode} />
        <View style={styles.actions}>
          {onOpenOnMac ? <LinkAction label={OPEN_ON_MAC_LABEL} onPress={onOpenOnMac} /> : null}
          {working && onInterrupt ? (
            <LinkAction
              label={interruptLabel}
              color={colors.action.interrupt.text}
              disabled={interruptDisabled}
              onPress={onInterrupt}
            />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.rowMinHeight,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[4],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  glyph: { width: 14, alignItems: 'center', paddingTop: 5 },
  body: { flex: 1, gap: space[1] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  title: { flexShrink: 1, flex: 1 },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.bg.overlay,
  },
  badgeWorking: { backgroundColor: colors.status.workingBg },
  actions: { flexDirection: 'row', gap: space[6], marginTop: space[1] },
});
