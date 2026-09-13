// Miroir d'un onglet de Mira. L'image de l'onglet, rafraîchie toutes les 700 ms tant que
// l'écran est au premier plan, et chaque geste renvoyé au Mac : un tap est un clic, un
// glissement vertical un défilement, la barre basse fait Retour, Suivant, Recharger, une
// URL, et un clavier épinglé pour remplir un formulaire de connexion.
//
// Le défilement natif est coupé : la page défile sur le Mac, pas l'image ici. Et Mira
// n'est jamais mis au premier plan par ce qui part d'ici (le daemon n'appelle pas
// `focus-app`) : l'onglet est seulement rendu visible dans sa fenêtre.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MiraAction, MiraFrameResponse } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction, RoundButton } from '@/ui/Button';
import { Banner, EmptyState } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import type { IconName } from '@/ui/Icon';
import { fitFrame, frameAgeSeconds, hostOf, normalizeUrlInput, toCssPoint, toCssScroll } from '@/features/browser/geometry';
import { fetchMiraFrame, postMiraAction, HttpError } from '@/net/http';
import { useClock } from '@/utils/useClock';
import { ImpactStyle, NotifyType, impact, notify } from '@/utils/haptics';

/** Cadence du sondage, et intervalle entre deux envois de défilement pendant un glissement. */
const POLL_MS = 700;
const SCROLL_FLUSH_MS = 150;
/** En deçà, un geste est un tap ; au delà, un défilement. */
const TAP_SLOP_PT = 8;

type Sheet = 'none' | 'keyboard' | 'url';

export default function BrowserMirrorScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ tabId?: string }>();
  const tabId = params.tabId ?? '';

  const [frame, setFrame] = useState<MiraFrameResponse | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Onglet fermé sur le Mac, ou Mira quitté : un état de premier ordre, pas une bannière.
  const [gone, setGone] = useState<'tab' | 'mira' | null>(null);
  const [sheet, setSheet] = useState<Sheet>('none');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const now = useClock(capturedAt !== null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  // --- Sondage ------------------------------------------------------------

  const inFlight = useRef(false);
  const pending = useRef(false);
  const focused = useRef(false);
  // Lus par le sondage et les gestes, qui ne se réabonnent pas à chaque image.
  const frameRef = useRef(frame);
  const goneRef = useRef(gone);
  useEffect(() => {
    frameRef.current = frame;
    goneRef.current = gone;
  }, [frame, gone]);

  // Une seule capture en vol ; une demande pendant l'attente en relance une à la fin.
  const poll = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        pending.current = false;
        if (!tabId || !focused.current || goneRef.current || AppState.currentState !== 'active') return;
        try {
          const f = await fetchMiraFrame(tabId);
          setFrame(f);
          setCapturedAt(Date.now());
          setGone(null);
        } catch (e) {
          if (e instanceof HttpError && e.code === 'MIRA_TAB_NOT_FOUND') setGone('tab');
          else if (e instanceof HttpError && e.code === 'MIRA_UNAVAILABLE') setGone('mira');
          // Une capture ratée entre deux bonnes n'est pas une erreur à afficher : la
          // suivante arrive dans 700 ms. Seule l'absence de toute image se dit.
          else if (!frameRef.current) setError(e instanceof Error ? e.message : String(e));
        }
      } while (pending.current);
    } finally {
      inFlight.current = false;
    }
  }, [tabId]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      // L'onglet est rendu visible dans sa fenêtre d'abord (sans lever Mira) : une
      // capture d'un onglet caché ou endormi rend une image vide ou périmée.
      void postMiraAction(tabId, { kind: 'activate' }).catch(() => undefined).then(() => poll());
      const timer = setInterval(() => void poll(), POLL_MS);
      return () => {
        focused.current = false;
        clearInterval(timer);
      };
    }, [tabId, poll]),
  );

  // --- Gestes -------------------------------------------------------------

  const shown = useMemo(() => (frame ? fitFrame(frame, width) : { width: 0, height: 0 }), [frame, width]);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  const act = useCallback(
    async (action: MiraAction): Promise<boolean> => {
      try {
        await postMiraAction(tabId, action);
        void poll();
        return true;
      } catch (e) {
        if (e instanceof HttpError && e.code === 'MIRA_TAB_NOT_FOUND') setGone('tab');
        else if (e instanceof HttpError && e.code === 'MIRA_UNAVAILABLE') setGone('mira');
        else setToast(e instanceof HttpError ? e.message : t.browserActionFailed);
        notify(NotifyType.Error);
        return false;
      }
    },
    [tabId, poll],
  );

  // Un tap est un clic aux coordonnées CSS ; un glissement vertical est un défilement,
  // envoyé par tranches toutes les 150 ms puis soldé au levé. Le système de réponse de
  // React Native suffit : pas de `PanResponder`, pas de gesture-handler.
  const gesture = useRef({ startX: 0, startY: 0, lastY: 0, acc: 0, moved: false, timer: null as ReturnType<typeof setInterval> | null });

  const flushScroll = useCallback((): void => {
    const g = gesture.current;
    const f = frameRef.current;
    if (!f || g.acc === 0) return;
    const dy = toCssScroll(g.acc, shownRef.current, f);
    g.acc = 0;
    if (dy !== 0) void act({ kind: 'scroll', dy });
  }, [act]);

  const stopFlushing = (): void => {
    const g = gesture.current;
    if (g.timer) clearInterval(g.timer);
    g.timer = null;
  };

  const onGrant = (e: GestureResponderEvent): void => {
    const g = gesture.current;
    g.startX = e.nativeEvent.pageX;
    g.startY = e.nativeEvent.pageY;
    g.lastY = g.startY;
    g.acc = 0;
    g.moved = false;
  };

  const onMove = (e: GestureResponderEvent): void => {
    const g = gesture.current;
    const { pageX, pageY } = e.nativeEvent;
    if (!g.moved && Math.abs(pageY - g.startY) < TAP_SLOP_PT && Math.abs(pageX - g.startX) < TAP_SLOP_PT) return;
    if (!g.moved) {
      g.moved = true;
      g.timer = setInterval(flushScroll, SCROLL_FLUSH_MS);
    }
    g.acc += pageY - g.lastY;
    g.lastY = pageY;
  };

  const onRelease = (e: GestureResponderEvent): void => {
    stopFlushing();
    if (gesture.current.moved) {
      flushScroll();
      return;
    }
    const f = frameRef.current;
    if (!f) return;
    impact(ImpactStyle.Light);
    const p = toCssPoint({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }, shownRef.current, f);
    void act({ kind: 'click', x: p.x, y: p.y });
  };

  const onTerminate = (): void => {
    stopFlushing();
    flushScroll();
  };

  // --- Barre basse --------------------------------------------------------

  const tap = (action: MiraAction): void => {
    impact(ImpactStyle.Light);
    void act(action);
  };

  const sendText = (): void => {
    const value = text;
    if (!value) return;
    void act({ kind: 'type', text: value }).then((ok) => {
      if (ok) setText('');
    });
  };

  const go = (): void => {
    const normalized = normalizeUrlInput(url);
    if (!normalized) {
      setToast(t.browserUrlPlaceholder);
      return;
    }
    void act({ kind: 'nav', url: normalized }).then((ok) => {
      if (ok) setSheet('none');
    });
  };

  const host = frame ? hostOf(frame.url) : '';
  const title = frame?.title || host;
  const age = capturedAt !== null ? frameAgeSeconds(capturedAt, now) : null;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top }}>
        <View style={styles.nav}>
          <LinkAction icon="chevron-left" label={t.browserBack} onPress={() => router.back()} />
          <View style={styles.heading}>
            <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1}>
              {title || t.browserTitle}
            </Txt>
            {host ? (
              <Txt variant="caption" color={colors.text.tertiary} numberOfLines={1}>
                {host}
              </Txt>
            ) : null}
          </View>
          <View style={styles.live}>
            <View style={[styles.liveDot, { backgroundColor: age !== null && age < 3 ? colors.status.success : colors.status.awaiting }]} />
            <Txt variant="caption" color={colors.text.secondary}>
              {age === null ? t.browserLive : age < 2 ? t.browserLive : t.browserFrameAge(age)}
            </Txt>
          </View>
        </View>
      </View>

      {error && !frame ? <Banner tone="error" text={error} actionLabel={t.actionRetry} onAction={() => (setError(null), void poll())} /> : null}

      {/* --- L'image ---------------------------------------------------------- */}
      <View style={styles.stage}>
        {gone ? (
          <EmptyState icon="globe" title={gone === 'tab' ? t.browserTabGone : t.browserUnavailable}>
            <Button label={t.browserClose} onPress={() => router.back()} />
          </EmptyState>
        ) : frame ? (
          <View
            style={{ width: shown.width, height: shown.height }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={onGrant}
            onResponderMove={onMove}
            onResponderRelease={onRelease}
            onResponderTerminate={onTerminate}
          >
            <Image
              source={{ uri: `data:${frame.mime};base64,${frame.image}` }}
              style={{ width: shown.width, height: shown.height }}
              resizeMode="contain"
              accessibilityLabel={title}
            />
          </View>
        ) : (
          <EmptyState icon="globe" title={t.browserWaitingFrame} />
        )}
      </View>

      {toast ? (
        <View style={styles.toast}>
          <Txt variant="footnote" color={colors.text.primary}>
            {toast}
          </Txt>
        </View>
      ) : null}

      {/* --- Clavier : un champ au dessus du clavier iOS, envoyé d'un bloc, plus les
          touches qu'un formulaire attend (Entrée, Tab, Échap, Effacer). ----------- */}
      {sheet === 'keyboard' ? (
        <View style={styles.sheet}>
          <View style={styles.chips}>
            <Chip label={t.browserKeyEnter} onPress={() => tap({ kind: 'key', key: 'Enter' })} />
            <Chip label={t.browserKeyTab} onPress={() => tap({ kind: 'key', key: 'Tab' })} />
            <Chip label={t.browserKeyEscape} onPress={() => tap({ kind: 'key', key: 'Escape' })} />
            <Chip label={t.browserKeyBackspace} onPress={() => tap({ kind: 'key', key: 'Backspace' })} />
            <View style={styles.grow} />
            <LinkAction icon="x" label={t.browserClose} onPress={() => setSheet('none')} />
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={t.browserTypePlaceholder}
              placeholderTextColor={colors.text.tertiary}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              blurOnSubmit={false}
              returnKeyType="send"
              onSubmitEditing={sendText}
              accessibilityLabel={t.browserTypePlaceholder}
            />
            <Button label={t.browserSend} height={40} disabled={!text} onPress={sendText} />
          </View>
          <Txt variant="caption" color={colors.text.tertiary}>
            {t.browserTypeHint}
          </Txt>
        </View>
      ) : null}

      {sheet === 'url' ? (
        <View style={styles.sheet}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder={t.browserUrlPlaceholder}
              placeholderTextColor={colors.text.tertiary}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={go}
              accessibilityLabel={t.browserUrlPlaceholder}
            />
            <Button label={t.browserGo} height={40} disabled={!url.trim()} onPress={go} />
            <LinkAction icon="x" label={t.browserClose} onPress={() => setSheet('none')} />
          </View>
        </View>
      ) : null}

      {/* --- Barre d'action basse ------------------------------------------- */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[3] }]}>
        <Tool icon="arrow-left" label={t.browserNavBack} onPress={() => tap({ kind: 'back' })} />
        <Tool icon="arrow-right" label={t.browserNavForward} onPress={() => tap({ kind: 'forward' })} />
        <Tool icon="rotate-cw" label={t.browserReload} onPress={() => tap({ kind: 'reload' })} />
        <Tool icon="link" label={t.browserUrl} active={sheet === 'url'} onPress={() => setSheet(sheet === 'url' ? 'none' : 'url')} />
        <Tool icon="type" label={t.browserKeyboard} active={sheet === 'keyboard'} onPress={() => setSheet(sheet === 'keyboard' ? 'none' : 'keyboard')} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Tool({ icon, label, onPress, active = false }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <View style={styles.tool}>
      <RoundButton icon={icon} label={label} onPress={onPress} kind={active ? 'primary' : 'secondary'} size={layout.touchMin} />
      <Txt variant="caption" color={colors.text.tertiary}>
        {label}
      </Txt>
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}>
      <Txt variant="footnote" color={colors.text.primary}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  nav: {
    minHeight: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: layout.screenPaddingH,
  },
  heading: { flex: 1 },
  grow: { flex: 1 },
  live: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', backgroundColor: colors.bg.inset, overflow: 'hidden' },
  toast: {
    alignSelf: 'center',
    marginVertical: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: radius.full,
    backgroundColor: colors.bg.overlay,
  },
  sheet: {
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: space[3],
    gap: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.raised,
  },
  chips: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  chip: {
    minHeight: 32,
    paddingHorizontal: space[4],
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.bg.overlay,
    borderWidth: 1,
    borderColor: colors.border.strong,
  },
  chipPressed: { backgroundColor: colors.bg.pressed },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  input: {
    flex: 1,
    height: 40,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.overlay,
    color: colors.text.primary,
    fontSize: 15,
  },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.base,
  },
  tool: { alignItems: 'center', gap: space[1] },
});
