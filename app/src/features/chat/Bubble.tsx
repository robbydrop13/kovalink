// Tours de conversation, conventions de l'app Claude (docs/13-chat-lisibilite.md).
//
// Le texte de l'assistant est rendu SANS bulle, pleine largeur, en 17 pt : c'est ce que
// Robin lit. Seul le message de l'utilisateur garde une bulle discrète, à droite. Les
// actions sont des lignes compactes de 14 pt secondaire (`ToolRow`, `ToolGroup`), et les
// résultats du monospace 13 pt.
//
// Les lignes `assistant` du JSONL sont regroupées par `requestId` côté daemon (A16) : un
// `Turn` est donc déjà une réponse complète, et le champ `usage` n'est jamais sommé ici.
// Les lignes `queue-operation` ne sont jamais rendues (C22) : le daemon ne les émet pas.
//
// Résultats d'outils : le daemon les émet dans des tours séparés (kind `tool_result`), une
// ligne `user` du JSONL chacun. Ils ne sont JAMAIS dans les blocs du tour assistant. La
// jointure par `toolUseId` (`indexToolResults`, protocole) est faite une fois par l'écran.
//
// Copier un message (13 septembre) : un appui long sur la bulle de Robin ou sur le texte
// de l'assistant ouvre `Copier / Partager`, comme dans l'app Claude. Le texte copié est
// celui du tour entier (blocs texte joints), jamais les appels d'outils.
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Animated, Pressable, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useToast } from '@/store/toast';
import { copyOrShare } from '@/utils/clipboard';
import { ImpactStyle, impact } from '@/utils/haptics';
import type { ToolResultBlock, Turn } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, motion, radius, space } from '@/theme';
import { imageCount, textOf } from '@/store/session';
import { Txt } from '@/ui/Txt';
import { Icon, type IconName } from '@/ui/Icon';
import { AttachmentChips } from './AttachmentViews';
import { splitAttachmentLines, type Attachment } from './attachments';
import { Markdown } from './Markdown';
import { segmentBlocks } from './segments';
import { ToolGroup } from './ToolGroup';

export type SendState = 'queued' | 'sent' | 'failed';

/** Appui long sur un message : `Copier`, `Partager`, ou rien. */
export function messageActions(text: string): void {
  if (text.length === 0) return;
  impact(ImpactStyle.Medium);
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [t.bubbleCopy, t.bubbleShare, t.actionCancel], cancelButtonIndex: 2 },
    (index) => {
      if (index === 0 && copyOrShare(text)) useToast.getState().show(t.bubbleCopied);
      else if (index === 1) void Share.share({ message: text }).catch(() => undefined);
    },
  );
}

/**
 * Bulle de Robin. Les pièces jointes (docs/15) s'y montrent en vignettes, le chemin est
 * masqué : pour une bulle locale, les fichiers sont encore sur l'iPhone (`attachments`) ;
 * pour un tour du transcript, les lignes de chemin en fin de message sont détachées.
 */
export function UserBubble({
  turn,
  state,
  onRetry,
  attachments,
  error,
}: {
  turn: Turn;
  state?: SendState;
  onRetry?: () => void;
  attachments?: Attachment[];
  /** Cause d'un échec, sous la bulle, en rouge. */
  error?: string;
}) {
  const { width } = useWindowDimensions();
  // État d'envoi en icône : `clock` en file, `alert-circle` en échec, `check` livré.
  const markIcon: IconName = state === 'queued' ? 'clock' : state === 'failed' ? 'alert-circle' : 'check';
  const markColor =
    state === 'failed' ? colors.status.error : state === 'queued' ? colors.text.tertiary : colors.status.success;
  const raw = textOf(turn.blocks);
  const { text, paths } = attachments && attachments.length > 0 ? { text: raw, paths: [] } : splitAttachmentLines(raw);
  const images = attachments && attachments.length > 0 ? 0 : imageCount(turn.blocks);
  const hasPieces = (attachments?.length ?? 0) > 0 || paths.length > 0 || images > 0;
  // Texte PUIS vignettes, pour la bulle locale comme pour le tour réel : le remplacement
  // de l'une par l'autre ne fait aucun saut visuel.
  return (
    <View style={styles.userWrap}>
      {text.length > 0 ? (
        <Pressable
          accessibilityHint={t.bubbleLongPressHint}
          onLongPress={() => messageActions(text)}
          style={({ pressed }) => [styles.userBubble, { maxWidth: width * layout.bubbleMaxWidthRatio }, pressed && styles.held]}
        >
          <Txt variant="body" color={colors.text.primary}>
            {text}
          </Txt>
        </Pressable>
      ) : null}
      {hasPieces ? (
        <View style={{ maxWidth: width * layout.bubbleMaxWidthRatio }}>
          <AttachmentChips local={attachments} paths={paths} images={images} />
        </View>
      ) : null}
      {state === 'failed' && error ? (
        <View style={{ maxWidth: width * layout.bubbleMaxWidthRatio }}>
          <Txt variant="footnote" color={colors.status.error}>
            {error}
          </Txt>
        </View>
      ) : null}
      <View style={styles.meta}>
        <Txt variant="footnote" color={colors.text.tertiary}>
          {timeOf(turn.ts)}
        </Txt>
        {state === 'failed' && onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.bubbleResendA11y}
            hitSlop={8}
            onPress={onRetry}
            style={styles.resend}
          >
            <Icon name="alert-circle" size={14} color={colors.status.error} />
            <Txt variant="footnote" color={colors.status.error}>
              {t.bubbleResend}
            </Txt>
          </Pressable>
        ) : (
          <Icon name={markIcon} size={14} color={markColor} accessibilityLabel={state ?? 'sent'} />
        )}
      </View>
    </View>
  );
}

/**
 * Évènement du harnais (`kind: 'system'`) : ligne repliée, discrète, centrée, « System ·
 * résumé ». Jamais une bulle, jamais à droite : Robin ne l'a pas écrit. Un tap déplie le
 * contenu brut en monospace.
 */
export function SystemRow({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false);
  const raw = textOf(turn.blocks);
  const summary = turn.summary || turn.systemTag || t.systemLabel;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.systemLabel}, ${summary}`}
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((v) => !v)}
      style={styles.systemWrap}
    >
      <Txt variant="footnote" color={colors.text.tertiary} align="center" numberOfLines={open ? undefined : 1}>
        {t.systemLabel} · {summary}
      </Txt>
      {open ? (
        <View style={styles.systemRaw}>
          <Txt variant="monoCode" color={colors.text.secondary} selectable>
            {raw}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Évènements discrets regroupés : un compteur, dépliable en lignes système. */
export function QuietSystemRow({ turns }: { turns: Turn[] }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.systemWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.systemEvents(turns.length)}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
      >
        <Txt variant="caption" color={colors.text.disabled} align="center">
          {t.systemEvents(turns.length)}
        </Txt>
      </Pressable>
      {open ? turns.map((turn) => <SystemRow key={turn.id} turn={turn} />) : null}
    </View>
  );
}

export function AssistantTurn({
  turn,
  working,
  streaming,
  results,
}: {
  turn: Turn;
  /** Le pane travaille encore : un appel SANS résultat est alors « en cours ». */
  working: boolean;
  /**
   * Tour en cours d'écriture : le daemon le complète ligne par ligne (V6), et un point
   * pulse en fin de texte tant qu'il n'est pas clos.
   */
  streaming: boolean;
  /** Jointure `toolUseId` vers résultat, calculée sur tous les tours en mémoire. */
  results: ReadonlyMap<string, ToolResultBlock>;
}) {
  const segments = segmentBlocks(turn.blocks);
  const lastIndex = segments.length - 1;
  const whole = textOf(turn.blocks);
  return (
    <View style={styles.assistantWrap}>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return (
            <Pressable
              key={i}
              accessibilityHint={t.bubbleLongPressHint}
              onLongPress={() => messageActions(whole)}
              style={({ pressed }) => [styles.textBlock, pressed && styles.held]}
            >
              <Markdown text={seg.text} />
              {streaming && i === lastIndex ? <StreamDot /> : null}
            </Pressable>
          );
        }
        if (seg.kind === 'tools') {
          return <ToolGroup key={i} calls={seg.calls} results={results} working={working} />;
        }
        return (
          <Txt key={i} variant="footnote" color={colors.text.tertiary} style={styles.thinking}>
            {t.bubbleThinking}
          </Txt>
        );
      })}
      {streaming && (segments.length === 0 || segments[lastIndex]?.kind !== 'text') ? <StreamDot /> : null}
    </View>
  );
}

/**
 * Résultats ORPHELINS : leur `tool_use` n'est pas dans les tours en mémoire (il est au delà
 * de la fenêtre chargée). Tout résultat rattaché est rendu dans sa ligne d'action, jamais
 * ici : sans ce filtre, un tour à 21 outils donnait 21 boîtes de sortie brutes.
 */
export function OrphanResults({ turn, callIds }: { turn: Turn; callIds: ReadonlySet<string> }) {
  const results = turn.blocks.filter(
    (b): b is ToolResultBlock => b.type === 'tool_result' && !callIds.has(b.toolUseId),
  );
  if (results.length === 0) return null;
  return (
    <View style={styles.assistantWrap}>
      {results.map((r, i) => (
        <View key={`${r.toolUseId}-${i}`} style={styles.resultBox}>
          <Txt variant="monoCode" color={r.isError ? colors.status.error : colors.text.secondary}>
            {r.preview}
          </Txt>
        </View>
      ))}
    </View>
  );
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Point qui pulse : l'agent écrit, ou n'a pas encore commencé à écrire. */
export function StreamDot() {
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: motion.pulse / 2, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.pulse / 2, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      accessibilityLabel={t.bubbleStreamingA11y}
      style={[styles.streamDot, { opacity: pulse }]}
    />
  );
}

const styles = StyleSheet.create({
  userWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', gap: space[2], marginVertical: space[4] },
  held: { opacity: 0.7 },
  userBubble: {
    backgroundColor: colors.accent.subtleBg,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingVertical: space[4],
    paddingHorizontal: space[5],
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  assistantWrap: { alignSelf: 'stretch', marginVertical: space[3], gap: space[2] },
  resend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  systemWrap: { alignSelf: 'stretch', alignItems: 'center', marginVertical: space[2], gap: space[2], paddingHorizontal: space[4] },
  systemRaw: {
    alignSelf: 'stretch',
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.bg.inset,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  textBlock: { paddingVertical: space[2] },
  thinking: { paddingHorizontal: space[3], paddingVertical: space[1] },
  streamDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.status.working,
    marginTop: space[3],
    marginLeft: space[1],
  },
  resultBox: {
    backgroundColor: colors.bg.inset,
    borderRadius: radius.md,
    padding: space[4],
    marginVertical: space[2],
  },
});
