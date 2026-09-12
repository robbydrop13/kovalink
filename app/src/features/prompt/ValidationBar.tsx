// Barre de validation.
//
// CADRAGE : l'état `parsed` est branché depuis le lot 2, sur la grammaire observée dans les
// fixtures réelles du daemon (`daemon/test/fixtures/prompt-*.txt`, Claude Code 2.1.268).
// L'état `unparsable` reste un état de premier ordre, pas un cas d'erreur : dès que le
// rendu s'écarte de la grammaire, aucun bouton n'est proposé (A6.2, C37).
//
// Le chiffre imprimé dans le badge d'un bouton EST l'`optionIndex` envoyé, avec le
// `promptHash` et l'`awaitingSince` du prompt affiché. Face ID sur Approuver uniquement.
//
// Elle est ancrée au dessus du composer et POUSSE la liste de messages, elle ne la recouvre
// jamais (P2).
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, ScrollView, StyleSheet, View } from 'react-native';
import { NotifyType, notify } from '@/utils/haptics';

import type { Prompt, PromptOption } from '@/protocol';
import { colors, layout, motion, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { Txt } from '@/ui/Txt';
import { shortAge } from '@/utils/time';
import { isAgingSince, usePrompts, type BarPhase } from '@/store/prompts';
import { OptionButton as OptionRow } from './OptionButton';
import { t } from '@/i18n/en';

interface Props {
  prompt: Prompt;
  phase: BarPhase;
  notice: string | null;
  /** Mac injoignable ou hors ligne : état `unavailable`, aucune mise en file (P5). */
  unavailable: boolean;
  onAnswer: (option: PromptOption) => void;
  onInterrupt: () => void;
  onOpenTerminal: () => void;
  onRespondOtherwise: () => void;
  onFreeText: () => void;
  onRetry: () => void;
}

export function ValidationBar(props: Props) {
  const { prompt } = props;
  if (prompt.state === 'none' || prompt.state === 'turn_end') return null;
  if (props.unavailable) return <UnavailableBar onRetry={props.onRetry} />;
  if (prompt.state === 'unparsable') return <UnparsableBar {...props} prompt={prompt} />;
  return <ParsedBar {...props} prompt={prompt} />;
}

// ---------------------------------------------------------------------------
// État `unavailable` : répondre à une question qui a peut-être expiré est pire que ne pas
// répondre. La barre est remplacée par une ligne, et RIEN n'est mis en file.
// ---------------------------------------------------------------------------

function UnavailableBar({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={[styles.bar, styles.unavailable]}>
      <Txt variant="callout" color={colors.text.primary} style={styles.grow}>
        {t.validationUnavailable}
      </Txt>
      <Button label={t.actionRetry} kind="secondary" height={32} onPress={onRetry} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// État `unparsable` : question détectée, options illisibles. Aucun bouton d'option, en
// aucune circonstance. On ne devine jamais un bouton (A6.2, A8).
// ---------------------------------------------------------------------------

function UnparsableBar({
  prompt,
  onInterrupt,
  onOpenTerminal,
  onFreeText,
}: Props & { prompt: Extract<Prompt, { state: 'unparsable' }> }) {
  return (
    <View style={[styles.bar, styles.unparsableTop]}>
      <Header awaitingSince={prompt.awaitingSince} title={t.validationRequired} />
      <Txt variant="bodyStrong" color={colors.text.primary}>
        {t.awaitingUnparsableTitle}
      </Txt>
      {/* Le texte de la question n'est PAS affiché : on vient de dire qu'on ne sait pas le
          lire, l'afficher quand même serait affirmer une lecture dont on n'a pas la
          certitude. */}
      <Txt variant="callout" color={colors.text.secondary}>
        {t.awaitingUnparsableDetail}
      </Txt>
      <Button label={t.actionOpenTerminal} onPress={onOpenTerminal} />
      <View style={styles.footer}>
        <LinkAction label={t.validationAnswerInText} onPress={onFreeText} />
        <LinkAction
          label={t.interruptLabel}
          color={colors.action.interrupt.text}
          onPress={onInterrupt}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// État parsé : gabarits A (2 options), B (3 options dont une durable), C (4 et plus).
// ---------------------------------------------------------------------------

function ParsedBar({
  prompt,
  phase,
  notice,
  onAnswer,
  onInterrupt,
  onRespondOtherwise,
}: Props & { prompt: Extract<Prompt, { state: 'parsed' }> }) {
  const pendingIndex = usePrompts((s) => s.pendingIndex[prompt.paneId]);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  // `expired` : c'est réglé sur le Mac (ou le pane a disparu), les boutons ne répondent
  // plus, la barre attend le `prompt none` qui la retire.
  const sending = phase === 'sending' || phase === 'authenticating' || phase === 'expired';
  const options = [...prompt.options].sort((a, b) => a.index - b.index);
  const always = options.find((o) => o.kind === 'approve_always');
  const main = options.filter((o) => o !== always);
  const hasReject = options.some((o) => o.kind === 'reject');

  // Gabarit C dès que la ligne principale ne tient plus à deux, ou si aucune option durable
  // n'a été identifiée alors qu'il y en a trois.
  const templateC = main.length > 2;

  useEffect(() => {
    if (confirmIndex === null) return;
    const timer = setTimeout(() => setConfirmIndex(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmIndex]);

  const press = (option: PromptOption) => {
    // Seule option dont la portée dépasse la question courante : double confirmation.
    if (option.kind === 'approve_always' && confirmIndex !== option.index) {
      setConfirmIndex(option.index);
      return;
    }
    setConfirmIndex(null);
    onAnswer(option);
  };

  return (
    <View style={styles.bar}>
      <Header awaitingSince={prompt.awaitingSince} title={t.validationAuthRequired} />
      {notice ? (
        <View style={styles.notice}>
          <Txt variant="callout" color={colors.status.awaiting}>
            {notice}
          </Txt>
        </View>
      ) : null}
      <Txt variant="bodyStrong" color={colors.text.primary}>
        {prompt.question}
      </Txt>
      {prompt.detail.map((d, i) => (
        <Txt key={i} variant="callout" color={colors.text.secondary} numberOfLines={2}>
          {d}
        </Txt>
      ))}

      <ArmingVeil key={phase === 'entering' ? 'arming' : 'armed'} arming={phase === 'entering'}>
        {templateC ? (
          <ScrollView
            style={{ maxHeight: layout.validationBarMaxHeight }}
            contentContainerStyle={styles.stack}
          >
            {options.map((o) => (
              <OptionRow
                key={o.index}
                option={o}
                height={56}
                forceNeutral
                sending={sending && pendingIndex === o.index}
                disabled={sending}
                confirming={confirmIndex === o.index}
                onPress={() => press(o)}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.stack}>
            {always ? (
              <OptionRow
                option={always}
                height={48}
                sending={sending && pendingIndex === always.index}
                disabled={sending}
                confirming={confirmIndex === always.index}
                onPress={() => press(always)}
              />
            ) : null}
            <View style={styles.mainRow}>
              {main.map((o) => (
                <OptionRow
                  key={o.index}
                  option={o}
                  height={layout.touchPrimary}
                  sending={sending && pendingIndex === o.index}
                  disabled={sending}
                  onPress={() => press(o)}
                  style={styles.grow}
                />
              ))}
            </View>
          </View>
        )}
      </ArmingVeil>

      <View style={styles.footer}>
        {hasReject ? (
          <LinkAction label={t.validationRespondOtherwise} onPress={onRespondOtherwise} />
        ) : (
          <View />
        )}
        <LinkAction
          label={t.interruptLabel}
          color={colors.action.interrupt.text}
          onPress={onInterrupt}
        />
      </View>
    </View>
  );
}

function Header({ awaitingSince, title }: { awaitingSince: string; title: string }) {
  const aging = isAgingSince(awaitingSince);
  return (
    <View style={styles.header}>
      <StatusGlyph state="awaiting" size={10} />
      <Txt variant="caption" color={aging ? colors.status.error : colors.text.secondary}>
        {title}
      </Txt>
      <View style={styles.grow} />
      <Txt variant="caption" color={aging ? colors.status.error : colors.text.tertiary}>
        {t.validationAgo(shortAge(awaitingSince))}
      </Txt>
    </View>
  );
}

/**
 * Voile d'armement de 400 ms (design 4.3.4). Sans lui, une notification ouverte pendant que
 * le pouce descend valide toute seule.
 *
 * Le composant est remonté par sa `key` à chaque entrée de la barre : l'état d'armement
 * repart donc de zéro sans qu'aucun effet n'ait à le remettre à jour au rendu.
 */
function ArmingVeil({ arming, children }: { arming: boolean; children: ReactNode }) {
  const [ready, setReady] = useState(!arming);
  const [opacity] = useState(() => new Animated.Value(arming ? 0.55 : 1));

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => {
      setReady(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.instant + 20,
        useNativeDriver: true,
      }).start();
      notify(NotifyType.Warning);
    }, layout.armingWindowMs);
    return () => clearTimeout(timer);
  }, [ready, opacity]);

  return (
    <Animated.View style={{ opacity }} pointerEvents={ready ? 'auto' : 'none'}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: space[3],
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[4],
    paddingBottom: space[4],
    backgroundColor: colors.bg.overlay,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  unparsableTop: { borderTopWidth: 2, borderTopColor: colors.status.awaiting },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: space[4],
    backgroundColor: colors.bg.overlay,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 20 },
  notice: {
    padding: space[3],
    borderRadius: radius.sm,
    backgroundColor: colors.status.awaitingBg,
  },
  stack: { gap: space[3] },
  mainRow: { flexDirection: 'row', gap: space[4] },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  grow: { flex: 1 },
});
