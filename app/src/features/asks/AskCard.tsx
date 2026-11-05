// La carte d'une demande dans l'onglet Asks : une question d'agent ou une permission.
//
// Une question se repond en un geste : le check envoie le PREMIER bouton, la croix le
// SECOND, le crayon ouvre le Brief (option + instruction). Un texte libre ne part jamais
// seul et un mot hors `buttons` n'est jamais envoye : l'agent relit ce mot, il finit
// retape dans un terminal.
//
// Une permission, elle, n'est PAS repondue ici : ses boutons appellent `answerPrompt`,
// l'action exacte que la ValidationBar utilise (Face ID selon `optionRequiresFaceId`,
// `promptHash` et `awaitingSince` du prompt affiche). Le composant ValidationBar n'est pas
// incorpore : il est ancre au dessus d'un composer et empile toutes les options ; la carte
// reprend seulement ses deux ou trois gestes, avec la meme porte de securite.
//
// Une fiche de decisions (`kind: decision`) porte en plus `Open` : sa page (`url`) ou la
// fiche native de Kova (`sheet`) s'ouvre dans le panneau, ou elle se remplit en entier.
// Les boutons de la carte restent ceux de Kova (`answer-ask`), sauf le `Done` seul d'une
// fiche native : il rendrait une fiche vide, elle se rend depuis le panneau.
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import type { AskItem, Pane, Prompt, PromptOption, Tab } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, radius, space } from '@/theme';
import { Icon, type IconName } from '@/ui/Icon';
import { Txt, interFamily } from '@/ui/Txt';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { answerAsk, snoozeAsk } from '@/actions/ask';
import { useAsks } from '@/store/asks';
import { usePanes } from '@/store/panes';
import { ImpactStyle, impact } from '@/utils/haptics';
import { shortAgeMs } from '@/utils/time';
import { openInPanel } from '@/features/panel/open';
import { DECISION_DONE, askPanelTarget, isDecisionAsk, koOption, okOption } from './answer';
import { BriefSheet } from './BriefSheet';

/** Un agent qui n'a pas eu de reponse depuis deux heures passe en ambre (proto). */
const AGING_MS = 2 * 60 * 60 * 1000;
const CARD_RADIUS = 12;
const BUTTON_HEIGHT = 40;
const BUTTON_WIDTH = 44;

type ParsedPrompt = Extract<Prompt, { state: 'parsed' }>;

/**
 * Le pane d'une question : son identifiant de session Claude, sinon un cwd qui ne designe
 * qu'un seul pane. `null` quand rien ne correspond : pas d'icone « open pane » qui
 * ouvrirait au hasard.
 */
function paneForAsk(ask: AskItem, panes: readonly Pane[]): Pane | null {
  if (ask.sessionId) {
    const bySession = panes.find(
      (p) => p.agent_session_id === ask.sessionId || p.claude_session_id === ask.sessionId,
    );
    if (bySession) return bySession;
  }
  if (!ask.cwd) return null;
  const byCwd = panes.filter((p) => p.cwd === ask.cwd);
  return byCwd.length === 1 ? (byCwd[0] ?? null) : null;
}

/** Le nom de l'onglet d'un pane, sinon la derniere portion de son dossier. */
export function paneTabTitle(pane: Pane | null, tabs: readonly Tab[]): string {
  if (!pane) return '';
  const title = tabs.find(
    (tab) => tab.id === pane.tabId || (tab.window === pane.window && tab.tab_index === pane.tab),
  )?.title;
  if (title) return title;
  const parts = pane.cwd.split('/').filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}

export function AskCard({
  ask,
  now,
  unavailable = false,
  showHeader = true,
  showMessage = true,
  onDone,
}: {
  ask: AskItem;
  now: number;
  /** Mac injoignable : rien ne partirait, les gestes sont desactives (comme la barre). */
  unavailable?: boolean;
  showHeader?: boolean;
  showMessage?: boolean;
  /** Apres un envoi reussi : l'ecran de detail passe a la question suivante. */
  onDone?: () => void;
}) {
  const phase = useAsks((s) => s.phase[ask.id]) ?? 'idle';
  const notice = useAsks((s) => s.notice[ask.id]) ?? null;
  const choices = useAsks((s) => s.snoozeChoices);
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const [menu, setMenu] = useState(false);
  const [brief, setBrief] = useState(false);

  const pane = useMemo(() => paneForAsk(ask, panes), [ask, panes]);
  const panelTarget = askPanelTarget(ask);
  const decision = isDecisionAsk(ask);
  const fromCard = okOption(ask);
  const ok = ask.sheet === true && fromCard === DECISION_DONE ? null : fromCard;
  const ko = koOption(ask);
  const sending = phase === 'sending';
  const sent = phase === 'sent';

  const send = async (action: string, text: string): Promise<void> => {
    useAsks.getState().setNotice(ask.id, null);
    useAsks.getState().setPhase(ask.id, 'sending');
    const out = await answerAsk(ask, action, text);
    if (out.ok) {
      impact(ImpactStyle.Medium);
      useAsks.getState().setPhase(ask.id, 'sent');
      onDone?.();
      return;
    }
    useAsks.getState().setPhase(ask.id, 'failed');
    useAsks.getState().setNotice(ask.id, t.askFailed(out.cause));
  };

  const snooze = async (seconds: number): Promise<void> => {
    setMenu(false);
    useAsks.getState().setNotice(ask.id, null);
    useAsks.getState().setPhase(ask.id, 'sending');
    const out = await snoozeAsk(ask, seconds);
    if (out.ok) {
      impact(ImpactStyle.Light);
      useAsks.getState().setPhase(ask.id, 'sent');
      onDone?.();
      return;
    }
    useAsks.getState().setPhase(ask.id, 'failed');
    useAsks.getState().setNotice(ask.id, t.askFailed(out.cause));
  };

  return (
    <CardFrame decision={decision} onOpen={() => panelTarget !== null && openInPanel(panelTarget)}>
      {showHeader ? (
        <CardHeader from={ask.from} tab={paneTabTitle(pane, tabs)} at={ask.askedAtMs} now={now} />
      ) : null}

      {showMessage ? (
        // Une fiche dit de quoi elle parle sur plusieurs lignes (titre, puis ses decisions) :
        // rendue entiere, sans `selectable`, qui prendrait le tap de la carte.
        <Txt
          variant="callout"
          color={colors.text.primary}
          {...(decision ? {} : { numberOfLines: 8, selectable: true })}
        >
          {ask.message}
        </Txt>
      ) : null}

      {sending ? (
        <StateLine icon="send" text={t.askSendingTo(ask.from)} />
      ) : sent ? (
        <StateLine icon="check-circle" color={colors.status.success} text={t.askSentTo(ask.from)} />
      ) : (
        <>
          <View style={styles.actions}>
            {panelTarget !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.askOpenSheetA11y(ask.from)}
                disabled={unavailable && panelTarget.kind === 'sheet'}
                hitSlop={6}
                onPress={() => {
                  impact(ImpactStyle.Light);
                  openInPanel(panelTarget);
                }}
                style={({ pressed }) => [styles.open, pressed && styles.iconPressed]}
              >
                <Icon name="layout" size={16} color={colors.text.primary} />
                <Txt variant="footnote" color={colors.text.primary}>
                  {t.askOpenSheet}
                </Txt>
              </Pressable>
            ) : null}
            {panelTarget === null || ok !== null ? (
              <IconButton
                icon="check"
                color={colors.status.success}
                label={ok !== null ? t.askOkA11y(ok) : t.askOk}
                disabled={unavailable || ok === null}
                onPress={() => ok !== null && void send(ok, '')}
              />
            ) : null}
            {ko !== null ? (
              <IconButton
                icon="x"
                color={colors.status.error}
                label={t.askKoA11y(ko)}
                disabled={unavailable}
                onPress={() => void send(ko, '')}
              />
            ) : null}
            <IconButton
              icon="edit-3"
              color={colors.text.primary}
              label={t.askBriefA11y(ask.from)}
              disabled={unavailable}
              onPress={() => setBrief(true)}
            />
            <View style={styles.grow} />
            {pane ? (
              <IconButton
                ghost
                icon="external-link"
                color={colors.text.tertiary}
                label={t.askOpenPane}
                onPress={() => router.push(`/session/${pane.id}`)}
              />
            ) : null}
            <IconButton
              ghost
              icon="moon"
              color={colors.text.tertiary}
              label={t.askSnooze}
              disabled={unavailable || choices.length === 0}
              onPress={() => setMenu((open) => !open)}
            />
          </View>

          <View style={styles.okline}>
            {ok !== null ? (
              <>
                <Icon name="check" size={12} color={colors.status.success} />
                <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1} style={styles.option}>
                  {ok}
                </Txt>
              </>
            ) : null}
            {ko !== null ? (
              <>
                <View style={styles.koIcon}>
                  <Icon name="x" size={12} color={colors.status.error} />
                </View>
                <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1} style={styles.option}>
                  {ko}
                </Txt>
              </>
            ) : null}
            <View style={styles.grow} />
            {!ask.waiting ? (
              <>
                <Icon name="info" size={12} color={colors.text.tertiary} />
                <Txt variant="footnote" color={colors.text.tertiary}>
                  {t.askSessionEnded}
                </Txt>
              </>
            ) : null}
          </View>
        </>
      )}

      {menu && !sending && !sent && choices.length > 0 ? (
        <View style={styles.menu}>
          {choices.map((choice) => (
            <Pressable
              key={choice.label}
              accessibilityRole="button"
              accessibilityLabel={choice.label}
              onPress={() => void snooze(choice.seconds)}
              style={({ pressed }) => [styles.menuChoice, pressed && styles.menuChoicePressed]}
            >
              <Txt variant="footnote" color={colors.text.secondary}>
                {choice.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}

      {notice !== null && !sending && !sent ? (
        <Txt variant="footnote" color={colors.status.error}>
          {notice}
        </Txt>
      ) : null}

      <BriefSheet
        ask={ask}
        visible={brief}
        now={now}
        onClose={() => setBrief(false)}
        onSend={(action, text) => send(action, text)}
      />
    </CardFrame>
  );
}

/**
 * Le cadre de la carte. Une fiche de decisions s'ouvre d'un tap n'importe ou : les boutons
 * de la carte restent des `Pressable` enfants, qui prennent leur tap avant le cadre.
 * `accessible={false}` garde ces boutons atteignables par VoiceOver, `Open` y suffit.
 */
function CardFrame({ decision, onOpen, children }: { decision: boolean; onOpen: () => void; children: ReactNode }) {
  if (!decision) return <View style={styles.card}>{children}</View>;
  return (
    <Pressable
      accessible={false}
      onPress={() => {
        impact(ImpactStyle.Light);
        onOpen();
      }}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {children}
    </Pressable>
  );
}

/** Une permission ouverte sur le Mac. Les gestes sont ceux de la ValidationBar. */
export function PermissionCard({
  prompt,
  from,
  tab,
  approve,
  reject,
  always,
  now,
  busy,
  sent,
  notice,
  unavailable,
  onAnswer,
}: {
  prompt: ParsedPrompt;
  from: string;
  tab: string;
  approve: PromptOption | null;
  reject: PromptOption | null;
  always: PromptOption | null;
  now: number;
  busy: boolean;
  sent: boolean;
  notice: string | null;
  unavailable: boolean;
  onAnswer: (option: PromptOption) => void;
}) {
  const at = Date.parse(prompt.awaitingSince);
  return (
    <View style={styles.card}>
      <CardHeader
        from={from}
        tab={tab}
        tag={t.askPermissionTag}
        at={Number.isFinite(at) ? at : now}
        now={now}
      />

      <Txt variant="callout" color={colors.text.primary} numberOfLines={8}>
        {prompt.question}
      </Txt>

      {prompt.detail.length > 0 ? (
        <View style={styles.code}>
          <Txt variant="monoCode" color={colors.text.primary} numberOfLines={8}>
            {prompt.detail.join('\n')}
          </Txt>
        </View>
      ) : null}

      {busy ? (
        <StateLine icon="send" text={t.askSending} />
      ) : sent ? (
        <StateLine icon="check-circle" color={colors.status.success} text={t.askSentTo(from)} />
      ) : null}

      {!busy && !sent ? (
        <>
          <View style={styles.actions}>
            <IconButton
              icon="check"
              color={colors.status.success}
              label={t.askApprove}
              disabled={unavailable || approve === null}
              onPress={() => approve !== null && onAnswer(approve)}
            />
            <IconButton
              icon="x"
              color={colors.status.error}
              label={t.askReject}
              disabled={unavailable || reject === null}
              onPress={() => reject !== null && onAnswer(reject)}
            />
            {always !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.askAlways}
                disabled={unavailable}
                hitSlop={6}
                onPress={() => onAnswer(always)}
                style={({ pressed }) => [styles.always, pressed && styles.iconPressed]}
              >
                <Txt
                  variant="footnote"
                  color={unavailable ? colors.text.disabled : colors.action.interrupt.text}
                >
                  {t.askAlways}
                </Txt>
              </Pressable>
            ) : null}
          </View>
          {unavailable ? (
            <Txt variant="footnote" color={colors.text.secondary}>
              {t.askOffline}
            </Txt>
          ) : null}
        </>
      ) : null}

      {notice !== null && !busy && !sent ? (
        <Txt variant="footnote" color={colors.status.error}>
          {notice}
        </Txt>
      ) : null}
    </View>
  );
}

function CardHeader({
  from,
  tab,
  tag,
  at,
  now,
}: {
  from: string;
  tab: string;
  tag?: string;
  at: number;
  now: number;
}) {
  const aging = now - at >= AGING_MS;
  return (
    <View style={styles.header}>
      <StatusGlyph state="awaiting" size={8} />
      <Txt variant="footnote" color={colors.text.primary} numberOfLines={1} style={styles.from}>
        {from}
      </Txt>
      {tab.length > 0 ? (
        <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1} style={styles.tab}>
          {tab}
        </Txt>
      ) : null}
      {tag !== undefined ? (
        <View style={styles.tag}>
          <Txt variant="caption" color={colors.text.secondary}>
            {tag}
          </Txt>
        </View>
      ) : null}
      <View style={styles.grow} />
      <Txt variant="caption" color={aging ? colors.status.awaiting : colors.text.tertiary}>
        {shortAgeMs(now - at)}
      </Txt>
    </View>
  );
}

function IconButton({
  icon,
  label,
  color,
  ghost = false,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  color: string;
  ghost?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        impact(ImpactStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        ghost ? styles.iconGhost : styles.iconFill,
        pressed && styles.iconPressed,
      ]}
    >
      <Icon name={icon} size={20} color={disabled ? colors.text.disabled : color} />
    </Pressable>
  );
}

function StateLine({
  icon,
  text,
  color = colors.text.secondary,
}: {
  icon: IconName;
  text: string;
  color?: string;
}) {
  return (
    <View style={styles.stateLine}>
      <Icon name={icon} size={14} color={color} />
      <Txt variant="footnote" color={color} numberOfLines={2} style={styles.grow}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: CARD_RADIUS,
    padding: space[5],
    gap: space[2],
  },
  cardPressed: { backgroundColor: colors.bg.pressed },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 18 },
  from: { fontFamily: interFamily('600'), flexShrink: 1 },
  tab: { flexShrink: 1 },
  tag: {
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.base,
    borderRadius: radius.xs,
    paddingHorizontal: space[1],
  },
  grow: { flex: 1 },
  code: {
    backgroundColor: colors.bg.base,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.xs,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[1] },
  iconButton: {
    width: BUTTON_WIDTH,
    height: BUTTON_HEIGHT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFill: { backgroundColor: colors.action.neutral.bg },
  iconGhost: { backgroundColor: 'transparent' },
  iconPressed: { backgroundColor: colors.bg.pressed },
  okline: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  option: { flexShrink: 1 },
  koIcon: { marginLeft: space[1] },
  menu: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[1] },
  menuChoice: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.base,
  },
  menuChoicePressed: { backgroundColor: colors.bg.pressed },
  open: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: BUTTON_HEIGHT,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.action.neutral.bg,
  },
  always: {
    minHeight: BUTTON_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  stateLine: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: BUTTON_HEIGHT },
});
