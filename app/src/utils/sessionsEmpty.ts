/**
 * Ce que l'écran des sessions montre quand il n'a aucun pane à lister.
 *
 * 13/11/2026 : le Mac n'était plus joignable (Tailscale arrêté dessus depuis son
 * redémarrage) et l'écran disait « No sessions. Open a pane in Kova and it will show up
 * here », comme si Kova n'avait aucun pane. Une liste vide ne se dit « sans session »
 * que lorsque le Mac vient de répondre qu'il n'y en a pas.
 */
export type SessionsEmpty = 'kovaDown' | 'loading' | 'unreachable' | 'none' | null;

export interface SessionsEmptyInput {
  kovaDown: boolean;
  loading: boolean;
  /** `LinkState` du store de connexion. */
  link: 'connecting' | 'direct' | 'relayed' | 'macUnreachable' | 'offline' | string;
  paneCount: number;
}

export function sessionsEmpty({ kovaDown, loading, link, paneCount }: SessionsEmptyInput): SessionsEmpty {
  if (kovaDown) return 'kovaDown';
  if (paneCount > 0) return null;
  // Injoignable passe avant tout : ni squelette qui tourne sans fin, ni « No sessions ».
  if (link === 'macUnreachable' || link === 'offline') return 'unreachable';
  // Pas encore de réponse du Mac : on ne sait pas s'il a des sessions.
  if (loading || link === 'connecting') return 'loading';
  return 'none';
}
