// Ce que l'app redemande en revenant au premier plan. Fonction PURE, pour qu'elle soit
// testable sans React Native : `connection.ts` ne fait qu'exécuter la liste.
//
// Avant, un retour au premier plan après une absence courte se contentait d'un ping :
// aucune réattache de session, aucun `peek`, aucun réabonnement. Combiné au tail que
// personne ne rouvrait côté daemon après un réveil, dix secondes passées dans une autre
// app pouvaient laisser le chat gelé pour toujours derrière une pastille verte.

/**
 * Au delà de cette absence, le daemon a certainement fermé le socket (deux pings serveur
 * sans pong, 40 s) : on rouvre sans attendre de constater sa mort.
 */
export const BACKGROUND_RECONNECT_AFTER_MS = 30_000;

export type ResumeAction = 'reconnect' | 'ping' | 'panes.subscribe' | 'pane.peek' | 'session.attach';

export interface ResumeState {
  /** Socket encore ouvert au moment du retour. */
  open: boolean;
  /** Temps passé en arrière plan. */
  awayMs: number;
  visiblePaneId: number | null;
  visibleSessionId: string | null;
}

/**
 * `reconnect` est seul : le `hello.ok` de la connexion neuve rejoue lui même l'abonnement,
 * le `peek` et l'attache de session. Sinon, on redemande TOUT ce qui est visible, quelle
 * que soit la durée de l'absence : l'étag rend l'abonnement presque gratuit, et c'est le
 * seul moyen de rattraper un message perdu pendant que l'app n'écoutait pas.
 */
export function resumeActions(state: ResumeState, threshold = BACKGROUND_RECONNECT_AFTER_MS): ResumeAction[] {
  if (!state.open || state.awayMs > threshold) return ['reconnect'];
  const actions: ResumeAction[] = ['ping', 'panes.subscribe'];
  if (state.visiblePaneId !== null) actions.push('pane.peek');
  if (state.visibleSessionId !== null) actions.push('session.attach');
  return actions;
}
