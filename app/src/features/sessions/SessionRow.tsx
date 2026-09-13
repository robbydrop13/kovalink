// Ligne d'un pane SOUS son onglet Kova : titre du pane, projet et agent, état en badge.
//
// `Interrompre` est présent sur un pane qui travaille parce que le scénario S3 (l'agent est
// parti de travers) décrit un pane `working: true`, pas un pane `awaiting` : le geste le
// plus urgent du produit ne doit pas demander d'ouvrir la session (C21, C32). Ouvrir une
// session bascule l'onglet sur le Mac (réglage « Suivre sur le Mac ») : c'est le Cmd+P de
// Kova, aucun lien séparé n'est nécessaire.
import { Pressable, StyleSheet, View } from 'react-native';
import type { Pane, Prompt } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { LinkAction } from '@/ui/Button';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { Txt } from '@/ui/Txt';
import { shortAge } from '@/utils/time';
import { PermissionNote, bypassAccessibilitySuffix } from './PaneIdentity';
import { isStaleSession } from './tabGroups';
import { t } from '@/i18n/en';

interface Props {
  pane: Pane;
  prompt?: Prompt | undefined;
  /** Cmd+J : non lu sur ce téléphone, badge sur fond accent avec un point plein (P4). */
  unread?: boolean;
  onOpen: () => void;
  /** Session périmée : relancer Claude dans ce dossier (feuille « Nouvelle session »). */
  onRelaunch?: () => void;
  onInterrupt?: () => void;
  interruptDisabled?: boolean;
  interruptLabel?: string;
}

/**
 * Libellé d'état en badge : attend, travaille, terminé il y a N, inactif, session périmée
 * (agent perdu par Kova mais `claude` encore en processus enfant), ou shell sans agent.
 */
export function paneBadge(pane: Pane, prompt: Prompt | undefined, now = Date.now()): string {
  if (pane.awaiting) return t.paneBadgeWaiting;
  if (pane.working) return t.paneBadgeWorking;
  if (pane.launching) return t.paneBadgeStarting;
  if (isStaleSession(pane)) return t.paneBadgeStale;
  if (prompt?.state === 'turn_end') return t.paneBadgeDone(shortAge(prompt.endedAt, now));
  return pane.agent ? t.paneBadgeIdle : t.paneBadgeShell;
}

/** Un pane sans agent s'ouvre sur la vue Term : il n'y a pas de transcript à montrer. */
export function paneHref(pane: Pane): string {
  return pane.agent ? `/session/${pane.id}` : `/session/${pane.id}?view=term`;
}

/** Titre d'un pane tel que Kova le montre, le projet venant en sous-titre. */
export function paneLabel(pane: Pane): string {
  // Le nom de session Claude (`/rename`) prime sur le titre generique du pane.
  return pane.agent_session_name ?? pane.title ?? pane.agent ?? t.paneFallbackTitle;
}

export function SessionRow({
  pane,
  prompt,
  unread = false,
  onOpen,
  onRelaunch,
  onInterrupt,
  interruptDisabled = false,
  interruptLabel = t.interruptLabel,
}: Props) {
  const working = pane.working;
  const starting = pane.launching;
  const stale = isStaleSession(pane);
  const badge = paneBadge(pane, prompt);
  const subtitle = pane.agent && pane.agent !== pane.title ? `${pane.projectName} · ${pane.agent}` : pane.projectName;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.paneRowAccessibilityLabel(paneLabel(pane), pane.projectName, badge, bypassAccessibilitySuffix(pane.permissionMode))}
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.glyph}>
        <StatusGlyph state={working || starting ? 'working' : 'idle'} />
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1} style={styles.title}>
            {paneLabel(pane)}
          </Txt>
          <View style={[styles.badge, (working || starting) && styles.badgeWorking, stale && styles.badgeStale, unread && styles.badgeUnread]}>
            {unread ? <View style={styles.unreadDot} /> : null}
            <Txt
              variant="caption"
              color={unread ? colors.accent.primary : working || starting ? colors.status.working : stale ? colors.status.awaiting : colors.text.tertiary}
            >
              {badge}
            </Txt>
          </View>
        </View>
        <Txt variant="footnote" color={colors.text.secondary} numberOfLines={1}>
          {subtitle}
        </Txt>
        <PermissionNote mode={pane.permissionMode} />
        <View style={styles.actions}>
          {stale && onRelaunch ? <LinkAction icon="refresh-cw" label={t.paneRelaunchClaude} onPress={onRelaunch} /> : null}
          {working && onInterrupt ? (
            <LinkAction
              icon="square"
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
  badgeUnread: { backgroundColor: colors.accent.subtleBg, flexDirection: 'row', alignItems: 'center', gap: 5 },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent.primary },
  badgeStale: { backgroundColor: colors.status.awaitingBg },
  actions: { flexDirection: 'row', gap: space[6], marginTop: space[1] },
});
