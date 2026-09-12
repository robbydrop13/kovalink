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
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { ToolResultBlock, Turn } from '@/protocol';
import { colors, layout, motion, radius, space } from '@/theme';
import { imageCount, textOf } from '@/store/session';
import { Txt } from '@/ui/Txt';
import { AttachmentChips } from './AttachmentViews';
import { splitAttachmentLines, type Attachment } from './attachments';
import { Markdown } from './Markdown';
import { segmentBlocks } from './segments';
import { ToolGroup } from './ToolGroup';

export type SendState = 'queued' | 'sent' | 'failed';

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
  const mark = state === 'queued' ? 'o' : state === 'failed' ? '!' : 'v';
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
        <View style={[styles.userBubble, { maxWidth: width * layout.bubbleMaxWidthRatio }]}>
          <Txt variant="body" color={colors.text.primary}>
            {text}
          </Txt>
        </View>
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
          <Txt
            variant="footnote"
            color={colors.status.error}
            accessibilityRole="button"
            accessibilityLabel="Échec, renvoyer"
            onPress={onRetry}
          >
            {`${mark} renvoyer`}
          </Txt>
        ) : (
          <Txt variant="footnote" color={markColor}>
            {mark}
          </Txt>
        )}
      </View>
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
  return (
    <View style={styles.assistantWrap}>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return (
            <View key={i} style={styles.textBlock}>
              <Markdown text={seg.text} />
              {streaming && i === lastIndex ? <StreamDot /> : null}
            </View>
          );
        }
        if (seg.kind === 'tools') {
          return <ToolGroup key={i} calls={seg.calls} results={results} working={working} />;
        }
        return (
          <Txt key={i} variant="footnote" color={colors.text.tertiary} style={styles.thinking}>
            Réfléchit
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
      accessibilityLabel="l’agent écrit"
      style={[styles.streamDot, { opacity: pulse }]}
    />
  );
}

const styles = StyleSheet.create({
  userWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', gap: space[2], marginVertical: space[4] },
  userBubble: {
    backgroundColor: colors.accent.subtleBg,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingVertical: space[4],
    paddingHorizontal: space[5],
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  assistantWrap: { alignSelf: 'stretch', marginVertical: space[3], gap: space[2] },
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
