// La barre de message, refonte du 13 septembre : la disposition de l'app Claude sur iOS.
//
// UNE carte (fond `bg.overlay`, rayon 24, bordure fine, marges 16) sur DEUX étages :
// en haut le champ de texte sur toute la largeur, qui s'étire de une à six lignes puis
// défile ; en bas la rangée d'outils, `plus` fantôme à gauche, puis à droite le micro
// (rond discret) et LE bouton d'action, rond de 36 pt, dont le contenu suit `barAction` :
// `arrow-up` grisé sans texte, sur rond accent avec du texte, `square` sur rond rouge
// quand l'agent travaille. Les vignettes de pièces s'affichent au dessus du champ.
// Jamais un mot dans la barre. Un appui sur `mic` remplace la rangée d'outils par la
// rangée d'enregistrement de l'app Claude (14 septembre) : `x` annule, une forme d'onde
// suit la voix, un petit chrono, `square` arrête et transcrit dans le champ, `arrow-up`
// arrête, transcrit et envoie d'un coup. Le texte déjà tapé reste visible au-dessus.
// Verrouillée par un prompt parsé, la carte reste la même, grisée, l'explication à la
// place du placeholder.
//
// Un `/` seul en tête du champ ouvre au-dessus de la carte le menu des commandes de
// Claude Code (intégrées, `~/.claude`, projet, plugins), comme dans le terminal ; il se
// ferme dès qu'un espace suit la commande.
//
// La barre mesure sa hauteur et la donne au parent (`onHeight`) : le fil garde un padding
// bas égal, et rien ne la chevauche jamais.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, type LayoutChangeEvent, Pressable, StyleSheet, TextInput, View } from 'react-native';
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
import { barAction, canEdit, micState, type BarAction } from './barAction';
import { MAX_RECORD_MS, discardRecording, startRecording, transcribeRecording, VoiceError, type RecorderHandle } from './voice';
import { WAVE_BARS, WAVE_LOUD, levelRatio, levelsToBars, pushLevel } from './waveform';
import { SlashSuggestions, useSlashCommands } from './SlashSuggestions';
import { applyCommand, slashQuery } from './slashCommands';

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

const CARD_RADIUS = 24;
const ACTION_SIZE = 36;
const LINE_HEIGHT = 22;
const MAX_LINES = 6;
const SWAP_MS = 150;
const MIN_RECORD_MS = 600;
const LEVEL_POLL_MS = 100;
const WAVE_HEIGHT = 24;

type VoiceEnd = 'cancel' | 'stop' | 'send';

/** La forme d'onde : des `View` fines, redessinées à la cadence du sondage du niveau. */
function Waveform({ levels, seconds }: { levels: readonly number[]; seconds: number }) {
  const bars = levelsToBars(levels, WAVE_BARS);
  return (
    <View
      style={styles.wave}
      accessible
      accessibilityLabel={t.voiceRecordingA11y(seconds)}
      accessibilityLiveRegion="polite"
    >
      {bars.map((ratio, i) => (
        <View
          key={i}
          style={[
            styles.waveBar,
            { height: Math.round(ratio * WAVE_HEIGHT), backgroundColor: ratio >= WAVE_LOUD ? colors.accent.primary : colors.text.primary },
          ]}
        />
      ))}
    </View>
  );
}

/** Le bouton rond de droite : un seul, dont le contenu s'échange en 150 ms. Absent au repos. */
function ActionButton({ action, onSend, onStop }: { action: BarAction; onSend: () => void; onStop: () => void }) {
  // Échange en 150 ms : à chaque changement de nature, le nouveau contenu apparaît en fondu.
  const [opacity] = useState(() => new Animated.Value(1));
  const kind = action.kind;
  useEffect(() => {
    opacity.setValue(0.2);
    Animated.timing(opacity, { toValue: 1, duration: SWAP_MS, useNativeDriver: true }).start();
  }, [kind, opacity]);
  const shown = action;

  // Au repos (`none`) le bouton reste visible, grisé : la place est stable, comme dans
  // l'app Claude, et l'œil sait où l'envoi se fera.
  const fill = shown.kind === 'send' && shown.enabled ? colors.accent.primary : shown.kind === 'stop' ? colors.action.reject.bg : colors.bg.pressed;
  const tint = shown.kind === 'send' && shown.enabled ? colors.text.onFill : shown.kind === 'stop' ? colors.action.reject.text : colors.text.disabled;
  const name = shown.kind === 'stop' ? 'square' : shown.kind === 'busy' ? 'loader' : 'arrow-up';
  const label = shown.kind === 'stop' ? t.composerInterrupt : shown.kind === 'busy' ? t.composerSending : t.actionSend;
  const enabled = shown.kind === 'stop' || (shown.kind === 'send' && shown.enabled);
  return (
    <Animated.View style={[styles.actionSlot, { opacity }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled, busy: shown.kind === 'busy' }}
        disabled={!enabled}
        onPress={shown.kind === 'send' ? onSend : shown.kind === 'stop' ? onStop : undefined}
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
  const [levels, setLevels] = useState<number[]>([]);
  const recorder = useRef<RecorderHandle | null>(null);

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
  const mic = micState(input);
  const editable = canEdit(input);
  const query = editable && !locked ? slashQuery(value) : null;
  const commands = useSlashCommands(paneId, query !== null);

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
  const send = async (raw: string = value): Promise<void> => {
    const text = raw.trim();
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
  // Trois sorties : `cancel` jette l'audio, `stop` transcrit dans le champ, `send` transcrit
  // puis envoie. `finish` est aussi appelé hors gestes (durée maximale, passage en arrière
  // plan) : ces appels passent par la ref pour lire l'état du dernier rendu.
  const finish = async (end: VoiceEnd): Promise<void> => {
    const h = recorder.current;
    if (!h) return;
    recorder.current = null;
    const ms = h.durationMs();
    setRecording(false);
    const { uri } = await h.stop().catch(() => ({ uri: null }));
    if (end === 'cancel') {
      discardRecording(uri);
      notify(NotifyType.Error);
      onNotice(t.voiceCancelled);
      return;
    }
    if (!uri || ms < MIN_RECORD_MS) {
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
      // Dicter la suite d'un texte : le transcrit s'ajoute à ce qui est déjà là.
      const merged = value.trim().length > 0 ? `${value.trimEnd()} ${res.text}` : res.text;
      setValue(merged);
      if (end === 'send') void send(merged);
    } catch (e) {
      notify(NotifyType.Error);
      onNotice(e instanceof VoiceError ? e.message : t.voiceFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setTranscribing(false);
    }
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  const micStart = async (): Promise<void> => {
    if (recording || transcribing) return;
    try {
      recorder.current = await startRecording();
      impact(ImpactStyle.Light);
      setRecordMs(0);
      setLevels([]);
      setRecording(true);
    } catch (e) {
      recorder.current = null;
      onNotice(e instanceof VoiceError ? e.message : t.voiceFailed(e instanceof Error ? e.message : String(e)));
    }
  };

  // Chrono et forme d'onde à 10 Hz ; la durée maximale arrête comme un appui sur Stop.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const h = recorder.current;
      if (!h) return;
      const ms = h.durationMs();
      setRecordMs(ms);
      setLevels((prev) => pushLevel(prev, levelRatio(h.level()), WAVE_BARS));
      if (ms >= MAX_RECORD_MS) void finishRef.current('stop');
    }, LEVEL_POLL_MS);
    return () => clearInterval(timer);
  }, [recording]);

  // L'app passe en arrière plan pendant un enregistrement : on arrête et on transcrit.
  useEffect(() => {
    if (!recording) return;
    const sub = AppState.addEventListener('change', (status) => {
      if (status !== 'active') void finishRef.current('stop');
    });
    return () => sub.remove();
  }, [recording]);

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

      {query !== null ? <SlashSuggestions commands={commands} query={query} onPick={(c) => setValue(applyCommand(c))} /> : null}

      {queuedCount > 0 ? (
        <Txt variant="caption" color={colors.text.tertiary} align="center" style={styles.queue}>
          {t.composerQueued(queuedCount)}
        </Txt>
      ) : null}

      <Pressable
        onPress={locked ? onLockedTap : undefined}
        pointerEvents={locked ? 'box-only' : 'auto'}
        style={[styles.card, locked && styles.cardLocked]}
      >
        {attachments.length > 0 ? (
              <View style={styles.strip}>
                <AttachmentStrip
                  items={attachments}
                  sending={sending}
                  onRemove={(id) => setAttachments((list) => list.filter((a) => a.id !== id))}
                />
              </View>
            ) : null}

        {/* Étage 1 : le texte, toute la largeur. Reste visible, figé, pendant l'enregistrement. */}
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

        {recording ? (
          /* Étage 2, en enregistrement : annuler, forme d'onde, chrono, arrêter, envoyer. */
          <View style={styles.tools}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.voiceCancelA11y}
              hitSlop={6}
              onPress={() => void finish('cancel')}
              style={({ pressed }) => [styles.tool, styles.micTool, pressed && styles.toolPressed]}
            >
              <Icon name="x" size={20} color={colors.text.secondary} />
            </Pressable>
            <Waveform levels={levels} seconds={seconds} />
            <Txt variant="footnote" color={colors.text.tertiary} style={styles.clock}>
              {clock}
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.voiceStopA11y}
              hitSlop={6}
              onPress={() => void finish('stop')}
              style={({ pressed }) => [styles.tool, styles.micTool, pressed && styles.toolPressed]}
            >
              <Icon name="square" size={14} color={colors.text.primary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.voiceSendA11y}
              hitSlop={6}
              onPress={() => void finish('send')}
              style={({ pressed }) => [styles.action, { backgroundColor: colors.accent.primary }, pressed && styles.actionPressed]}
            >
              <Icon name="arrow-up" size={20} color={colors.text.onFill} />
            </Pressable>
          </View>
        ) : (
          /* Étage 2 : les outils. Plus à gauche ; micro et action à droite. */
          <View style={styles.tools}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.attachmentAdd}
              accessibilityState={{ disabled: !canAttach }}
              disabled={!canAttach}
              hitSlop={6}
              onPress={() => askAttachmentSource((picked) => setAttachments((list) => [...list, ...picked]), onNotice)}
              style={({ pressed }) => [styles.tool, pressed && styles.toolPressed]}
            >
              <Icon name="plus" size={20} color={canAttach ? colors.text.secondary : colors.text.disabled} />
            </Pressable>
            <View style={styles.grow} />
            {/* Micro permanent : un appui ouvre la rangée d'enregistrement. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.voiceButton}
              accessibilityState={{ disabled: !mic.enabled }}
              disabled={!mic.enabled}
              hitSlop={6}
              onPress={() => void micStart()}
              style={({ pressed }) => [styles.tool, styles.micTool, pressed && styles.toolPressed]}
            >
              <Icon name="mic" size={20} color={!mic.enabled ? colors.text.disabled : mic.dimmed ? colors.text.tertiary : colors.text.secondary} />
            </Pressable>
            <ActionButton action={action} onSend={() => void send()} onStop={onInterrupt} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.bg.base, paddingHorizontal: layout.screenPaddingH, paddingBottom: space[3] },
  fade: { position: 'absolute', left: 0, right: 0, top: -12, height: 12, flexDirection: 'column' },
  fadeStep: { flex: 1, backgroundColor: colors.bg.base },
  queue: { paddingBottom: space[2] },
  card: {
    borderRadius: CARD_RADIUS,
    backgroundColor: colors.bg.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    paddingHorizontal: space[3],
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  cardLocked: { opacity: 0.55 },
  strip: { paddingTop: space[1], paddingLeft: space[1], paddingBottom: space[2] },
  field: {
    minHeight: LINE_HEIGHT + space[3] * 2,
    maxHeight: LINE_HEIGHT * MAX_LINES + space[3] * 2,
    color: colors.text.primary,
    fontSize: 17,
    lineHeight: LINE_HEIGHT,
    paddingHorizontal: space[2],
    paddingTop: space[3],
    paddingBottom: space[3],
  },
  fieldLocked: { color: colors.text.disabled },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingTop: space[1] },
  tool: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micTool: { backgroundColor: colors.bg.pressed },
  toolPressed: { opacity: 0.7 },
  grow: { flex: 1 },
  actionSlot: { width: ACTION_SIZE, height: ACTION_SIZE },
  action: { width: ACTION_SIZE, height: ACTION_SIZE, borderRadius: ACTION_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  actionPressed: { opacity: 0.8 },
  wave: { flex: 1, height: ACTION_SIZE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[1] },
  waveBar: { width: 3, borderRadius: 1.5 },
  clock: { minWidth: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
