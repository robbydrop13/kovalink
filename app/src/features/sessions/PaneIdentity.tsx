// Identité d'un pane : point de couleur d'onglet Kova, `projet · titre`, badge de mode de
// permission.
import { StyleSheet, View } from 'react-native';
import { isBypassMode, type Pane, type PermissionMode } from '@/protocol';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { t } from '@/i18n/en';

function TabColorDot({ index }: { index: number | null | undefined }) {
  const tint =
    index === null || index === undefined ? null : (colors.tab[index] ?? colors.tabNone);
  if (!tint) return null;
  return <View style={[styles.dot, { backgroundColor: tint }]} />;
}

/** Texte explicatif du PRD (CA-07), affiché ET lu tel quel. */
const BYPASS_EXPLANATION = t.paneBypassExplanation;

/** La règle vit dans le protocole (`isBypassMode`) : `bypassPermissions`, et `auto` qui porte le même sens. */
function isBypass(mode: PermissionMode | null | undefined): boolean {
  return isBypassMode(mode ?? null);
}

/** Ce que VoiceOver doit ajouter au libellé d'une ligne ou d'une carte pour un pane en bypass. */
export function bypassAccessibilitySuffix(mode: PermissionMode | null | undefined): string {
  return isBypass(mode) ? t.paneBypassAccessibilitySuffix(BYPASS_EXPLANATION) : '';
}

/**
 * Badge `bypass` (CA-07). Sans lui, Robin ne comprendrait pas pourquoi ces sessions ne lui
 * demandent jamais rien, et le produit paraîtrait cassé. Le mode `auto` porte le même sens.
 */
function PermissionBadge({ mode }: { mode: PermissionMode | null }) {
  if (!isBypass(mode)) return null;
  return (
    <View accessible accessibilityLabel={t.paneBypassAccessibilityLabel(BYPASS_EXPLANATION)} style={styles.badge}>
      <Txt variant="caption" color={colors.text.secondary}>
        {t.paneBypassBadge}
      </Txt>
    </View>
  );
}

/**
 * Le texte du PRD, VISIBLE sous la ligne (CA-07). Il vivait seulement dans un
 * `accessibilityLabel`, donc nulle part pour qui n'utilise pas VoiceOver.
 */
export function PermissionNote({ mode }: { mode: PermissionMode | null }) {
  if (!isBypass(mode)) return null;
  return (
    <Txt variant="caption" color={colors.text.tertiary} numberOfLines={1}>
      {BYPASS_EXPLANATION}
    </Txt>
  );
}

export function PaneTitle({ pane }: { pane: Pane }) {
  return (
    <View style={styles.row}>
      <TabColorDot index={pane.color ?? null} />
      <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1} style={styles.title}>
        {pane.projectName} · {pane.agent_session_name ?? pane.title ?? pane.agent ?? t.paneFallbackTitle}
      </Txt>
      <PermissionBadge mode={pane.permissionMode} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flexShrink: 1 },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.overlay,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
});
