/**
 * Codes de fermeture WebSocket. SOURCE UNIQUE DE VERITE.
 *
 * Le daemon n'emet que les codes declares ici, et l'app ne reconnait que ceux la.
 * Avant ce fichier, le daemon emettait `4401`, l'app interpretait en plus `1008` et
 * `4426` que personne n'envoyait : une branche fantome de chaque cote de la frontiere.
 *
 * Plage 4000 a 4999 : reservee aux applications par la RFC 6455. Les numeros reprennent
 * les codes HTTP correspondants pour rester lisibles dans un journal.
 */
export const WS_CLOSE_CODE = {
  /** Jeton absent, invalide, expire ou revoque. Le client ne doit PAS reessayer. */
  UNAUTHORIZED: 4401,
  /**
   * Client declare mort : deux pings serveur consecutifs sans pong (voir
   * `WS_PING_INTERVAL_MS` et `WS_DEAD_AFTER_MISSED_PONGS`). Emis par le daemon quand il
   * ferme lui meme un socket silencieux. Le client, s'il vit encore, reconnecte
   * normalement.
   */
  DEAD_CLIENT: 4408,
  /** `hello.protocol` inconnu du daemon. Le client doit se mettre a jour, pas reessayer. */
  PROTOCOL_VERSION: 4426,
} as const;

/** Contrat public : l'union des codes ci dessus, pour qui en typerait un a l'exterieur. */
export type WsCloseCode = (typeof WS_CLOSE_CODE)[keyof typeof WS_CLOSE_CODE];

/** Ce que le client doit faire d'une fermeture. `network` est le seul cas ou il reessaie. */
export type WsCloseReason = 'auth' | 'protocol' | 'network';

/**
 * Traduction unique d'un code de fermeture en conduite a tenir. L'app appelle cette
 * fonction, elle ne compare jamais un nombre elle meme.
 *
 * Tout code hors de la table (1000, 1006, 1011, un code d'un proxy...) vaut `network` :
 * le client reconnecte avec son backoff. `DEAD_CLIENT` aussi : le daemon a juge le
 * client silencieux, mais s'il recoit ce code, c'est qu'il est bien vivant.
 */
export function wsCloseReason(code: number | undefined): WsCloseReason {
  switch (code) {
    case WS_CLOSE_CODE.UNAUTHORIZED:
      return 'auth';
    case WS_CLOSE_CODE.PROTOCOL_VERSION:
      return 'protocol';
    default:
      return 'network';
  }
}
