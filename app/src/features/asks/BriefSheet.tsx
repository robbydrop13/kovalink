// Le Brief : repondre a une question d'agent avec une instruction, pas seulement un bouton.
//
// L'agent relit un bouton de SA question, jamais un mot fabrique par l'app : le chip
// choisi est donc ce bouton, et le texte libre l'accompagne. Sans chip, l'instruction part
// avec le premier bouton (le defaut de la carte du Mac) ; la ligne du bas le dit avant
// l'envoi, rien n'est choisit en silence.
//
// Un texte seul ne part jamais : la route exige un `action` declare (`answer.ts`,
// `briefAction`). En contrepartie, l'app n'envoie pas un mot que l'agent ne comprendrait pas.
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ASK_TEXT_MAX, type AskItem } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { Txt } from '@/ui/Txt';
import { shortAgeMs } from '@/utils/time';
import { askOptions, briefAction } from './answer';

interface Props {
  ask: AskItem;
  visible: boolean;
  /** Horloge de l'ecran : un age se calcule hors du rendu, jamais avec `Date.now()`. */
  now: number;
  onClose: () => void;
  /** Envoie l'option et le texte par le chemin de reponse ordinaire. */
  onSend: (action: string, text: string) => Promise<void>;
}

export function BriefSheet({ ask, visible, now, onClose, onSend }: Props) {
  const insets = useSafeAreaInsets();
  const [pick, setPick] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // Chaque ouverture repart d'un Brief vide : un brouillon d'hier sur une autre question
  // partirait au mauvais agent. `onShow` est un evenement de la modale, pas un effet de
  // rendu : l'etat est remis a zero une fois la feuille affichee.
  const reset = (): void => {
    setPick(null);
    setText('');
    setSending(false);
  };

  const action = briefAction(ask, pick);
  const empty = pick === null && text.trim().length === 0;
  const canSend = action !== null && !empty && !sending;

  const submit = async (): Promise<void> => {
    if (!canSend || action === null) return;
    setSending(true);
    await onSend(action, text);
    setSending(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={reset}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} accessibilityLabel={t.actionCancel} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space[5] }]}>
            <View style={styles.header}>
              <StatusGlyph state="awaiting" size={8} />
              <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1} style={styles.grow}>
                {t.askBriefTitle(ask.from)}
              </Txt>
              <Txt variant="caption" color={colors.text.tertiary}>
                {shortAgeMs(now - ask.askedAtMs)}
              </Txt>
            </View>

            <Txt variant="callout" color={colors.text.secondary} numberOfLines={4}>
              {ask.message}
            </Txt>

            {askOptions(ask).length > 0 ? (
              <View style={styles.chips}>
                {askOptions(ask).map((label) => {
                  const on = pick === label;
                  return (
                    <Pressable
                      key={label}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ selected: on }}
                      onPress={() => setPick(on ? null : label)}
                      style={({ pressed }) => [
                        styles.chip,
                        on && styles.chipOn,
                        pressed && styles.chipPressed,
                      ]}
                    >
                      <Txt variant="footnote" color={on ? colors.accent.primary : colors.text.secondary}>
                        {label}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <TextInput
              value={text}
              onChangeText={setText}
              style={styles.input}
              multiline
              autoFocus
              maxLength={ASK_TEXT_MAX}
              keyboardAppearance="dark"
              textAlignVertical="top"
              placeholder={t.askBriefInstruction}
              placeholderTextColor={colors.text.tertiary}
              accessibilityLabel={t.askBriefInstruction}
            />

            <View style={styles.footer}>
              <LinkAction label={t.actionCancel} color={colors.text.secondary} onPress={onClose} />
              <Button
                label={sending ? t.askSending : t.actionSend}
                height={40}
                disabled={!canSend}
                onPress={() => void submit()}
                style={styles.send}
              />
            </View>

            <Txt variant="caption" color={colors.text.tertiary}>
              {pick !== null ? t.askBriefHint : t.askBriefNoPick}
            </Txt>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg.scrim,
  },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    gap: space[3],
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[5],
    backgroundColor: colors.bg.overlay,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: 30,
    paddingHorizontal: space[3],
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.raised,
  },
  chipOn: { borderColor: colors.accent.primary, backgroundColor: colors.accent.subtleBg },
  chipPressed: { backgroundColor: colors.bg.pressed },
  input: {
    minHeight: 84,
    maxHeight: 160,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.bg.base,
    paddingHorizontal: space[3],
    paddingTop: space[3],
    paddingBottom: space[3],
    color: colors.text.primary,
    fontSize: 15,
    lineHeight: 20,
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  send: { paddingHorizontal: space[6] },
});
