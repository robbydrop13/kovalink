// Écran « Nouvelle session » : le Cmd+O de Kova depuis l'iPhone (PRD A9).
//
// La liste est celle des projets récents de Kova (`recent_projects.json`, lue par le
// daemon). Un tap crée l'onglet sur le Mac avec `claude` lancé dans ce dossier, puis
// ouvre la session dans l'app. Rien n'est lancé à la simple ouverture de cet écran, et
// aucun chemin libre ne part de l'iPhone : le daemon résout un index dans SA liste.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RecentProject } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { LinkAction } from '@/ui/Button';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { fetchRecentProjects, postNewTab } from '@/net/http';
import { isDegraded, useConnection } from '@/store/connection';
import { shortAge } from '@/utils/time';
import { ImpactStyle, impact } from '@/utils/haptics';

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export default function NewSessionScreen() {
  const insets = useSafeAreaInsets();
  /** `cwd` : relance d'une session périmée, le projet du pane est mis en avant. */
  const params = useLocalSearchParams<{ cwd?: string }>();
  const wantedCwd = typeof params.cwd === 'string' && params.cwd.length > 0 ? params.cwd : null;
  const link = useConnection((s) => s.link);
  const kova = useConnection((s) => s.kova);
  const degraded = isDegraded(link);
  const [projects, setProjects] = useState<RecentProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** Index du projet en cours de lancement : une seule création à la fois. */
  const [launching, setLaunching] = useState<number | null>(null);

  const load = useCallback(() => {
    // Les `setState` vivent dans les rappels de la promesse : l'effet ne fait qu'abonner.
    void fetchRecentProjects().then(
      (res) => {
        setProjects(res.projects);
        setError(null);
      },
      (e: unknown) => {
        setProjects([]);
        setError(`Projets récents indisponibles. ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    if (!projects) return [];
    const words = fold(query).split(/\s+/).filter((w) => w.length > 0);
    const list =
      words.length === 0
        ? projects
        : projects.filter((p) => {
            const hay = fold(`${p.label} ${p.path}`);
            return words.every((w) => hay.includes(w));
          });
    // Le projet de la session à relancer passe en tête, sans rien cacher des autres.
    if (!wantedCwd) return list;
    const wanted = list.filter((p) => p.path === wantedCwd);
    return wanted.length > 0 ? [...wanted, ...list.filter((p) => p.path !== wantedCwd)] : list;
  }, [projects, query, wantedCwd]);
  const wantedMissing = wantedCwd !== null && projects !== null && !projects.some((p) => p.path === wantedCwd);

  const open = useCallback(
    async (project: RecentProject) => {
      if (launching !== null) return;
      setLaunching(project.index);
      setError(null);
      impact(ImpactStyle.Medium);
      try {
        const res = await postNewTab(project);
        // `replace` : le retour depuis la session ramène à la liste, pas à cet écran. Sans
        // `launched`, la commande attend dans le shell du nouveau pane : la vue Term le montre.
        router.replace(res.launched ? `/session/${res.paneId}` : `/session/${res.paneId}?view=term`);
      } catch (e) {
        setError(`Création impossible. ${e instanceof Error ? e.message : String(e)}`);
        setLaunching(null);
      }
    },
    [launching],
  );

  const blocked = degraded || kova === 'down';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <LinkAction label="< Sessions" onPress={() => router.back()} />
        <View style={styles.grow} />
        <Txt variant="title2" color={colors.text.primary}>
          Nouvelle session
        </Txt>
        <View style={styles.grow} />
        <View style={styles.navSpacer} />
      </View>

      {blocked ? (
        <Banner
          tone={kova === 'down' ? 'warn' : link === 'offline' ? 'offline' : 'warn'}
          text={kova === 'down' ? 'Kova n’est pas lancé sur le Mac' : 'Mac injoignable pour le moment'}
        />
      ) : null}
      {error ? <Banner tone="error" text={error} actionLabel="Réessayer" onAction={load} /> : null}
      {wantedMissing ? (
        <Banner
          tone="warn"
          text={`${wantedCwd} n’est pas dans les projets récents de Kova : ouvre le dossier une fois sur le Mac.`}
        />
      ) : null}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Filtrer les projets"
          placeholderTextColor={colors.text.tertiary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          keyboardAppearance="dark"
          accessibilityLabel="Filtrer les projets récents"
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
      >
        <Txt variant="caption" color={colors.text.tertiary} style={styles.hint}>
          {wantedCwd && !wantedMissing
            ? 'Relancer Claude : le dossier de la session périmée est en tête.'
            : 'Un tap ouvre un onglet Kova sur le Mac, avec Claude lancé dans ce dossier.'}
        </Txt>
        {projects === null ? <SkeletonList count={5} height={56} /> : null}
        {projects !== null && shown.length === 0 ? (
          <EmptyState
            title={query ? 'Aucun projet ne correspond' : 'Aucun projet récent'}
            body={query ? 'Essaie un autre mot.' : 'Ouvre un projet dans Kova, il apparaîtra ici.'}
          />
        ) : null}
        <View style={styles.stack}>
          {shown.map((p) => {
            const busy = launching === p.index;
            const wanted = p.path === wantedCwd;
            return (
              <Pressable
                key={p.index}
                accessibilityRole="button"
                accessibilityLabel={`${p.label}, ouvert il y a ${shortAge(new Date(p.lastOpenedMs).toISOString())}`}
                accessibilityHint="Crée un onglet Kova avec Claude dans ce dossier"
                accessibilityState={{ disabled: blocked || (launching !== null && !busy) }}
                disabled={blocked || launching !== null}
                onPress={() => void open(p)}
                style={({ pressed }) => [styles.row, wanted && styles.wanted, pressed && styles.pressed, blocked && styles.dim]}
              >
                <View style={styles.body}>
                  <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1}>
                    {p.label}
                  </Txt>
                  <Txt variant="monoPath" color={colors.text.tertiary} numberOfLines={1}>
                    {p.path}
                  </Txt>
                </View>
                <Txt variant="footnote" color={busy ? colors.status.working : colors.text.tertiary}>
                  {busy ? 'création…' : shortAge(new Date(p.lastOpenedMs).toISOString())}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  nav: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingH,
  },
  grow: { flex: 1 },
  navSpacer: { width: 72 },
  searchRow: { paddingHorizontal: layout.screenPaddingH, paddingVertical: space[3] },
  search: {
    height: 36,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.raised,
    color: colors.text.primary,
    fontSize: 15,
  },
  content: { paddingHorizontal: layout.screenPaddingH },
  hint: { marginBottom: space[4] },
  stack: { gap: space[3] },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  wanted: { borderWidth: 1, borderColor: colors.accent.primary },
  dim: { opacity: 0.5 },
  body: { flex: 1, gap: 2 },
});
