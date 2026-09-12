// Sessions fermées dans les palettes : filtrage et regroupement par projet. Pur, testé.
import type { KovaSessionEntry } from '@/protocol';
import { matchesQuery } from '@/utils/search';

/** Les sessions fermées qui répondent à la requête (libellé, projet, dossier). */
export function closedMatching(sessions: readonly KovaSessionEntry[], query: string): KovaSessionEntry[] {
  return sessions.filter((s) => s.state === 'closed' && matchesQuery(`${s.title} ${s.projectName} ${s.cwd}`, query));
}

/** Les `max` sessions fermées les plus récentes d'un dossier, pour la sous-liste d'un projet (Cmd+O). */
export function closedOfProject(sessions: readonly KovaSessionEntry[], cwd: string, max = 3): KovaSessionEntry[] {
  return sessions
    .filter((s) => s.state === 'closed' && s.cwd === cwd)
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs)
    .slice(0, max);
}
