// Une fiche de decisions native de Kova (`kova ask --decisions`), repondue depuis le
// telephone : chaque decision et ses options (la recommandee marquee), une note libre par
// decision, une note globale, puis Done.
//
// Le brouillon part a Kova au fil de la saisie (`done: false`, l'etat entier, il remplace
// le precedent) : la fiche reprend la ou elle en etait, sur le Mac comme ici. Done repond
// a l'agent ; les decisions restees ouvertes deviennent une question de suite dans Asks.
//
// Pas de Face ID : comme la carte d'une question (`AskCard`), une reponse a un agent n'en
// demande pas. Un Kova anterieur a `get-sheet` le dit, et les boutons de la carte (via
// `answer-ask`) continuent de marcher.
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {
  SHEET_NOTE_MAX,
  SHEET_OTHER,
  type AskSheetResponse,
  type SheetAnswersPayload,
  type SheetDecision,
} from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { HttpError, fetchAskSheet, postAskSheet } from '@/net/http';
import { nonce } from '@/actions/nonce';
import { ImpactStyle, impact } from '@/utils/haptics';
import {
  answeredCount,
  answersPayload,
  choose,
  decisionState,
  setNote,
  stateFromDraft,
  type SheetState,
} from './sheetAnswers';
import { usePanelOpener } from './open';

/** Delai entre la derniere frappe et l'enregistrement du brouillon. */
const DRAFT_DEBOUNCE_MS = 800;

type Load =
  | { state: 'loading' }
  | { state: 'ready'; data: AskSheetResponse }
  | { state: 'tooOld' }
  | { state: 'gone' }
  | { state: 'error'; message: string };

type Send = { state: 'idle' } | { state: 'sending' } | { state: 'sent'; open: number } | { state: 'failed'; message: string };

function loadFailure(e: unknown): Load {
  if (e instanceof HttpError && e.code === 'KOVA_TOO_OLD') return { state: 'tooOld' };
  if (e instanceof HttpError && e.status === 404) return { state: 'gone' };
  return { state: 'error', message: e instanceof Error ? e.message : String(e) };
}

export function SheetView({ askId, onTitle }: { askId: string; onTitle: (title: string) => void }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [answers, setAnswers] = useState<SheetState>({ decisions: {}, note: '' });
  const [send, setSend] = useState<Send>({ state: 'idle' });
  const [draftError, setDraftError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Le brouillon pas encore parti : fermer la feuille ne doit pas perdre la derniere frappe.
  const pending = useRef<SheetAnswersPayload | null>(null);
  const open = usePanelOpener();

  useEffect(() => {
    let alive = true;
    fetchAskSheet(askId).then(
      (data) => {
        if (!alive) return;
        setAnswers(stateFromDraft(data.draft));
        setLoad({ state: 'ready', data });
        onTitle(data.sheet.title);
      },
      (e: unknown) => {
        if (alive) setLoad(loadFailure(e));
      },
    );
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      const unsent = pending.current;
      pending.current = null;
      if (unsent) void postAskSheet(askId, { answers: unsent, done: false }).catch(() => undefined);
    };
  }, [askId, onTitle]);

  if (load.state === 'loading') return <SkeletonList count={4} height={88} />;
  if (load.state === 'tooOld') return <EmptyState icon="refresh-cw" title={t.panelSheetUpdateKova} body="" />;
  if (load.state === 'gone') return <EmptyState icon="check-circle" title={t.panelClosed} body={t.panelSheetGone} />;
  if (load.state === 'error') return <Banner tone="error" text={load.message} />;

  const { sheet, from } = load.data;

  /** Chaque modification part en brouillon, regroupee : l'etat entier remplace le precedent. */
  const edit = (next: SheetState): void => {
    setAnswers(next);
    pending.current = answersPayload(sheet, next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const payload = pending.current;
      pending.current = null;
      if (!payload) return;
      postAskSheet(askId, { answers: payload, done: false }).then(
        () => setDraftError(null),
        (e: unknown) => {
          const failure = loadFailure(e);
          if (failure.state === 'tooOld' || failure.state === 'gone') setLoad(failure);
          else setDraftError(t.panelSheetDraftFailed(e instanceof Error ? e.message : String(e)));
        },
      );
    }, DRAFT_DEBOUNCE_MS);
  };

  const done = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    setSend({ state: 'sending' });
    try {
      const res = await postAskSheet(askId, { answers: answersPayload(sheet, answers), done: true, nonce: nonce() });
      impact(ImpactStyle.Medium);
      setSend({ state: 'sent', open: res.total - res.answered });
    } catch (e) {
      const failure = loadFailure(e);
      if (failure.state === 'tooOld' || failure.state === 'gone') {
        setSend({ state: 'idle' });
        setLoad(failure);
        return;
      }
      setSend({ state: 'failed', message: t.panelSheetFailed(e instanceof Error ? e.message : String(e)) });
    }
  };

  if (send.state === 'sent') {
    return (
      <EmptyState
        icon="check-circle"
        title={t.panelSheetSent(from)}
        body={send.open > 0 ? t.panelSheetFollowUp(send.open) : ''}
      />
    );
  }

  const count = answeredCount(sheet, answers);
  // Le titre d'un groupe s'affiche au dessus de sa premiere decision seulement.
  const groupHeaders = sheet.decisions.map((d, i) => {
    const group = d.group?.trim() || null;
    const previous = i > 0 ? sheet.decisions[i - 1]?.group?.trim() || null : null;
    return group !== null && group !== previous ? group : null;
  });

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={layout.navBarHeight}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {sheet.intro ? (
          <Txt variant="callout" color={colors.text.secondary}>
            {sheet.intro}
          </Txt>
        ) : null}
        {(sheet.links ?? []).map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            onPress={() => open({ kind: 'web', target: link.url })}
            style={styles.link}
          >
            <Icon name="external-link" size={14} color={colors.accent.primary} />
            <Txt variant="callout" color={colors.accent.primary} numberOfLines={1} style={styles.flex}>
              {link.label}
            </Txt>
          </Pressable>
        ))}

        {sheet.decisions.map((d, i) => {
          const header = groupHeaders[i] ?? null;
          return (
            <View key={d.id} style={styles.section}>
              {header ? (
                <Txt variant="caption" color={colors.text.tertiary} style={styles.group}>
                  {header}
                </Txt>
              ) : null}
              <DecisionCard
                decision={d}
                choice={decisionState(answers, d.id).choice}
                note={decisionState(answers, d.id).note}
                onChoose={(choice) => edit(choose(answers, d.id, choice))}
                onNote={(note) => edit(setNote(answers, d.id, note))}
              />
            </View>
          );
        })}

        <TextInput
          value={answers.note}
          onChangeText={(note) => edit({ ...answers, note })}
          style={styles.input}
          multiline
          maxLength={SHEET_NOTE_MAX}
          keyboardAppearance="dark"
          textAlignVertical="top"
          placeholder={t.panelSheetGlobalNote}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t.panelSheetGlobalNote}
        />

        {draftError ? <Banner tone="warn" text={draftError} /> : null}
        {send.state === 'failed' ? <Banner tone="error" text={send.message} /> : null}

        <View style={styles.footer}>
          <Txt variant="footnote" color={colors.text.tertiary} style={styles.flex}>
            {t.panelSheetProgress(count, sheet.decisions.length)}
          </Txt>
          <Button
            label={send.state === 'sending' ? t.panelSheetSending : t.panelSheetDone}
            disabled={send.state === 'sending'}
            height={44}
            style={styles.done}
            onPress={() => void done()}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DecisionCard({
  decision,
  choice,
  note,
  onChoose,
  onNote,
}: {
  decision: SheetDecision;
  choice: string | null;
  note: string;
  onChoose: (choice: string) => void;
  onNote: (note: string) => void;
}) {
  const options = [
    ...decision.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail ?? '', reco: o.reco === true })),
    { id: SHEET_OTHER, label: t.panelSheetOther, detail: t.panelSheetOtherHint, reco: false },
  ];
  return (
    <View style={styles.card}>
      <Txt variant="calloutStrong" color={colors.text.primary}>
        {decision.title}
      </Txt>
      {decision.context ? (
        <Txt variant="footnote" color={colors.text.secondary}>
          {decision.context}
        </Txt>
      ) : null}
      {options.map((o) => {
        const selected = choice === o.id;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={o.reco ? `${o.label}, ${t.panelSheetRecommended}` : o.label}
            onPress={() => {
              impact(ImpactStyle.Light);
              onChoose(o.id);
            }}
            style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.optionPressed]}
          >
            <Icon
              name={selected ? 'check-circle' : 'circle'}
              size={20}
              color={selected ? colors.accent.primary : colors.text.tertiary}
            />
            <View style={styles.flex}>
              <View style={styles.optionHead}>
                <Txt variant="callout" color={colors.text.primary} style={styles.optionLabel}>
                  {o.label}
                </Txt>
                {o.reco ? (
                  <View style={styles.badge}>
                    <Txt variant="caption" color={colors.accent.primary}>
                      {t.panelSheetRecommended}
                    </Txt>
                  </View>
                ) : null}
              </View>
              {o.detail ? (
                <Txt variant="footnote" color={colors.text.tertiary}>
                  {o.detail}
                </Txt>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      <TextInput
        value={note}
        onChangeText={onNote}
        style={[styles.input, styles.noteInput]}
        multiline
        maxLength={SHEET_NOTE_MAX}
        keyboardAppearance="dark"
        textAlignVertical="top"
        placeholder={t.panelSheetNote}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={`${t.panelSheetNote}, ${decision.title}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: layout.screenPaddingH, gap: space[4], paddingBottom: space[8] },
  link: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 32 },
  section: { gap: space[2] },
  group: { textTransform: 'uppercase', marginTop: space[2] },
  card: {
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    padding: space[4],
    gap: space[2],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
  },
  optionSelected: { backgroundColor: colors.accent.subtleBg },
  optionPressed: { backgroundColor: colors.bg.pressed },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  optionLabel: { flexShrink: 1 },
  badge: {
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: radius.xs,
    paddingHorizontal: space[1],
  },
  input: {
    minHeight: 44,
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
  },
  noteInput: { marginTop: space[1] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  done: { paddingHorizontal: space[6] },
});
