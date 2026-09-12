// Bouton micro du composer : MAINTENIR pour enregistrer, relâcher pour envoyer l'audio à
// la transcription (daemon, puis Gladia depuis le Mac), le texte arrive dans le composer
// sans être envoyé : Robin relit et appuie sur Send. Pendant l'enregistrement, niveau et
// durée ; glisser vers la gauche annule, comme WhatsApp.
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { t } from '@/i18n/en';
import { colors, layout, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { ImpactStyle, NotifyType, impact, notify } from '@/utils/haptics';
import { discardRecording, startRecording, transcribeRecording, VoiceError, type RecorderHandle } from './voice';

const CANCEL_DX = -90;
const MIN_MS = 600;
const LEVEL_POLL_MS = 100;

/** Niveau dB (de -60 à 0) vers une largeur 0..1. */
function levelRatio(db: number | null): number {
  if (db === null) return 0.2;
  return Math.max(0, Math.min(1, (db + 50) / 50));
}

export function VoiceButton({
  disabled,
  onText,
  onNotice,
}: {
  disabled: boolean;
  /** Texte transcrit, à insérer dans le composer. */
  onText: (text: string) => void;
  onNotice: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [level, setLevel] = useState(0.2);
  const [cancelArmed, setCancelArmed] = useState(false);
  const handle = useRef<RecorderHandle | null>(null);
  const cancelled = useRef(false);
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const h = handle.current;
      if (!h) return;
      setDurationMs(h.durationMs());
      setLevel(levelRatio(h.level()));
    }, LEVEL_POLL_MS);
    return () => clearInterval(timer);
  }, [recording]);

  const begin = async (): Promise<void> => {
    if (disabled || recording || transcribing) return;
    cancelled.current = false;
    try {
      handle.current = await startRecording();
      impact(ImpactStyle.Medium);
      setDurationMs(0);
      setRecording(true);
      Animated.spring(scale, { toValue: 1.25, useNativeDriver: true }).start();
    } catch (e) {
      handle.current = null;
      onNotice(e instanceof VoiceError ? e.message : t.voiceFailed(e instanceof Error ? e.message : String(e)));
    }
  };

  const end = async (): Promise<void> => {
    const h = handle.current;
    handle.current = null;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
    setRecording(false);
    setCancelArmed(false);
    if (!h) return;
    const { uri } = await h.stop().catch(() => ({ uri: null }));
    const ms = durationMs;
    if (cancelled.current) {
      discardRecording(uri);
      onNotice(t.voiceCancelled);
      return;
    }
    if (!uri || ms < MIN_MS) {
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
      onText(res.text);
    } catch (e) {
      notify(NotifyType.Error);
      onNotice(e instanceof VoiceError ? e.message : t.voiceFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setTranscribing(false);
    }
  };

  // Maintien et relâchement par `Pressable` (les gestionnaires sont des évènements, pas
  // du rendu) ; le glissement vers la gauche se lit sur `onTouchMove` depuis le point de
  // départ noté au maintien. Une grande zone de rétention garde le maintien actif
  // pendant le glissement.
  const startX = useRef<number | null>(null);
  const onMove = (pageX: number): void => {
    if (startX.current === null) return;
    const armed = pageX - startX.current < CANCEL_DX;
    if (armed !== cancelled.current) {
      cancelled.current = armed;
      setCancelArmed(armed);
      impact(ImpactStyle.Light);
    }
  };

  const seconds = Math.floor(durationMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <View style={styles.wrap}>
      {recording ? (
        <View style={styles.overlay} pointerEvents="none">
          <View style={[styles.levelTrack]}>
            <View style={[styles.levelFill, { width: `${Math.round(level * 100)}%` }, cancelArmed && styles.levelCancel]} />
          </View>
          <Txt variant="caption" color={cancelArmed ? colors.status.error : colors.text.secondary} numberOfLines={1}>
            {cancelArmed ? t.voiceCancelled : `${t.voiceRecording} ${clock} · ${t.voiceSlideToCancel}`}
          </Txt>
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.voiceButton}
          accessibilityState={{ disabled: disabled || transcribing, busy: transcribing }}
          disabled={disabled || transcribing}
          pressRetentionOffset={{ left: 400, right: 400, top: 120, bottom: 120 }}
          onPressIn={(e) => {
            startX.current = e.nativeEvent.pageX;
            void begin();
          }}
          onTouchMove={(e) => onMove(e.nativeEvent.pageX)}
          onPressOut={() => {
            startX.current = null;
            void end();
          }}
          style={[styles.button, recording && styles.buttonOn, cancelArmed && styles.buttonCancel]}
        >
          <Icon
            name={transcribing ? 'loader' : cancelArmed ? 'x' : 'mic'}
            size={20}
            color={disabled ? colors.text.disabled : recording ? colors.text.onFill : colors.text.secondary}
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  button: {
    width: layout.touchMin,
    height: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.touchMin / 2,
  },
  buttonOn: { backgroundColor: colors.accent.primary },
  buttonCancel: { backgroundColor: colors.action.reject.bg },
  overlay: {
    position: 'absolute',
    left: layout.touchMin + space[2],
    right: -260,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    gap: 4,
  },
  levelTrack: { height: 4, borderRadius: 2, backgroundColor: colors.bg.overlay, overflow: 'hidden', width: 160 },
  levelFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent.primary },
  levelCancel: { backgroundColor: colors.status.error },
});
