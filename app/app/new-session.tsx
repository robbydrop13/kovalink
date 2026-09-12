// Palette des projets : le Cmd+O de Kova sur l'iPhone (PRD A9).
//
// Les projets récents de Kova (`recent_projects.json`, lus par le daemon) en lignes : nom
// du dossier, chemin dessous, dernier accès à droite. Recherche en haut, clavier ouvert.
// Un tap crée l'onglet sur le Mac avec `claude` lancé dans ce dossier, puis ouvre la
// session. Rien n'est lancé à la simple ouverture de cette palette, et aucun chemin libre
// ne part de l'iPhone : le daemon résout un index dans SA liste.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import type { KovaSessionEntry, RecentProject } from '@/protocol';
import { colors } from '@/theme';
import { Banner } from '@/ui/States';
import { Palette, type PaletteRow } from '@/ui/Palette';
import { matchesQuery } from '@/utils/search';
import { fetchRecentProjects, fetchSessions, postNewTab } from '@/net/http';
import { closedOfProject } from '@/features/sessions/closedSessions';
import { askResume, readSession, sessionAge } from '@/features/sessions/resume';
import { isDegraded, useConnection } from '@/store/connection';
import { shortAge } from '@/utils/time';
import { ImpactStyle, impact } from '@/utils/haptics';

const CLOSED_PREFIX = 'closed:';

export default function NewSessionScreen() {
  /** `cwd` : relance d'une session périmée, le projet du pane est mis en avant. */
  const params = useLocalSearchParams<{ cwd?: string }>();
  const wantedCwd = typeof params.cwd === 'string' && params.cwd.length > 0 ? params.cwd : null;
  const link = useConnection((s) => s.link);
  const kova = useConnection((s) => s.kova);
  const degraded = isDegraded(link);
  const [projects, setProjects] = useState<RecentProject[] | null>(null);
  /** Sessions fermées, pour la sous-liste de chaque projet, comme Kova. */
  const [sessions, setSessions] = useState<KovaSessionEntry[]>([]);
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
    void fetchSessions().then(
      (res) => setSessions(res.sessions),
      () => setSessions([]),
    );
  }, [load]);

  const blocked = degraded || kova === 'down';

  const shown = useMemo(() => {
    if (!projects) return null;
    const list = projects.filter((p) => matchesQuery(`${p.label} ${p.path}`, query));
    // Le projet de la session à relancer passe en tête, sans rien cacher des autres.
    if (!wantedCwd) return list;
    const wanted = list.filter((p) => p.path === wantedCwd);
    return wanted.length > 0 ? [...wanted, ...list.filter((p) => p.path !== wantedCwd)] : list;
  }, [projects, query, wantedCwd]);
  const wantedMissing = wantedCwd !== null && projects !== null && !projects.some((p) => p.path === wantedCwd);

  const rows = useMemo<PaletteRow[] | null>(() => {
    if (shown === null) return null;
    const out: PaletteRow[] = [];
    for (const p of shown) {
      const busy = launching === p.index;
      out.push({
        key: String(p.index),
        tint: p.path === wantedCwd ? colors.accent.primary : null,
        title: p.label,
        subtitle: p.path,
        badge: busy ? 'création…' : p.lastOpenedMs > 0 ? shortAge(new Date(p.lastOpenedMs).toISOString()) : undefined,
        badgeColor: busy ? colors.status.working : colors.text.tertiary,
        highlighted: p.path === wantedCwd,
        disabled: blocked || (launching !== null && !busy),
      });
      // Ses sessions fermées, en retrait, comme le menu Cmd+O de Kova : un tap les reprend.
      for (const s of closedOfProject(sessions, p.path)) {
        out.push({
          key: `${CLOSED_PREFIX}${s.sessionId}`,
          tint: colors.status.closed,
          title: s.title,
          subtitle: `session fermée · il y a ${sessionAge(s)}`,
          indent: true,
          disabled: blocked || launching !== null,
        });
      }
    }
    return out;
  }, [shown, sessions, launching, wantedCwd, blocked]);

  const closedOf = useCallback(
    (row: PaletteRow): KovaSessionEntry | undefined =>
      row.key.startsWith(CLOSED_PREFIX) ? sessions.find((s) => s.sessionId === row.key.slice(CLOSED_PREFIX.length)) : undefined,
    [sessions],
  );

  const open = useCallback(
    async (row: PaletteRow) => {
      const session = closedOf(row);
      if (session) {
        askResume(session, (text) => setError(text));
        return;
      }
      const project = shown?.find((p) => String(p.index) === row.key);
      if (!project || launching !== null) return;
      setLaunching(project.index);
      setError(null);
      impact(ImpactStyle.Medium);
      try {
        const res = await postNewTab(project);
        // `replace` : le retour depuis la session ramène à la liste, pas à cette palette. Sans
        // `launched`, la commande attend dans le shell du nouveau pane : la vue Term le montre.
        router.replace(res.launched ? `/session/${res.paneId}` : `/session/${res.paneId}?view=term`);
      } catch (e) {
        setError(`Création impossible. ${e instanceof Error ? e.message : String(e)}`);
        setLaunching(null);
      }
    },
    [shown, launching, closedOf],
  );

  return (
    <Palette
      title="Projets"
      placeholder="Nom de dossier ou chemin"
      hint={
        wantedCwd && !wantedMissing
          ? 'Relancer Claude : le dossier de la session périmée est en tête.'
          : 'Un tap ouvre un onglet Kova sur le Mac, avec Claude lancé dans ce dossier.'
      }
      rows={rows}
      query={query}
      onQuery={setQuery}
      onPick={(row) => void open(row)}
      onLongPress={(row) => {
        const session = closedOf(row);
        if (session) readSession(session);
      }}
      emptyTitle={query ? 'Aucun projet ne correspond' : 'Aucun projet récent'}
      emptyBody={query ? 'Essaie un autre mot.' : 'Ouvre un projet dans Kova, il apparaîtra ici.'}
      accessibilityLabel="Rechercher un projet récent"
      banners={
        <>
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
        </>
      }
    />
  );
}
