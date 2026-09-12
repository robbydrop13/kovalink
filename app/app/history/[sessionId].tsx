// Session fermée en LECTURE SEULE (design 4.11) : le transcript, tiré par pages depuis le
// Mac, sans rien lancer. Un seul bouton d'action, « Reprendre », qui crée l'onglet avec
// `claude --resume` sur action explicite (PRD 3.4).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { indexToolResults, type Turn } from '@/protocol';
import { colors, layout, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { AssistantTurn, OrphanResults, UserBubble } from '@/features/chat/Bubble';
import { resumeSession } from '@/features/sessions/resume';
import { fetchTurns } from '@/net/http';
import { merge, toolCallIds } from '@/store/session';
import { truncatePath } from '@/utils/time';

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sessionId: string; cwd?: string; title?: string }>();
  const sessionId = params.sessionId;
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  // Les `setState` vivent dans les rappels de la promesse : l'effet ne fait qu'abonner.
  // `loading` est posé dans le même rappel, jamais en tête d'effet.
  const load = useCallback(
    (beforeSeq?: number) => {
      const request = fetchTurns(sessionId, beforeSeq === undefined ? { limit: 200 } : { beforeSeq, limit: 100 });
      void Promise.resolve().then(() => setLoading(true));
      void request.then(
        (page) => {
          setTurns((t) => merge(t ?? [], page.turns, []));
          setHasMore(page.hasMoreBefore);
          setError(null);
          setLoading(false);
        },
        (e: unknown) => {
          setError(`Transcript indisponible. ${e instanceof Error ? e.message : String(e)}`);
          setTurns((t) => t ?? []);
          setLoading(false);
        },
      );
    },
    [sessionId],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const results = useMemo(() => indexToolResults(turns ?? []), [turns]);
  const callIds = useMemo(() => toolCallIds(turns ?? []), [turns]);
  const first = turns?.[0];

  const resume = useCallback(async () => {
    setResuming(true);
    const ok = await resumeSession(
      {
        sessionId,
        cwd: params.cwd ?? '',
        projectName: params.cwd?.split('/').pop() ?? '',
        title: params.title ?? '',
        lastActiveMs: 0,
        promptCount: 0,
        state: 'closed',
        paneId: null,
        bookmarked: false,
      },
      setToast,
    );
    if (!ok) setResuming(false);
  }, [sessionId, params.cwd, params.title]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <LinkAction label="< Retour" onPress={() => router.back()} />
        <View style={styles.grow} />
        <Txt variant="caption" color={colors.text.tertiary}>
          lecture seule
        </Txt>
      </View>
      <View style={styles.subtitle}>
        <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1}>
          {params.title ?? 'Session fermée'}
        </Txt>
        {params.cwd ? (
          <Txt variant="monoPath" color={colors.text.tertiary} numberOfLines={1}>
            {truncatePath(params.cwd, 44)}
          </Txt>
        ) : null}
      </View>
      {error ? <Banner tone="error" text={error} actionLabel="Réessayer" onAction={() => load()} /> : null}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: space[8] }]}>
        {turns === null ? <SkeletonList count={4} height={72} /> : null}
        {turns !== null && turns.length === 0 && !error ? (
          <EmptyState title="Transcript vide" body="Cette session n’a aucun échange lisible." />
        ) : null}
        {hasMore && first ? (
          <View style={styles.more}>
            <LinkAction label={loading ? 'Chargement…' : 'Charger plus ancien'} disabled={loading} onPress={() => load(first.seq)} />
          </View>
        ) : null}
        <View style={styles.turns}>
          {(turns ?? []).map((turn) => {
            if (turn.kind === 'user') return <UserBubble key={turn.id} turn={turn} state="sent" />;
            if (turn.kind === 'tool_result') return <OrphanResults key={turn.id} turn={turn} callIds={callIds} />;
            return <AssistantTurn key={turn.id} turn={turn} working={false} streaming={false} results={results} />;
          })}
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space[3] }]}>
        <Button
          label={resuming ? 'Reprise…' : 'Reprendre cette session'}
          disabled={resuming}
          accessibilityHint="Lance Claude sur le Mac dans un nouvel onglet, avec l’historique de cette session"
          onPress={() => void resume()}
        />
      </View>

      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + layout.touchPrimary + space[6] }]}>
          <Txt variant="footnote" color={colors.text.primary}>
            {toast}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  nav: { height: layout.navBarHeight, flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPaddingH },
  grow: { flex: 1 },
  subtitle: { paddingHorizontal: layout.screenPaddingH, paddingBottom: space[3], gap: 2 },
  content: { paddingHorizontal: layout.screenPaddingH },
  more: { alignItems: 'center', paddingVertical: space[3] },
  turns: { gap: space[4] },
  bottomBar: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[3],
    backgroundColor: colors.bg.base,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: 999,
    backgroundColor: colors.bg.overlay,
  },
});
