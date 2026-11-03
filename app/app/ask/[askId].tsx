// La question d'un agent (`kova ask`), sur le telephone.
//
// Cible du lien profond `kovalink://ask/{askId}` et du bandeau de la liste. L'ecran ne
// resout rien : la liste des questions vit dans le store, diffusee par le daemon a chaque
// changement, et une question repondue sur le Mac disparait d'ici pendant qu'on la lit.
//
// Les gestes sont ceux de la carte de l'onglet Asks (`AskCard`) : check, croix, Brief et
// report ne sont pas reecrits ici, sinon ils finiraient par diverger. L'ecran garde ce qui
// n'a de sens que sur une question ouverte : le message entier, le chemin et le geste Copy.
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner, EmptyState } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { AskCard } from '@/features/asks/AskCard';
import { dueAsks, useAsks } from '@/store/asks';
import { isDegraded, useConnection } from '@/store/connection';
import { useToast } from '@/store/toast';
import { copyOrShare } from '@/utils/clipboard';
import { clockTime } from '@/utils/time';
import { useClock } from '@/utils/useClock';

export default function AskScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ askId: string }>();
  const askId = String(params.askId ?? '');
  const asks = useAsks((s) => s.asks);
  const supported = useAsks((s) => s.supported);
  const ask = asks.find((a) => a.id === askId) ?? null;
  const others = useMemo(() => dueAsks(asks).filter((a) => a.id !== askId), [asks, askId]);
  const [copied, setCopied] = useState(false);
  const degraded = isDegraded(useConnection((s) => s.link));
  const now = useClock(true, 30_000);

  /** Apres un geste reussi : la question suivante, sinon on sort. */
  const leave = (): void => {
    const next = others[0];
    if (next) router.replace(`/ask/${next.id}`);
    else router.back();
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

        {/* Selectionnable : une question porte souvent un chemin ou une commande a relire. */}
        <View style={styles.message}>
          <Txt variant="body" color={colors.text.primary} selectable>
            {ask.message}
          </Txt>
        </View>

        <AskCard
          ask={ask}
          now={now}
          unavailable={degraded}
          showHeader={false}
          showMessage={false}
          onDone={leave}
        />

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
});
