// Ligne d'un pane SOUS son onglet Kova (P03, vue Panes du prototype) : deux lignes dans la
// carte de l'onglet, le titre puis la pastille d'état et son mot. Les lignes d'un même
// onglet sont séparées par un filet b3 enfoncé de 16 px, jamais après la dernière.
//
// Les actions d'urgence (relancer une session perdue, interrompre un pane qui travaille)
// restent sur la ligne d'état : elles ne doivent pas demander d'ouvrir la session.
// `Interrompre` est présent sur un pane qui travaille parce que le scénario S3 (l'agent est
// parti de travers) décrit un pane `working: true`, pas un pane `awaiting` : le geste le
// plus urgent du produit ne doit pas demander d'ouvrir la session (C21, C32). Ouvrir une
// session bascule l'onglet sur le Mac (réglage « Suivre sur le Mac ») : c'est le Cmd+P de
// Kova, aucun lien séparé n'est nécessaire.
import { Pressable, StyleSheet, View } from 'react-native';
import type { Pane, Prompt } from '@/protocol';
import { colors, space } from '@/theme';
import { LinkAction } from '@/ui/Button';
import { StatusGlyph, type AgentState } from '@/ui/StatusGlyph';
import { Txt, interFamily } from '@/ui/Txt';
import { shortAge, shortAgeMs } from '@/utils/time';
import { usePanes } from '@/store/panes';
import { bypassAccessibilitySuffix } from './PaneIdentity';
import { isStaleSession } from './tabGroups';
import { reorderAccessibility, type ReorderActions } from './reorderAccessibility';
import { t } from '@/i18n/en';
import { useClock } from '@/utils/useClock';

interface Props {
  pane: Pane;
  prompt?: Prompt | undefined;
  /** Cmd+J : non lu sur ce téléphone, point accent sur la ligne du titre. */
  unread?: boolean;
  onOpen: () => void;
  /** Session périmée : relancer Claude dans ce dossier (feuille « Nouvelle session »). */
  onRelaunch?: () => void;
  /** Pane qui attend : `Answer` ouvre la question du pane, sinon le pane. */
  onAnswer?: () => void;
  onInterrupt?: () => void;
  interruptDisabled?: boolean;
  interruptLabel?: string;
  /** VoiceOver : « Move up » / « Move down », l'équivalent du glisser-déposer. */
  reorder?: ReorderActions | undefined;
  /** Dernière ligne de l'onglet : aucun filet sous elle. */
  last?: boolean;
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

interface StateLine {
  glyph: AgentState;
  label: string;
  color: string;
}

/**
 * La deuxième ligne d'une rangée : pastille, mot d'état et sa couleur. Le travail prend
 * l'info, l'attente l'ambre, tout le reste le tertiaire. Un pane en erreur n'existe pas
 * encore dans le protocole (D01 l'ajoute) : rien à peindre en crit pour l'instant.
 */
function stateLine(pane: Pane, prompt: Prompt | undefined, workingSince: number | undefined, now: number): StateLine {
  const waiting = shortAge(pane.awaiting_since, now);
  if (pane.awaiting) {
    return {
      glyph: 'awaiting',
      label: waiting ? `${t.paneBadgeWaiting} ${waiting}` : t.paneBadgeWaiting,
      color: colors.status.awaiting,
    };
  }
  if (pane.working) {
    return {
      glyph: 'working',
      label: workingSince === undefined ? t.paneBadgeWorking : `${t.paneBadgeWorking} ${shortAgeMs(now - workingSince)}`,
      color: colors.status.working,
    };
  }
  if (pane.launching) return { glyph: 'working', label: t.paneBadgeStarting, color: colors.status.working };
  if (isStaleSession(pane)) return { glyph: 'idle', label: t.paneBadgeStale, color: colors.text.tertiary };
  const label = prompt?.state === 'turn_end' ? t.paneBadgeDone(shortAge(prompt.endedAt, now)) : pane.agent ? t.paneBadgeIdle : t.paneBadgeShell;
  return { glyph: 'idle', label, color: colors.text.tertiary };
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
  onAnswer,
  onRelaunch,
  onInterrupt,
  interruptDisabled = false,
  interruptLabel = t.interruptLabel,
  reorder,
  last = false,
}: Props) {
  const working = pane.working;
  const stale = isStaleSession(pane);
  const workingSince = usePanes((s) => s.workingSince[pane.id]);
  const ticking = pane.awaiting || pane.working || pane.launching || prompt?.state === 'turn_end';
  const now = useClock(ticking, 15_000);
  const state = stateLine(pane, prompt, workingSince, now);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.paneRowAccessibilityLabel(paneLabel(pane), pane.projectName, paneBadge(pane, prompt), bypassAccessibilitySuffix(pane.permissionMode))}
      {...reorderAccessibility(reorder)}
      onPress={onOpen}
      style={({ pressed }) => [styles.row, last && styles.last, pressed && styles.pressed]}
    >
      <View style={styles.titleLine}>
        <Txt variant="callout" color={colors.text.primary} numberOfLines={1} style={styles.title}>
          {paneLabel(pane)}
        </Txt>
        {unread ? <View style={styles.unreadDot} /> : null}
      </View>
      <View style={styles.stateLine}>
        <StatusGlyph state={state.glyph} />
        <Txt variant="footnote" color={state.color} numberOfLines={1} style={styles.stateWord}>
          {state.label}
        </Txt>
        <View style={styles.spacer} />
        {onAnswer ? (
          <>
            <Txt variant="footnote" color={colors.text.tertiary}>
              ·
            </Txt>
            <LinkAction icon="corner-down-left" label={t.actionAnswer} onPress={onAnswer} />
          </>
        ) : null}
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
      {last ? null : <View style={styles.separator} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    // Fond de la carte : il masque les actions révélées par le glissement tant que la
    // ligne n'a pas bougé.
    backgroundColor: colors.bg.raised,
    minHeight: 52,
    paddingHorizontal: space[5],
    paddingVertical: space[2],
    justifyContent: 'center',
    gap: space[1],
  },
  pressed: { backgroundColor: colors.bg.pressed },
  /** Dernière ligne : ses coins bas suivent le rayon de la carte de l'onglet. */
  last: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  title: { flex: 1, fontFamily: interFamily('500') },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent.primary },
  stateLine: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 18 },
  stateWord: { flexShrink: 1 },
  spacer: { flex: 1 },
  // Enfonce de 16 px de chaque cote, sur toute la largeur de la carte.
  separator: { position: 'absolute', left: space[5], right: space[5], bottom: 0, height: 1, backgroundColor: colors.border.subtle },
});
