/**
 * Etat de la liaison Tailscale entre le Mac et l'iPhone (A11).
 *
 * Il n'existe qu'un seul chemin reseau, Tailscale, mais il a deux regimes : pair a pair
 * direct, ou relaye par un serveur DERP. La difference se voit a l'usage (mesure sur la
 * liaison de Robin : 139 a 772 ms via le relais de Londres). L'app affiche l'un ou
 * l'autre pour que Robin comprenne sa latence sans avoir a deviner.
 */
export interface LinkInfo {
  /** `null` = pair a pair direct. Sinon, le code du relais DERP, par exemple `lhr`. */
  relay: string | null;
}
