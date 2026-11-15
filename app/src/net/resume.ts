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

/**
 * Au delà de ce silence, une liaison affichée comme bonne ne l'est plus. Le régime lent
 * tolère 36 s (20 s de ping, deux pongs de 8 s) : 45 s sans rien recevoir du Mac, pas même
 * un pong, veut dire que la surveillance elle même s'est arrêtée.
 */
export const STALL_AFTER_MS = 45_000;

/**
 * Dernier filet contre un gel silencieux : l'app est à l'écran, la pastille dit que la
 * liaison est bonne, et le Mac n'a rien envoyé depuis `STALL_AFTER_MS`. Fonction pure.
 */
export function isStalled(
  state: { appActive: boolean; linkUp: boolean; lastHeardAt: number | null },
  now: number,
  after = STALL_AFTER_MS,
): boolean {
  if (!state.appActive || !state.linkUp || state.lastHeardAt === null) return false;
  return now - state.lastHeardAt > after;
}
