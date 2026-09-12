// Carte EN ATTENTE.
//
// AUCUN bouton d'approbation ici (A7, P3) : approuver exige d'ouvrir la session et de lire
// la question. Un bouton `Oui` dans une liste permet d'autoriser une action dont on n'a pas
// lu l'énoncé, et c'est le scénario d'accident le plus probable de toute l'application.
// `Ouvrir` est proéminent à 60 pt, `Interrompre` est l'action secondaire.
import { Pressable, StyleSheet, View } from 'react-native';
import type { Pane, Prompt } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { Txt } from '@/ui/Txt';
import { shortAge } from '@/utils/time';
import { PaneTitle, PermissionNote, bypassAccessibilitySuffix } from './PaneIdentity';
import { t } from '@/i18n/en';

interface Props {
  pane: Pane;
  prompt: Prompt | undefined;
  onOpen: () => void;
  onInterrupt: () => void;
  interruptDisabled: boolean;
  interruptLabel: string;
  aging: boolean;
}

/**
 * Deux lignes maximum, tronquées. Ce qui est affiché dépend de l'état du prompt :
 *  - `turn_end` : le résumé du dernier message de l'assistant. C'est le cas dominant ;
 *  - `parsed` : la question et son détail ;
 *  - `unparsable` : rien de la question. On vient de dire qu'on ne sait pas la lire,
 *    l'afficher quand même serait affirmer une lecture dont on n'a pas la certitude.
 */
function summaryFor(prompt: Prompt | undefined): { title: string; detail: string | null } {
  if (!prompt || prompt.state === 'none') {
    return { title: t.awaitingWaitingForYou, detail: null };
  }
  if (prompt.state === 'turn_end') {
    return { title: prompt.summary || t.awaitingTaskDone, detail: null };
  }
  if (prompt.state === 'parsed') {
    return { title: prompt.question, detail: prompt.detail[0] ?? null };
  }
  return {
    title: t.awaitingUnparsableTitle,
    detail: t.awaitingUnparsableDetail,
  };
}

export function AwaitingCard({
  pane,
  prompt,
  onOpen,
  onInterrupt,
  interruptDisabled,
  interruptLabel,
  aging,
}: Props) {
  const { title, detail } = summaryFor(prompt);
  const age = shortAge(pane.awaiting_since);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.awaitingCardAccessibilityLabel(pane.projectName, age, bypassAccessibilitySuffix(pane.permissionMode), title)}
      onPress={onOpen}
      style={styles.card}
    >
      <View style={styles.header}>
        <StatusGlyph state="awaiting" />
        <PaneTitle pane={pane} />
        <View style={styles.spacer} />
        <Txt variant="footnote" color={aging ? colors.status.error : colors.text.tertiary}>
          {age}
        </Txt>
      </View>
      <PermissionNote mode={pane.permissionMode} />
      <Txt variant="body" color={colors.text.primary} numberOfLines={2}>
        {title}
      </Txt>
      {detail ? (
        <Txt variant="callout" color={colors.text.secondary} numberOfLines={1}>
          {detail}
        </Txt>
      ) : null}
      <Button label={t.actionOpen} onPress={onOpen} height={layout.touchPrimary} />
      <View style={styles.footer}>
        <LinkAction
          label={interruptLabel}
          color={colors.action.interrupt.text}
          disabled={interruptDisabled}
          onPress={onInterrupt}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[3],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: colors.status.awaitingBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.status.awaiting,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  spacer: { flex: 1 },
  footer: { flexDirection: 'row', gap: space[6] },
});
