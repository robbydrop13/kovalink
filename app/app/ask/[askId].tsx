// La question d'un agent (`kova ask`), sur le téléphone.
//
// Cible du lien profond `kovalink://ask/{askId}` et du bandeau de la liste. L'écran ne
// résout rien : la liste des questions vit dans le store, diffusée par le daemon à chaque
// changement, et une question répondue sur le Mac disparaît d'ici pendant qu'on la lit.
//
// Trois gestes, et un seul répond à l'agent : un des boutons qu'il a déclarés. « Copy »
// met le message dans le presse-papiers (une question porte souvent un chemin ou une
// commande), « Later » la remet à plus tard pour un délai choisi, et le texte libre
// accompagne le bouton sans jamais le remplacer.
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ASK_TEXT_MAX } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner, EmptyState } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { answerAsk, snoozeAsk } from '@/actions/ask';
import { dueAsks, useAsks } from '@/store/asks';
import { isDegraded, useConnection } from '@/store/connection';
import { useToast } from '@/store/toast';
import { copyOrShare } from '@/utils/clipboard';
import { ImpactStyle, impact } from '@/utils/haptics';
import { clockTime } from '@/utils/time';

export default function AskScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ askId: string }>();
  const askId = String(params.askId ?? '');
  const asks = useAsks((s) => s.asks);
  const supported = useAsks((s) => s.supported);
  const snoozeChoices = useAsks((s) => s.snoozeChoices);
  const ask = asks.find((a) => a.id === askId) ?? null;
  const others = useMemo(() => dueAsks(asks).filter((a) => a.id !== askId), [asks, askId]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error' | 'warn'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const degraded = isDegraded(useConnection((s) => s.link));

  /** Après un geste réussi : la question suivante, sinon on sort. */
  const leave = (): void => {
    const next = others[0];
    if (next) router.replace(`/ask/${next.id}`);
    else router.back();
  };

  const send = async (action: string): Promise<void> => {
    if (!ask) return;
    setBusy(true);
    setNotice(null);
    const out = await answerAsk(ask, action, text);
    setBusy(false);
    if (out.ok) {
      impact(ImpactStyle.Medium);
      useToast.getState().show(action);
      leave();
      return;
    }
    // La cause réelle, jamais un libellé fixe : une question déjà répondue sur le Mac et
    // un Mac injoignable ne demandent pas la même chose à Robin.
    setNotice({ tone: out.kind === 'gone' ? 'warn' : 'error', text: t.askFailed(out.cause) });
  };

  const later = async (seconds: number, label: string): Promise<void> => {
    if (!ask) return;
    setBusy(true);
    setNotice(null);
    const out = await snoozeAsk(ask, seconds);
    setBusy(false);
    if (out.ok) {
      impact(ImpactStyle.Light);
      useToast.getState().show(t.askLaterFor(label));
      leave();
      return;
    }
    setNotice({ tone: out.kind === 'gone' ? 'warn' : 'error', text: t.askFailed(out.cause) });
  };

  const copy = async (): Promise<void> => {
    if (!ask) return;
    await copyOrShare(ask.message);
    setCopied(true);
    useToast.getState().show(t.askCopied);
  };

  if (!supported) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + space[3] }]}>
        <EmptyState title={t.askUnsupportedTitle} body={t.askUnsupportedBody}>
          <Button label={t.actionSeeSessions} onPress={() => router.replace('/')} />
        </EmptyState>
      </View>
    );
  }

  if (!ask) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + space[3] }]}>
        <EmptyState title={t.askGoneTitle} body={t.askGoneBody}>
          <Button
            label={others.length > 0 ? t.askBannerAction : t.actionSeeSessions}
            onPress={() => (others[0] ? router.replace(`/ask/${others[0].id}`) : router.replace('/'))}
          />
        </EmptyState>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[3] }]}>
      <View style={styles.header}>
        <Txt variant="title2" color={colors.text.primary}>
          {t.askFrom(ask.from)}
        </Txt>
        <View style={styles.grow} />
        <LinkAction icon="x" label={t.actionClose} onPress={() => router.back()} />
      </View>

      {degraded ? <Banner tone="warn" text={t.askOffline} /> : null}
      {notice ? <Banner tone={notice.tone === 'warn' ? 'warn' : notice.tone} text={notice.text} /> : null}
      {/* L'agent n'attend plus sur sa socket : la réponse passera par sa conversation. */}
      {!ask.waiting ? <Banner text={t.askNotWaiting} /> : null}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
      >
        <View style={styles.meta}>
          <Txt variant="caption" color={colors.text.tertiary}>
            {clockTime(ask.askedAtMs)}
            {ask.cwd ? ` · ${ask.cwd}` : ''}
          </Txt>
          <View style={styles.grow} />
          <LinkAction icon="copy" label={copied ? t.askCopied : t.askCopy} onPress={() => void copy()} />
        </View>

        {/* Sélectionnable : une question porte souvent un chemin ou une commande à relire. */}
        <View style={styles.message}>
          <Txt variant="body" color={colors.text.primary} selectable>
            {ask.message}
          </Txt>
        </View>

        {ask.input ? (
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            autoCorrect
            multiline
            keyboardAppearance="dark"
            maxLength={ASK_TEXT_MAX}
            placeholder={t.askPlaceholder}
            placeholderTextColor={colors.text.tertiary}
            accessibilityLabel={t.askPlaceholder}
          />
        ) : null}

        {/* Les boutons de l'agent, dans son ordre : le premier est celui que la carte du
            Mac tinte et que l'Entrée choisit. */}
        <View style={styles.buttons}>
          {ask.buttons.map((label, index) => (
            <Button
              key={label}
              label={busy ? t.askSending : label}
              kind={index === 0 ? 'primary' : 'secondary'}
              height={52}
              disabled={busy || degraded}
              onPress={() => void send(label)}
            />
          ))}
        </View>

        <View style={styles.divider} />

        <Txt variant="calloutStrong" color={colors.text.secondary}>
          {t.askLater}
        </Txt>
        <View style={styles.laters}>
          {snoozeChoices.map((choice) => (
            <Button
              key={choice.label}
              label={choice.label}
              kind="secondary"
              height={44}
              style={styles.laterPill}
              disabled={busy || degraded}
              onPress={() => void later(choice.seconds, choice.label)}
            />
          ))}
        </View>

        {others.length > 0 ? (
          <LinkAction
            icon="chevron-right"
            label={t.askMore(others.length)}
            onPress={() => others[0] && router.replace(`/ask/${others[0].id}`)}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  header: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingH,
  },
  grow: { flex: 1 },
  content: { paddingHorizontal: layout.screenPaddingH, gap: space[4], paddingTop: space[3] },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  message: {
    backgroundColor: colors.bg.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: space[4],
  },
  input: {
    minHeight: layout.composerMinHeight,
    maxHeight: layout.composerMaxHeight,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[3],
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    color: colors.text.primary,
    fontSize: 16,
  },
  buttons: { gap: space[3] },
  divider: { height: 1, backgroundColor: colors.border.subtle, marginTop: space[3] },
  laters: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  laterPill: { flexGrow: 0, paddingHorizontal: space[5] },
});
