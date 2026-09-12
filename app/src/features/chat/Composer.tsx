// Zone de saisie.
//
// Deuxième composant du produit par ordre d'importance (D1) : les agents de Robin finissent
// et attendent l'instruction suivante, et c'est ici qu'il la donne.
//
// Aucun bouton micro : la touche micro du clavier iOS fait déjà la dictée, gratuitement,
// avec le modèle mental que Robin connaît, et elle insère sans envoyer.
// La touche retour insère un saut de ligne, jamais un envoi : un envoi accidentel vers un
// agent coûte cher.
//
// Pièces jointes (docs/15) : le « + » ouvre Photos, Appareil photo ou Fichiers, les
// vignettes s'empilent au dessus du champ et se retirent d'un tap. À l'envoi, le composer
// se fige le temps que les pièces arrivent sur le Mac ; si une pièce échoue, rien ne part
// et les vignettes restent pour réessayer.
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { Prompt } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { Icon } from '@/ui/Icon';
import { isComposerLocked, requiresFaceIdForText } from '@/store/prompts';
import { draftOf, useDrafts } from '@/store/drafts';
import { AttachmentStrip, askAttachmentSource } from './AttachmentViews';
import type { Attachment } from './attachments';

export interface ComposerProps {
  /** Le brouillon est gardé PAR PANE (store + SQLite) : quitter et revenir le retrouve. */
  paneId: number;
  prompt: Prompt | undefined;
  working: boolean;
  /** Mac injoignable ou hors ligne : l'envoi part dans la file, il n'est pas rejeté (P5). */
  degraded: boolean;
  disabled: boolean;
  disabledPlaceholder?: string;
  queuedCount: number;
  /**
   * Envoi. Rend `true` quand le message est parti ou mis en file (le composer se vide),
   * `false` quand rien n'est parti (le texte et les vignettes restent).
   */
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onInterrupt: () => void;
  /** Un tap sur un champ verrouillé fait pulser la barre de validation au lieu du clavier. */
  onLockedTap: () => void;
  /** Cause d'un sélecteur qui ne s'ouvre pas (permission refusée) : affichée, jamais avalée. */
  onNotice: (text: string) => void;
}

export function Composer({
  paneId,
  prompt,
  working,
  degraded,
  disabled,
  disabledPlaceholder,
  queuedCount,
  onSend,
  onInterrupt,
  onLockedTap,
  onNotice,
}: ComposerProps) {
  const value = useDrafts((s) => draftOf(s.byPane, paneId));
  const setDraft = useDrafts((s) => s.set);
  const setValue = useCallback((text: string) => setDraft(paneId, text), [setDraft, paneId]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const locked = isComposerLocked(prompt);
  const faceId = requiresFaceIdForText(prompt);

  const placeholder = locked
    ? t.composerLockedPlaceholder
    : disabled
      ? (disabledPlaceholder ?? t.composerUnavailable)
      : faceId
        ? t.composerFaceIdPlaceholder
        : degraded
          ? t.composerOfflinePlaceholder
          : t.composerPlaceholder;

  const hasContent = value.trim().length > 0 || attachments.length > 0;
  const canSend = !locked && !disabled && !sending && hasContent;
  const showInterrupt = working && !hasContent && !locked;
  const canAttach = !locked && !disabled && !sending;

  const send = async (): Promise<void> => {
    const text = value.trim();
    const pieces = attachments;
    if (pieces.length === 0) {
      // Sans pièce, le geste d'aujourd'hui : le champ se vide tout de suite, l'envoi part.
      // Mais RIEN ne disparaît sans être parti : si l'envoi rend `false` (refus, Face ID
      // annulé, file pleine) ou lève, le texte revient dans le champ. Le 12 septembre un
      // message a disparu de l'app sans bulle ni erreur : c'était ce chemin.
      setValue('');
      onSend(text, []).then(
        (ok) => {
          if (!ok) setValue(text);
        },
        (e: unknown) => {
          setValue(text);
          onNotice(t.composerSendFailed(e instanceof Error ? e.message : String(e)));
        },
      );
      return;
    }
    // Avec des pièces, le composer se fige le temps du transfert : le texte reste visible,
    // et il ne disparaît qu'une fois le message parti ou mis en file.
    setSending(true);
    try {
      if (await onSend(text, pieces)) {
        setValue('');
        setAttachments([]);
      }
    } catch (e) {
      onNotice(t.composerSendFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {queuedCount > 0 ? (
        <View style={styles.queue}>
          <Txt variant="caption" color={colors.text.secondary}>
            {t.composerQueued(queuedCount)}
          </Txt>
        </View>
      ) : null}

      <AttachmentStrip
        items={attachments}
        sending={sending}
        onRemove={(id) => setAttachments((list) => list.filter((a) => a.id !== id))}
      />

      <View
        style={[
          styles.bar,
          degraded && { borderTopWidth: 2, borderTopColor: colors.link.macUnreachable },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.attachmentAdd}
          accessibilityState={{ disabled: !canAttach }}
          disabled={!canAttach}
          onPress={() =>
            askAttachmentSource((picked) => setAttachments((list) => [...list, ...picked]), onNotice)
          }
          style={styles.attach}
        >
          <Icon name="plus" size={24} color={canAttach ? colors.text.secondary : colors.text.disabled} />
        </Pressable>

        <Pressable
          style={styles.fieldWrap}
          onPress={locked ? onLockedTap : undefined}
          pointerEvents={locked ? 'box-only' : 'auto'}
        >
          <TextInput
            style={[styles.field, locked && styles.fieldLocked]}
            value={value}
            onChangeText={setValue}
            editable={!locked && !disabled && !sending}
            placeholder={placeholder}
            placeholderTextColor={colors.text.tertiary}
            multiline
            keyboardType="default"
            keyboardAppearance="dark"
            accessibilityLabel={t.composerFieldA11y}
          />
        </Pressable>

        {showInterrupt ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.composerInterrupt}
            onPress={onInterrupt}
            style={styles.interrupt}
          >
            <Icon name="square" size={14} color={colors.action.interrupt.text} />
            <Txt variant="calloutStrong" color={colors.action.interrupt.text}>
              {t.composerInterrupt}
            </Txt>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sending ? t.composerSending : t.actionSend}
            accessibilityState={{ disabled: !canSend, busy: sending }}
            disabled={!canSend}
            onPress={() => void send()}
            style={[styles.send, canSend ? styles.sendOn : styles.sendOff]}
          >
            <Icon name={sending ? 'loader' : 'send'} size={20} color={canSend ? colors.text.onFill : colors.text.disabled} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.bg.base },
  queue: {
    alignSelf: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    marginBottom: space[2],
    borderRadius: radius.full,
    backgroundColor: colors.bg.overlay,
  },
  bar: {
    minHeight: layout.composerMinHeight,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[4],
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: space[3],
  },
  fieldWrap: { flex: 1 },
  attach: {
    width: layout.touchMin,
    height: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -space[3],
  },
  field: {
    minHeight: 40,
    maxHeight: layout.composerMaxHeight,
    color: colors.text.primary,
    fontSize: 17,
    lineHeight: 24,
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.inset,
  },
  fieldLocked: { backgroundColor: colors.bg.raised },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOn: { backgroundColor: colors.accent.primary },
  sendOff: { backgroundColor: colors.bg.raised },
  interrupt: {
    width: 116,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.action.interrupt.border,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
