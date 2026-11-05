// La file d'attention (`attn`) dans l'onglet Asks : une ligne d'entree, puis les deux
// sections du bas, « Au prochain point » (repliee, par sujet) et « Pour memoire » (un
// compte qui se deplie en titres). Les regles (sections, comptes, boutons) vivent dans
// `attention.ts` ; ce fichier ne fait que les rendre.
//
// Une file vide ne prend aucune place : pas d'etat vide, pas d'en-tete a zero.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  ATTENTION_DONE,
  ATTENTION_IGNORE,
  ATTENTION_OPEN,
  ATTENTION_SEND,
  type AttentionButton,
  type AttentionEntry,
} from '@/protocol';
import { t } from '@/i18n/en';
import { colors, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt, interFamily } from '@/ui/Txt';
import { StatusGlyph } from '@/ui/StatusGlyph';
import { ImpactStyle, impact } from '@/utils/haptics';
import { shortAgeMs } from '@/utils/time';
import { openInPanel } from '@/features/panel/open';
import {
  attentionAtMs,
  attentionButtonEnabled,
  attentionButtons,
  attentionOpenTarget,
  type TopicGroup,
} from './attention';
import { useAttentionStore } from './useAttention';

const BUTTON_HEIGHT = 36;

const LABEL: Record<AttentionButton, string> = {
  [ATTENTION_OPEN]: t.attnOpen,
  [ATTENTION_SEND]: t.attnSend,
  [ATTENTION_IGNORE]: t.attnIgnore,
  [ATTENTION_DONE]: t.attnDone,
};

/** Une entree : titre, ce qu'il faut de Robin, qui, depuis quand, et ses boutons. */
export function AttentionRow({
  entry,
  now,
  unavailable,
}: {
  entry: AttentionEntry;
  now: number;
  unavailable: boolean;
}) {
  const phase = useAttentionStore((s) => s.phase[entry.id]) ?? 'idle';
  const notice = useAttentionStore((s) => s.notice[entry.id]) ?? null;
  const act = useAttentionStore((s) => s.act);
  const buttons = attentionButtons(entry);
  const age = shortAgeMs(now - attentionAtMs(entry));

  const press = (button: AttentionButton): void => {
    impact(ImpactStyle.Light);
    if (button === ATTENTION_OPEN) {
      const target = attentionOpenTarget(entry.action);
      if (target !== null) openInPanel(target);
      return;
    }
    void act(entry.id, button);
  };

  return (
    <View style={styles.card} accessibilityLabel={t.attnRowA11y(entry.title, entry.from, age)}>
      <View style={styles.header}>
        {/* Ambre pour ce qui attend maintenant, neutre pour le prochain point. */}
        <StatusGlyph state={entry.level === 'now' ? 'awaiting' : 'idle'} size={8} />
        <Txt variant="footnote" color={colors.text.primary} numberOfLines={1} style={styles.from}>
          {entry.from}
        </Txt>
        <View style={styles.grow} />
        <Txt variant="caption" color={colors.text.tertiary}>
          {age}
        </Txt>
      </View>
      <Txt variant="callout" color={colors.text.primary} numberOfLines={3}>
        {entry.title}
      </Txt>
      {entry.needs ? (
        <Txt variant="footnote" color={colors.text.secondary} numberOfLines={3}>
          {entry.needs}
        </Txt>
      ) : null}

      {phase === 'sending' ? (
        <StateLine icon="send" text={t.attnSending} />
      ) : phase === 'sent' ? (
        <StateLine icon="check-circle" color={colors.status.success} text={t.attnSent(entry.from)} />
      ) : phase === 'unknown' ? (
        <StateLine icon="help-circle" text={t.attnUnknown} />
      ) : null}

      {buttons.length > 0 ? (
        <View style={styles.actions}>
          {buttons.map((button) => {
            const enabled = attentionButtonEnabled(button, phase, entry, unavailable);
            return (
              <Pressable
                key={button}
                accessibilityRole="button"
                accessibilityLabel={LABEL[button]}
                accessibilityState={{ disabled: !enabled }}
                disabled={!enabled}
                hitSlop={6}
                onPress={() => press(button)}
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              >
                <Txt variant="footnote" color={enabled ? colors.text.primary : colors.text.disabled}>
                  {LABEL[button]}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {notice !== null && phase !== 'sending' ? (
        <Txt variant="footnote" color={colors.status.error}>
          {notice}
        </Txt>
      ) : null}
    </View>
  );
}

/** « Au prochain point (N) » : replie par defaut, deplie par sujet. */
export function PointSection({
  groups,
  count,
  now,
  unavailable,
}: {
  groups: TopicGroup[];
  count: number;
  now: number;
  unavailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <View style={styles.section}>
      <SectionToggle title={t.attnPointTitle(count)} open={open} onToggle={() => setOpen((v) => !v)} />
      {open
        ? groups.map((group) => (
            <View key={group.topic ?? ''} style={styles.group}>
              <Txt variant="caption" color={colors.text.tertiary} style={styles.topic}>
                {group.topic ?? t.attnNoTopic}
              </Txt>
              {group.entries.map((entry) => (
                <AttentionRow key={entry.id} entry={entry} now={now} unavailable={unavailable} />
              ))}
            </View>
          ))
        : null}
    </View>
  );
}

/** « Pour memoire (N) » : une ligne de compte, qui se deplie en titres seulement. */
export function MemoSection({ entries }: { entries: AttentionEntry[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionToggle title={t.attnMemoTitle(entries.length)} open={open} onToggle={() => setOpen((v) => !v)} />
      {open
        ? entries.map((entry) => (
            <Txt key={entry.id} variant="footnote" color={colors.text.secondary} numberOfLines={1} style={styles.memo}>
              {entry.title}
            </Txt>
          ))
        : null}
    </View>
  );
}

function SectionToggle({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={styles.toggle}
    >
      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={colors.text.tertiary} />
      <Txt variant="caption" color={colors.text.tertiary} style={styles.toggleTitle}>
        {title.toUpperCase()}
      </Txt>
    </Pressable>
  );
}

function StateLine({
  icon,
  text,
  color = colors.text.secondary,
}: {
  icon: 'send' | 'check-circle' | 'help-circle';
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
    borderRadius: 12,
    padding: space[5],
    gap: space[2],
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 18 },
  from: { fontFamily: interFamily('600'), flexShrink: 1 },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2], marginTop: space[1] },
  button: {
    minHeight: BUTTON_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.action.neutral.bg,
  },
  buttonPressed: { backgroundColor: colors.bg.pressed },
  stateLine: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  section: { gap: space[2], marginTop: space[4] },
  group: { gap: space[2] },
  topic: { paddingHorizontal: space[1], letterSpacing: 0.4 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[1] },
  toggleTitle: { letterSpacing: 0.6 },
  memo: { paddingHorizontal: space[5] },
});
