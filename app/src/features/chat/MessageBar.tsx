// La barre de message, refonte du 12 septembre : le modèle de Claude, ChatGPT et WhatsApp.
//
// UNE pilule (fond `bg.overlay`, rayon 22, bordure fine, marges 16, 44 pt au repos) qui
// s'étire de une à cinq lignes puis défile ; dedans, les vignettes de pièces au dessus du
// texte, un bouton fantôme `plus` à gauche, le champ au centre sans fond propre, et UN
// bouton rond de 32 pt à droite dont le contenu suit `barAction` : `mic` au repos,
// `arrow-up` sur rond accent avec du texte, `square` sur rond rouge quand l'agent travaille.
// Jamais deux boutons, jamais un mot. Maintenir `mic` transforme la pilule en barre
// d'enregistrement ; le texte transcrit remplace le contenu du champ. Verrouillée par un
// prompt parsé, la pilule reste la même, grisée, l'explication à la place du placeholder.
//
// La barre mesure sa hauteur et la donne au parent (`onHeight`) : le fil garde un padding
// bas égal, et rien ne la chevauche jamais.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, type LayoutChangeEvent, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { Prompt } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { isComposerLocked, requiresFaceIdForText } from '@/store/prompts';
import { draftOf, useDrafts } from '@/store/drafts';
import { ImpactStyle, NotifyType, impact, notify } from '@/utils/haptics';
import { AttachmentStrip, askAttachmentSource } from './AttachmentViews';
import type { Attachment } from './attachments';
import { barAction, canEdit, type BarAction } from './barAction';
import { discardRecording, startRecording, transcribeRecording, VoiceError, type RecorderHandle } from './voice';

export interface MessageBarProps {
  paneId: number;
  prompt: Prompt | undefined;
  working: boolean;
  degraded: boolean;
  disabled: boolean;
  disabledPlaceholder?: string;
  queuedCount: number;
  /** `true` : parti ou mis en file (le champ se vide) ; `false` : rien n'est parti (le texte reste). */
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onInterrupt: () => void;
  onLockedTap: () => void;
  onNotice: (text: string) => void;
  /** Hauteur réelle de la barre, mesurée : le fil s'en sert comme padding bas. */
  onHeight?: (height: number) => void;
}

const PILL_RADIUS = 22;
const ACTION_SIZE = 32;
const LINE_HEIGHT = 22;
const MAX_LINES = 5;
const SWAP_MS = 150;
const CANCEL_DX = -90;
const MIN_RECORD_MS = 600;
const LEVEL_POLL_MS = 100;

function levelRatio(db: number | null): number {
  if (db === null) return 0.2;
  return Math.max(0, Math.min(1, (db + 50) / 50));
}

/** Le bouton rond de droite : un seul, dont le contenu s'échange en 150 ms. */
function ActionButton({ action, onSend, onStop, onMicIn, onMicMove, onMicOut }: {
  action: BarAction;
  onSend: () => void;
  onStop: () => void;
  onMicIn: (pageX: number) => void;
  onMicMove: (pageX: number) => void;
  onMicOut: () => void;
}) {
  // Échange en 150 ms : à chaque changement de nature, le nouveau contenu apparaît en fondu.
  const [opacity] = useState(() => new Animated.Value(1));
  const kind = action.kind;
  useEffect(() => {
    opacity.setValue(0.2);
    Animated.timing(opacity, { toValue: 1, duration: SWAP_MS, useNativeDriver: true }).start();
  }, [kind, opacity]);
  const shown = action;

  if (shown.kind === 'none') return <View style={styles.actionSlot} />;
  const fill =
    shown.kind === 'send' && shown.enabled ? colors.accent.primary : shown.kind === 'stop' ? colors.action.reject.bg : 'transparent';
  const tint =
    shown.kind === 'send' && shown.enabled
      ? colors.text.onFill
      : shown.kind === 'stop'
        ? colors.action.reject.text
        : shown.kind === 'mic' && shown.enabled
          ? colors.text.secondary
          : colors.text.disabled;
  const name = shown.kind === 'send' ? 'arrow-up' : shown.kind === 'stop' ? 'square' : shown.kind === 'busy' ? 'loader' : 'mic';
  const label = shown.kind === 'send' ? t.actionSend : shown.kind === 'stop' ? t.composerInterrupt : shown.kind === 'busy' ? t.composerSending : t.voiceButton;
  const enabled = shown.kind === 'stop' || (shown.kind === 'send' && shown.enabled) || (shown.kind === 'mic' && shown.enabled);
  return (
    <Animated.View style={[styles.actionSlot, { opacity }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled, busy: shown.kind === 'busy' }}
        disabled={!enabled}
        pressRetentionOffset={{ left: 400, right: 400, top: 120, bottom: 120 }}
        onPress={shown.kind === 'send' ? onSend : shown.kind === 'stop' ? onStop : undefined}
        onPressIn={shown.kind === 'mic' ? (e) => onMicIn(e.nativeEvent.pageX) : undefined}
        onTouchMove={shown.kind === 'mic' ? (e) => onMicMove(e.nativeEvent.pageX) : undefined}
        onPressOut={shown.kind === 'mic' ? onMicOut : undefined}
        style={({ pressed }) => [styles.action, { backgroundColor: fill }, pressed && enabled && styles.actionPressed]}
      >
        <Icon name={name} size={shown.kind === 'stop' ? 14 : 20} color={tint} />
      </Pressable>
    </Animated.View>
  );
}

export function MessageBar({
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
  onHeight,
}: MessageBarProps) {
  const value = useDrafts((s) => draftOf(s.byPane, paneId));
  const setDraft = useDrafts((s) => s.set);
  const setValue = useCallback((text: string) => setDraft(paneId, text), [setDraft, paneId]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [level, setLevel] = useState(0.2);
  const [cancelArmed, setCancelArmed] = useState(false);
  const recorder = useRef<RecorderHandle | null>(null);
  const cancelled = useRef(false);
  const startX = useRef<number | null>(null);

  const locked = isComposerLocked(prompt);
  const faceId = requiresFaceIdForText(prompt);
  const input = useMemo(
    () => ({
      locked,
      disabled,
      working,
      hasText: value.trim().length > 0,
      hasAttachments: attachments.length > 0,
      sending,
      transcribing,
      recording,
    }),
    [locked, disabled, working, value, attachments.length, sending, transcribing, recording],
  );
  const action = barAction(input);
  const editable = canEdit(input);

  const placeholder = locked
    ? t.composerLockedPlaceholder
    : disabled
      ? (disabledPlaceholder ?? t.composerUnavailable)
      : faceId
        ? t.composerFaceIdPlaceholder
        : degraded
          ? t.composerOfflinePlaceholder
          : t.composerPlaceholder;

  // --- Envoi -------------------------------------------------------------------------
  const send = async (): Promise<void> => {
    const text = value.trim();
    const pieces = attachments;
    if (pieces.length === 0) {
      // Le champ se vide tout de suite ; si rien n'est parti (refus, Face ID annulé, file
      // pleine) ou si l'envoi lève, le texte revient. Rien ne disparaît sans être parti.
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

  // --- Enregistrement vocal ------------------------------------------------------------
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const h = recorder.current;
      if (!h) return;
      setRecordMs(h.durationMs());
      setLevel(levelRatio(h.level()));
    }, LEVEL_POLL_MS);
    return () => clearInterval(timer);
  }, [recording]);

  const micIn = async (pageX: number): Promise<void> => {
    if (recording || transcribing) return;
    startX.current = pageX;
    cancelled.current = false;
    try {
      recorder.current = await startRecording();
      impact(ImpactStyle.Medium);
      setRecordMs(0);
      setCancelArmed(false);
      setRecording(true);
    } catch (e) {
      recorder.current = null;
      onNotice(e instanceof VoiceError ? e.message : t.voiceFailed(e instanceof Error ? e.message : String(e)));
    }
  };
  const micMove = (pageX: number): void => {
    if (startX.current === null || !recording) return;
    const armed = pageX - startX.current < CANCEL_DX;
    if (armed !== cancelled.current) {
      cancelled.current = armed;
      setCancelArmed(armed);
      impact(ImpactStyle.Light);
    }
  };
  const micOut = async (): Promise<void> => {
    startX.current = null;
    const h = recorder.current;
    recorder.current = null;
    setRecording(false);
    setCancelArmed(false);
    if (!h) return;
    const { uri } = await h.stop().catch(() => ({ uri: null }));
    if (cancelled.current) {
      discardRecording(uri);
      onNotice(t.voiceCancelled);
      return;
    }
    if (!uri || recordMs < MIN_RECORD_MS) {
      discardRecording(uri);
      onNotice(t.voiceTooShort);
      return;
    }
    setTranscribing(true);
    try {
      const res = await transcribeRecording(uri);
      if (res.text.length === 0) {
        onNotice(t.voiceEmpty);
        return;
      }
      notify(NotifyType.Success);
      setValue(res.text);
    } catch (e) {
      notify(NotifyType.Error);
      onNotice(e instanceof VoiceError ? e.message : t.voiceFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setTranscribing(false);
    }
  };

  const seconds = Math.floor(recordMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const canAttach = editable;

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => onHeight?.(e.nativeEvent.layout.height)}>
      {/* Fondu de 12 pt du fond vers la barre : pas de trait dur. */}
      <View pointerEvents="none" style={styles.fade}>
        <View style={[styles.fadeStep, { opacity: 0.35 }]} />
        <View style={[styles.fadeStep, { opacity: 0.65 }]} />
        <View style={[styles.fadeStep, { opacity: 0.9 }]} />
      </View>

      {queuedCount > 0 ? (
        <Txt variant="caption" color={colors.text.tertiary} align="center" style={styles.queue}>
          {t.composerQueued(queuedCount)}
        </Txt>
      ) : null}

      <Pressable
        onPress={locked ? onLockedTap : undefined}
        pointerEvents={locked ? 'box-only' : 'auto'}
        style={[styles.pill, locked && styles.pillLocked, recording && styles.pillRecording, cancelArmed && styles.pillCancel]}
      >
        {recording ? (
          <View style={styles.recordRow}>
            <Icon name={cancelArmed ? 'x' : 'mic'} size={20} color={cancelArmed ? colors.status.error : colors.status.error} />
            <Txt variant="callout" color={colors.text.primary} style={styles.clock}>
              {clock}
            </Txt>
            <View style={styles.levelTrack}>
              <View style={[styles.levelFill, { width: `${Math.round(level * 100)}%` }, cancelArmed && styles.levelCancel]} />
            </View>
            <Txt variant="footnote" color={cancelArmed ? colors.status.error : colors.text.tertiary} numberOfLines={1}>
              {cancelArmed ? t.voiceCancelled : t.voiceSlideToCancel}
            </Txt>
          </View>
        ) : null}

        {!recording && attachments.length > 0 ? (
          <View style={styles.strip}>
            <AttachmentStrip
              items={attachments}
              sending={sending}
              onRemove={(id) => setAttachments((list) => list.filter((a) => a.id !== id))}
            />
          </View>
        ) : null}

        <View style={[styles.row, recording && styles.rowHidden]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.attachmentAdd}
            accessibilityState={{ disabled: !canAttach }}
            disabled={!canAttach}
            hitSlop={6}
            onPress={() => askAttachmentSource((picked) => setAttachments((list) => [...list, ...picked]), onNotice)}
            style={styles.ghost}
          >
            <Icon name="plus" size={20} color={canAttach ? colors.text.secondary : colors.text.disabled} />
          </Pressable>

          <TextInput
            style={[styles.field, locked && styles.fieldLocked]}
            value={value}
            onChangeText={setValue}
            editable={editable}
            placeholder={placeholder}
            placeholderTextColor={colors.text.tertiary}
            multiline
            scrollEnabled
            keyboardType="default"
            keyboardAppearance="dark"
            accessibilityLabel={t.composerFieldA11y}
          />

          <ActionButton
            action={action}
            onSend={() => void send()}
            onStop={onInterrupt}
            onMicIn={(x) => void micIn(x)}
            onMicMove={micMove}
            onMicOut={() => void micOut()}
          />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.bg.base, paddingHorizontal: layout.screenPaddingH, paddingBottom: space[3] },
  fade: { position: 'absolute', left: 0, right: 0, top: -12, height: 12, flexDirection: 'column' },
  fadeStep: { flex: 1, backgroundColor: colors.bg.base },
  queue: { paddingBottom: space[2] },
  pill: {
    minHeight: layout.touchMin,
    borderRadius: PILL_RADIUS,
    backgroundColor: colors.bg.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    paddingHorizontal: space[2],
  },
  pillLocked: { opacity: 0.55 },
  pillRecording: { borderColor: colors.status.error },
  pillCancel: { backgroundColor: '#2B1416' },
  strip: { paddingTop: space[2], paddingLeft: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-end', minHeight: layout.touchMin },
  rowHidden: { height: 0, minHeight: 0, opacity: 0, overflow: 'hidden' },
  ghost: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    marginVertical: (layout.touchMin - ACTION_SIZE) / 2,
    marginLeft: space[1],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: ACTION_SIZE / 2,
  },
  field: {
    flex: 1,
    minHeight: layout.touchMin,
    maxHeight: LINE_HEIGHT * MAX_LINES + space[3] * 2,
    color: colors.text.primary,
    fontSize: 17,
    lineHeight: LINE_HEIGHT,
    paddingHorizontal: space[3],
    paddingTop: (layout.touchMin - LINE_HEIGHT) / 2,
    paddingBottom: (layout.touchMin - LINE_HEIGHT) / 2,
  },
  fieldLocked: { color: colors.text.disabled },
  actionSlot: { width: ACTION_SIZE, height: ACTION_SIZE, marginVertical: (layout.touchMin - ACTION_SIZE) / 2, marginRight: space[1] },
  action: { width: ACTION_SIZE, height: ACTION_SIZE, borderRadius: ACTION_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  actionPressed: { opacity: 0.8 },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: layout.touchMin, paddingHorizontal: space[3] },
  clock: { minWidth: 40 },
  levelTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.bg.pressed, overflow: 'hidden' },
  levelFill: { height: 4, borderRadius: 2, backgroundColor: colors.status.error },
  levelCancel: { backgroundColor: colors.text.disabled },
});
