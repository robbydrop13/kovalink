/**
 * Cadence de relecture de la mise en page de Kova (`list-tabs` + `list-panes`).
 *
 * Deux requetes sur une socket Unix locale, quelques centaines d'octets : le cout est
 * negligeable. 5 s suffit pour qu'un onglet renomme ou deplace sur le Mac apparaisse
 * sur l'iPhone sans que l'on ait a attendre un changement de focus.
 */
export const LAYOUT_POLL_MS = 5_000;
