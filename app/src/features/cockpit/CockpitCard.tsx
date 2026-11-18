// Une carte du Cockpit, comme Kova la montre (`docs/cockpit.md`, Reply zone). Repliee : le
// titre, l'espace et le label ecrits, `de · age`, les icones de tete et le bouton principal.
// Ouverte dans la liste : ce qu'il faut, le corps, le detail, le brouillon modifiable, les
// captures, puis la zone de reponse. Les regles vivent dans `rules.ts`, les gestes dans
// `useCockpit.ts` ; ce fichier ne fait que les rendre.
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { AttentionEntry } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, radius, space } from '@/theme';
import { Icon, type IconName } from '@/ui/Icon';
import { Txt, interFamily } from '@/ui/Txt';
import { ImpactStyle, impact } from '@/utils/haptics';
import { fileUrl } from '@/net/files';
import { openAsk, openInPanel } from '@/features/panel/open';
import { useAsks } from '@/store/asks';
import { LEFT, RESEND, isoWithOffset, snoozeDate, type SnoozeChoice } from './gesture';
import {
  askRefOf,
  cockpitAge,
  cockpitButtons,
  cockpitGoLabel,
  cockpitIcons,
  cockpitOpenTarget,
  cockpitScope,
  cockpitWaitingAgent,
  cockpitZoneGestures,
  cockpitZoneShownFolded,
  cockpitZoned,
  inkOn,
  resolveAskId,
  type CockpitButton,
  type CockpitIcon,
} from './rules';
import { useCockpit } from './useCockpit';

const BUTTON_HEIGHT = 36;

const ICON_OF: Record<CockpitIcon, IconName> = { snooze: 'clock', seen: 'eye', dismiss: 'x', done: 'check' };
const ICON_LABEL: Record<CockpitIcon, string> = {
  snooze: t.cockpitSnooze,
  seen: t.cockpitSeen,
  dismiss: t.cockpitDismiss,
  done: t.cockpitDone,
};

const SNOOZE_CHOICES: { choice: SnoozeChoice; label: string }[] = [
  { choice: 'hour', label: t.cockpitSnoozeHour },
  { choice: 'evening', label: t.cockpitSnoozeEvening },
  { choice: 'morning', label: t.cockpitSnoozeMorning },
  { choice: 'monday', label: t.cockpitSnoozeMonday },
];

export function CockpitCard({ entry, now, unavailable }: { entry: AttentionEntry; now: number; unavailable: boolean }) {
  const id = entry.id;
  const expanded = useCockpit((s) => s.expanded[id] === true);
  const running = useCockpit((s) => s.running[id] !== undefined);
  const text = useCockpit((s) => s.texts[id] ?? '');
  const edited = useCockpit((s) => s.drafts[id]);
  const store = useCockpit.getState;
  const off = unavailable || running;

  const zoneShown = cockpitZoned(entry) && (expanded || cockpitZoneShownFolded(entry));
  const icons = cockpitIcons(entry, zoneShown);
  // La zone ouverte porte deja Go et la reponse : il ne reste que Voir et les issues d'un envoi incertain.
  const buttons = cockpitButtons(entry);
  const shownButtons = zoneShown ? buttons.filter((b) => b === 'open' || b === LEFT || b === RESEND) : buttons;
  const scope = cockpitScope(entry);
  const waiting = cockpitWaitingAgent(entry);

  const gesture = (word: Parameters<ReturnType<typeof store>['gesture']>[1]): void => {
    impact(ImpactStyle.Light);
    void store().gesture(entry, word);
  };

  const snooze = (): void => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t.cockpitSnooze,
        options: [...SNOOZE_CHOICES.map((c) => c.label), t.cockpitSnoozeCancel],
        cancelButtonIndex: SNOOZE_CHOICES.length,
      },
      (index) => {
        const picked = SNOOZE_CHOICES[index];
        if (picked) void store().snooze(entry, isoWithOffset(snoozeDate(picked.choice, new Date())));
      },
    );
  };

  const pressIcon = (icon: CockpitIcon): void => {
    if (icon === 'snooze') snooze();
    else gesture(icon);
  };

  const pressButton = (button: CockpitButton): void => {
    if (button === 'open') {
      const target = cockpitOpenTarget(entry);
      if (target !== null) openInPanel(target);
      return;
    }
    if (button === 'sheet') {
      const ref = askRefOf(entry.action);
      if (ref !== null) openAsk(resolveAskId(ref.id, useAsks.getState().asks.map((a) => a.id)));
      return;
    }
    if (button === 'go' || button === LEFT || button === RESEND) {
      gesture(button);
      return;
    }
    // Repondre, Decider, Tester, Brief : ouvrent la carte sur sa zone.
    store().open(id);
  };

  return (
    <View
      style={[styles.card, running && styles.going]}
      pointerEvents={running ? 'none' : 'auto'}
      accessibilityState={{ busy: running }}
    >
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => store().toggle(id)} style={styles.body}>
        <View style={styles.head}>
          <Chip name={scope === 'perso' ? t.cockpitScopePerso : t.cockpitScopeClaap} color={colors.bg.overlay} ink={colors.text.primary} />
          {entry.label ? <Chip name={entry.label.name} color={entry.label.color} ink={inkOn(entry.label.color)} /> : null}
          <View style={styles.grow} />
          {icons.map((icon) => (
            <Pressable
              key={icon}
              accessibilityRole="button"
              accessibilityLabel={ICON_LABEL[icon]}
              {...(icon === 'seen' ? { accessibilityHint: t.cockpitSeenHint } : {})}
              disabled={off}
              hitSlop={8}
              onPress={() => pressIcon(icon)}
              style={styles.iconButton}
            >
              {icon === 'seen' ? (
                <Txt variant="footnote" color={off ? colors.text.disabled : colors.text.secondary}>
                  {t.cockpitSeen}
                </Txt>
              ) : (
                <Icon name={ICON_OF[icon]} size={16} color={off ? colors.text.disabled : colors.text.secondary} />
              )}
            </Pressable>
          ))}
        </View>
        <Txt variant="callout" color={colors.text.primary} numberOfLines={expanded ? undefined : 3} style={styles.title}>
          {entry.title}
        </Txt>
        <Txt variant="caption" color={colors.text.tertiary} numberOfLines={1}>
          {[entry.from, cockpitAge(entry, now)].filter((s) => s.length > 0).join(' · ')}
        </Txt>
      </Pressable>

      {entry.failed ? <StateLine icon="alert-triangle" color={colors.status.error} text={t.cockpitFailed(entry.failed)} /> : null}
      {entry.uncertain ? <StateLine icon="help-circle" color={colors.status.awaiting} text={t.cockpitUncertain(entry.uncertain)} /> : null}
      {running ? <StateLine icon="loader" color={colors.text.secondary} text={t.cockpitRunning} /> : null}

      {waiting ? (
        <View style={styles.asked}>
          <StateLine
            icon="message-square"
            color={colors.status.awaiting}
            text={entry.ask?.label ? `${t.cockpitWaitingAgent} · ${entry.ask.label}` : t.cockpitWaitingAgent}
          />
          {entry.ask ? (
            <Txt variant="footnote" color={colors.text.secondary}>
              {entry.ask.text}
            </Txt>
          ) : null}
          {(entry.gestures ?? []).includes('cancel') ? (
            <TextButton label={t.cockpitCancelAsk} disabled={off} onPress={() => gesture('cancel')} />
          ) : null}
        </View>
      ) : null}

      {expanded ? <Details entry={entry} /> : null}
      {zoneShown || (expanded && entry.draft) ? <DraftEditor entry={entry} edited={edited} disabled={off} /> : null}
      {zoneShown || expanded ? <Shots entry={entry} /> : null}

      {zoneShown && cockpitZoneGestures(entry).length > 0 ? (
        <View style={styles.zone}>
          <Txt variant="footnote" color={colors.text.secondary}>
            {t.cockpitReplyOn}
            <Txt variant="footnote" color={colors.text.primary} style={styles.bold}>
              {entry.title}
            </Txt>
          </Txt>
          <TextInput
            value={text}
            onChangeText={(v) => store().setText(id, v)}
            style={styles.input}
            // Entree est un saut de ligne : rien ne part du clavier.
            multiline
            editable={!off}
            keyboardAppearance="dark"
            textAlignVertical="top"
            placeholder={t.cockpitReplyPlaceholder}
            placeholderTextColor={colors.text.tertiary}
            accessibilityLabel={`${t.cockpitReplyOn}${entry.title}`}
          />
          {text.trim().length === 0 && (entry.gestures ?? []).includes('ask') ? (
            <Txt variant="caption" color={colors.text.tertiary}>
              {t.cockpitAskHint}
            </Txt>
          ) : null}
          <View style={styles.actions}>
            {cockpitZoneGestures(entry).map((g) =>
              g === 'go' ? (
                <FilledButton key={g} icon="check" label={cockpitGoLabel(entry)} disabled={off} onPress={() => gesture('go')} />
              ) : g === 'nogo' ? (
                <OutlinedButton key={g} icon="x" label={t.cockpitNoGo} disabled={off} onPress={() => gesture('nogo')} />
              ) : g === 'ask' ? (
                <TextButton
                  key={g}
                  icon="message-square"
                  label={t.cockpitAsk}
                  hint={t.cockpitAskHint}
                  disabled={off || text.trim().length === 0}
                  onPress={() => gesture('ask')}
                />
              ) : (
                <TextButton key={g} icon="check" label={t.cockpitSeen} hint={t.cockpitSeenHint} disabled={off} onPress={() => gesture('seen')} />
              ),
            )}
          </View>
        </View>
      ) : null}

      {shownButtons.length > 0 ? (
        <View style={styles.actions}>
          {shownButtons.map((b) => {
            const label = buttonLabel(entry, b);
            const isMain = b === 'go' || b === 'decide' || b === 'test' || b === 'brief' || b === 'sheet';
            const disabled = running || (unavailable && b !== 'open');
            return isMain ? (
              <FilledButton key={b} label={label} disabled={disabled} onPress={() => pressButton(b)} />
            ) : (
              <TextButton key={b} label={label} disabled={disabled} onPress={() => pressButton(b)} />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function buttonLabel(entry: AttentionEntry, b: CockpitButton): string {
  switch (b) {
    case 'open':
      return t.cockpitOpen;
    case LEFT:
      return t.cockpitLeft;
    case RESEND:
      return t.cockpitResend;
    case 'respond':
      return t.cockpitRespond;
    case 'go':
      return cockpitGoLabel(entry);
    case 'decide':
    case 'sheet':
      return t.cockpitDecide;
    case 'test':
      return t.cockpitTest;
    case 'brief':
      return t.cockpitBrief;
  }
}

/** Ce qu'il faut de Robin, le corps, le detail, la preuve et les sources. */
function Details({ entry }: { entry: AttentionEntry }) {
  return (
    <View style={styles.details}>
      {[entry.needs, entry.body, entry.detail].map((part, i) =>
        part ? (
          <Txt key={i} variant="footnote" color={i === 0 ? colors.text.primary : colors.text.secondary} selectable>
            {part}
          </Txt>
        ) : null,
      )}
      {entry.proof ? (
        <Txt variant="footnote" color={colors.text.secondary} selectable>
          {t.cockpitProof(entry.proof)}
        </Txt>
      ) : null}
      {entry.src && entry.src.length > 0 ? (
        <Txt variant="caption" color={colors.text.tertiary} selectable>
          {entry.src.join(' · ')}
        </Txt>
      ) : null}
    </View>
  );
}

/** Le brouillon : destinataire, canal, objet, et le texte, modifiable sur place. */
function DraftEditor({ entry, edited, disabled }: { entry: AttentionEntry; edited: string | undefined; disabled: boolean }) {
  const draft = entry.draft;
  if (!draft) return null;
  const value = edited ?? draft.text;
  const modified = edited !== undefined && edited !== draft.text;
  const head = [
    draft.to ? t.cockpitDraftTo(draft.to) : null,
    draft.targetLabel ?? draft.target ?? null,
    draft.channel ?? null,
    draft.subject ? t.cockpitDraftSubject(draft.subject) : null,
  ].filter((s): s is string => s !== null && s.length > 0);
  return (
    <View style={styles.draft}>
      {head.length > 0 ? (
        <Txt variant="footnote" color={colors.text.secondary}>
          {head.join('  ')}
        </Txt>
      ) : null}
      <TextInput
        value={value}
        onChangeText={(v) => useCockpit.getState().setDraft(entry.id, v)}
        style={styles.input}
        multiline
        editable={!disabled}
        keyboardAppearance="dark"
        textAlignVertical="top"
        accessibilityLabel={head.join(' ')}
      />
      <View style={styles.row}>
        <Icon name="edit-2" size={12} color={colors.text.tertiary} />
        <Txt variant="caption" color={colors.text.tertiary}>
          {modified ? t.cockpitDraftModified : t.cockpitDraftEditable}
        </Txt>
        {modified ? (
          <TextButton label={t.cockpitDraftRestore} disabled={disabled} onPress={() => useCockpit.getState().setDraft(entry.id, undefined)} />
        ) : null}
      </View>
    </View>
  );
}

/** Avant et Apres, servis par la route de lecture de fichiers du daemon ; un echec montre le chemin. */
function Shots({ entry }: { entry: AttentionEntry }) {
  const shots: { label: string; path: string }[] = [];
  if (entry.before !== undefined) shots.push({ label: t.cockpitBefore, path: entry.before });
  if (entry.after !== undefined) shots.push({ label: t.cockpitAfter, path: entry.after });
  if (shots.length === 0) return null;
  return (
    <View style={styles.shots}>
      {shots.map((s) => (
        <Shot key={s.label} label={s.label} path={s.path} />
      ))}
    </View>
  );
}

function Shot({ label, path }: { label: string; path: string }) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fileUrl(path).then(
      (s) => alive && setSource({ uri: s.url, headers: s.headers }),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [path]);
  return (
    <View style={styles.shot}>
      <Txt variant="caption" color={colors.text.tertiary}>
        {label}
      </Txt>
      {failed ? (
        <Txt variant="caption" color={colors.text.secondary} selectable>
          {t.cockpitShotUnreadable(path)}
        </Txt>
      ) : source ? (
        <Image
          source={source}
          style={styles.image}
          resizeMode="contain"
          accessibilityLabel={`${label} ${path}`}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

function Chip({ name, color, ink }: { name: string; color: string; ink: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color }]}>
      <Txt variant="caption" color={ink} numberOfLines={1}>
        {name}
      </Txt>
    </View>
  );
}

function StateLine({ icon, text, color }: { icon: IconName; text: string; color: string }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} size={14} color={color} />
      <Txt variant="footnote" color={color} style={styles.grow}>
        {text}
      </Txt>
    </View>
  );
}

interface ActionProps {
  label: string;
  onPress: () => void;
  disabled: boolean;
  icon?: IconName;
  hint?: string;
}

function FilledButton({ label, onPress, disabled, icon }: ActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles.filled, pressed && styles.filledPressed, disabled && styles.dim]}
    >
      {icon ? <Icon name={icon} size={14} color={colors.action.approve.text} /> : null}
      <Txt variant="footnote" color={colors.action.approve.text} style={styles.bold}>
        {label}
      </Txt>
    </Pressable>
  );
}

function OutlinedButton({ label, onPress, disabled, icon }: ActionProps) {
  const color = disabled ? colors.text.disabled : colors.text.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles.outlined, pressed && styles.pressed]}
    >
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Txt variant="footnote" color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

function TextButton({ label, onPress, disabled, icon, hint }: ActionProps) {
  const color = disabled ? colors.text.disabled : colors.accent.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint ? { accessibilityHint: hint } : {})}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={styles.textButton}
    >
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Txt variant="footnote" color={color}>
        {label}
      </Txt>
    </Pressable>
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
  going: { opacity: 0.45 },
  body: { gap: space[1] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 24 },
  grow: { flex: 1 },
  title: { fontFamily: interFamily('600') },
  bold: { fontFamily: interFamily('600') },
  chip: { borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: 2, maxWidth: 140 },
  iconButton: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  asked: { gap: space[1] },
  details: { gap: space[2] },
  draft: { gap: space[2] },
  zone: { gap: space[2], marginTop: space[1] },
  input: {
    minHeight: 72,
    maxHeight: 200,
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: space[3] },
  button: {
    minHeight: BUTTON_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  filled: { backgroundColor: colors.action.approve.bg },
  filledPressed: { backgroundColor: colors.action.approve.bgPressed },
  outlined: { borderWidth: 1, borderColor: colors.border.strong },
  pressed: { backgroundColor: colors.bg.pressed },
  dim: { opacity: 0.5 },
  textButton: { minHeight: BUTTON_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space[1] },
  shots: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  shot: { flexGrow: 1, flexBasis: 140, gap: space[1] },
  image: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.sm, backgroundColor: colors.bg.inset },
});
