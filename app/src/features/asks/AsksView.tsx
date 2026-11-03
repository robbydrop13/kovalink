// Onglet Asks (P05) : tout ce qui attend Robin, du plus recent au plus ancien.
//
// Deux sortes de demandes dans la meme liste, parce qu'elles demandent le meme geste : les
// questions des agents (`kova ask`) et les permissions ouvertes sur le Mac. Une question se
// repond par un bouton de la question ou par un Brief ; une permission passe par
// `answerPrompt`, l'action de la ValidationBar (Face ID et `promptHash` compris).
//
// Les questions reportees restent visibles, replies, avec leur heure de retour : un report
// n'est pas un abandon. Rien n'est rafraichi a la main, le daemon pousse la liste.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AskItem, Pane, Prompt, PromptOption } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Banner, EmptyState } from '@/ui/States';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { Button } from '@/ui/Button';
import { answerPrompt } from '@/actions/answer';
import { snoozeAsk } from '@/actions/ask';
import { dueAsks, snoozedAsks, useAsks } from '@/store/asks';
import { usePrompts } from '@/store/prompts';
import { usePanes } from '@/store/panes';
import { isDegraded, useConnection } from '@/store/connection';
import { useHomeTab } from '@/store/homeTab';
import { TAB_BAR_HEIGHT } from '@/features/home/TabBar';
import { useClock } from '@/utils/useClock';
import { NotifyType, notify } from '@/utils/haptics';
import { clockTime } from '@/utils/time';
import { AskCard, PermissionCard, paneTabTitle } from './AskCard';

type ParsedPrompt = Extract<Prompt, { state: 'parsed' }>;

/** Une ligne de la liste : une question, ou une permission. */
type FeedItem =
  | { key: string; at: number; kind: 'ask'; ask: AskItem }
  | { key: string; at: number; kind: 'prompt'; prompt: ParsedPrompt };

/** Les trois gestes d'une permission : approuver, refuser, toujours approuver. */
function permissionOptions(prompt: ParsedPrompt): {
  approve: PromptOption | null;
  reject: PromptOption | null;
  always: PromptOption | null;
} {
  const sorted = [...prompt.options].sort((a, b) => a.index - b.index);
  return {
    approve: sorted.find((o) => o.kind === 'approve') ?? sorted.find((o) => o.kind === 'neutral') ?? null,
    reject: sorted.find((o) => o.kind === 'reject') ?? null,
    always: sorted.find((o) => o.kind === 'approve_always') ?? null,
  };
}

export function AsksView() {
  const insets = useSafeAreaInsets();
  const asks = useAsks((s) => s.asks);
  const supported = useAsks((s) => s.supported);
  const prompts = usePrompts((s) => s.byPane);
  const phases = usePrompts((s) => s.phase);
  const notices = usePrompts((s) => s.notice);
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const degraded = isDegraded(useConnection((s) => s.link));
  const setTab = useHomeTab((s) => s.setTab);
  const now = useClock(true, 30_000);
  const [openSnoozed, setOpenSnoozed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les permissions sortent du magasin de prompts, filtrees sur `parsed` : un prompt
  // illisible ne propose pas de bouton (meme regle que la ValidationBar).
  const feed = useMemo(() => {
    const items: FeedItem[] = [
      ...dueAsks(asks).map((ask) => ({ key: `ask-${ask.id}`, at: ask.askedAtMs, kind: 'ask' as const, ask })),
      ...Object.values(prompts).flatMap((prompt) => {
        if (prompt.state !== 'parsed') return [];
        const at = Date.parse(prompt.awaitingSince);
        return [
          {
            key: `prompt-${prompt.paneId}`,
            at: Number.isFinite(at) ? at : 0,
            kind: 'prompt' as const,
            prompt,
          },
        ];
      }),
    ];
    return items.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  }, [asks, prompts]);

  const snoozed = useMemo(
    () => [...snoozedAsks(asks)].sort((a, b) => a.snoozedUntilMs - b.snoozedUntilMs),
    [asks],
  );

  /**
   * Approuver, refuser, toujours. `answerPrompt` est l'action que l'ecran de session
   * appelle depuis la ValidationBar : Face ID et `promptHash` sont inchanges, la carte ne
   * reimplemente aucune regle de securite.
   */
  const answerPermission = async (prompt: ParsedPrompt, option: PromptOption): Promise<void> => {
    const store = usePrompts.getState();
    store.setPhase(prompt.paneId, 'authenticating', option.index);
    const out = await answerPrompt({
      paneId: prompt.paneId,
      optionIndex: option.index,
      optionKind: option.kind,
      optionLabel: option.label,
      promptHash: prompt.promptHash,
      awaitingSince: prompt.awaitingSince,
    });
    if (!out.ok) {
      store.setPhase(prompt.paneId, out.kind === 'cancelled' ? 'armed' : 'failed');
      if (out.kind === 'cancelled') return;
      notify(NotifyType.Error);
      store.setNotice(
        prompt.paneId,
        out.kind === 'refused'
          ? t.sessionRefusedByMac(out.cause)
          : t.sessionSendFailedRetry(out.cause),
      );
      return;
    }
    if (out.result.applied) {
      store.setPhase(prompt.paneId, 'sent');
      notify(NotifyType.Success);
      return;
    }
    if (out.result.reason === 'prompt_changed') {
      store.setPhase(prompt.paneId, 'hash_mismatch');
      store.setNotice(prompt.paneId, t.sessionPromptChanged);
      notify(NotifyType.Warning);
      return;
    }
    if (out.result.reason === 'pane_gone') {
      store.setPhase(prompt.paneId, 'expired');
      store.setNotice(prompt.paneId, t.sessionGoneNothingSent);
      notify(NotifyType.Warning);
      return;
    }
    if (out.result.reason === 'not_awaiting') {
      store.setPhase(prompt.paneId, 'expired');
      store.setNotice(prompt.paneId, t.sessionAnsweredOnMac);
      return;
    }
    store.setPhase(prompt.paneId, 'armed');
    store.setNotice(prompt.paneId, t.sessionAlreadyAnswered);
  };

  /** « Show now » : pas de route de report annule, un delai d'une seconde fait revenir la question. */
  const showNow = async (ask: AskItem): Promise<void> => {
    setError(null);
    const out = await snoozeAsk(ask, 1);
    if (!out.ok) setError(t.askFailed(out.cause));
  };

  if (!supported) {
    return (
      <View style={styles.screen}>
        <EmptyState title={t.askUnsupportedTitle} body={t.askUnsupportedBody}>
          <Button label={t.actionSeeSessions} kind="secondary" height={40} onPress={() => setTab('panes')} />
        </EmptyState>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {degraded ? <Banner tone="warn" text={t.askOffline} /> : null}
      {error !== null ? <Banner tone="error" text={error} /> : null}

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + space[8] },
        ]}
      >
        {feed.length > 0 ? (
          <Txt variant="footnote" color={colors.text.tertiary} style={styles.subtitle}>
            {t.askListSubtitle(feed.length)}
          </Txt>
        ) : null}

        {feed.length === 0 ? (
          <EmptyState icon="check-circle" title={t.askEmptyTitle} body={t.askEmptyBody} />
        ) : null}

        {feed.map((item) => {
          if (item.kind === 'ask') {
            return <AskCard key={item.key} ask={item.ask} now={now} unavailable={degraded} />;
          }
          const prompt = item.prompt;
          const pane = panes.find((p) => p.id === prompt.paneId) ?? null;
          const tab = paneTabTitle(pane, tabs);
          const { approve, reject, always } = permissionOptions(prompt);
          const phase = phases[prompt.paneId];
          return (
            <PermissionCard
              key={item.key}
              prompt={prompt}
              from={pane?.agent ?? pane?.title ?? (tab.length > 0 ? tab : t.askPermissionFrom)}
              tab={tab}
              approve={approve}
              reject={reject}
              always={always}
              now={now}
              busy={phase === 'authenticating' || phase === 'sending'}
              sent={phase === 'sent'}
              notice={notices[prompt.paneId] ?? null}
              unavailable={degraded}
              onAnswer={(option) => void answerPermission(prompt, option)}
            />
          );
        })}

        {snoozed.length > 0 ? (
          <View style={styles.snoozedSection}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.askSnoozed(snoozed.length)}
              accessibilityState={{ expanded: openSnoozed }}
              onPress={() => setOpenSnoozed((open) => !open)}
              style={styles.snoozedHeader}
            >
              <Icon
                name={openSnoozed ? 'chevron-down' : 'chevron-right'}
                size={14}
                color={colors.text.tertiary}
              />
              <Txt variant="caption" color={colors.text.tertiary} style={styles.snoozedTitle}>
                {t.askSnoozed(snoozed.length).toUpperCase()}
              </Txt>
            </Pressable>

            {openSnoozed
              ? snoozed.map((ask) => (
                  <View key={ask.id} style={styles.snoozedCard}>
                    <View style={styles.snoozedLine}>
                      <Txt variant="footnote" color={colors.text.primary} numberOfLines={1} style={styles.grow}>
                        {ask.from}
                      </Txt>
                      <Txt variant="caption" color={colors.text.tertiary}>
                        {t.askBackAt(clockTime(ask.snoozedUntilMs))}
                      </Txt>
                    </View>
                    <Txt variant="footnote" color={colors.text.secondary} numberOfLines={3}>
                      {ask.message}
                    </Txt>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.askShowNow}
                      onPress={() => void showNow(ask)}
                      style={styles.showNow}
                    >
                      <Txt variant="footnote" color={colors.accent.primary}>
                        {t.askShowNow}
                      </Txt>
                    </Pressable>
                  </View>
                ))
            : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: space[2], gap: space[2] },
  subtitle: { paddingHorizontal: space[1], paddingBottom: space[1] },
  snoozedSection: { gap: space[2], marginTop: space[4] },
  snoozedHeader: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[1] },
  snoozedTitle: { letterSpacing: 0.6 },
  snoozedCard: {
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: space[5],
    gap: space[2],
    opacity: 0.75,
  },
  snoozedLine: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  grow: { flex: 1 },
  showNow: {
    alignSelf: 'flex-start',
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
});

