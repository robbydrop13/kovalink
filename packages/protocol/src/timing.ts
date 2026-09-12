/**
 * Durees qui traversent la frontiere. SOURCE UNIQUE DE VERITE.
 *
 * Toutes en MILLISECONDES, sans exception, et le nom le dit. La seule valeur du projet
 * exprimee en secondes est l'`exp` du jeton porteur, parce qu'elle voyage dans le jeton
 * lui meme : elle est convertie a la lecture (`exp * 1000`), jamais comparee telle quelle
 * a un `Date.now()`.
 *
 * Ces nombres vivaient en double, inventes de chaque cote. Quand deux copies divergent,
 * le symptome n'est pas une erreur, c'est un comportement faux : une reponse rejouee, un
 * compteur qui ne s'allume jamais.
 */

/** R3 : la reference de prompt vaut jusqu'a resolution OU 10 minutes, jamais un seul usage. */
export const PROMPT_REF_TTL_MS = 10 * 60_000;

/** Au dela, la carte EN ATTENTE passe en rouge dans l'app. */
export const PROMPT_AGING_MS = 10 * 60_000;

// --- File d'envoi differe -----------------------------------------------------
// Le daemon deduplique sur `NONCE_TTL_MS`. INVARIANT : ce TTL doit couvrir le plus long
// TTL de la file, sans quoi un envoi rejoue APRES l'oubli du nonce serait applique une
// seconde fois. C'etait le cas : texte 15 min contre nonces 10 min.

/** Une approbation de plus de 60 s ne part JAMAIS (architecture 3.4). */
export const OUTBOX_ANSWER_TTL_MS = 60_000;
/**
 * PRD 5.3 et CA-72 : une interruption tapee hors ligne est envoyee si le reseau revient
 * dans les 5 minutes. Elle valait 60 s, ce qui faisait echouer le critere a 90 s.
 */
export const OUTBOX_INTERRUPT_TTL_MS = 5 * 60_000;
export const OUTBOX_TEXT_TTL_MS = 15 * 60_000;

/** Plafond de la file de messages libres. */
export const OUTBOX_TEXT_MAX = 5;

/** Fenetre d'idempotence du daemon. Voir l'invariant ci dessus. */
export const NONCE_TTL_MS = Math.max(
  OUTBOX_ANSWER_TTL_MS,
  OUTBOX_INTERRUPT_TTL_MS,
  OUTBOX_TEXT_TTL_MS,
);

// --- Vie du WebSocket -----------------------------------------------------------
// Les deux sens pingent. Le client envoie `ping` (message JSON) toutes les
// `WS_PING_INTERVAL_MS` ; le daemon envoie un ping DE TRAME (RFC 6455) au meme rythme et
// declare le client mort apres `WS_DEAD_AFTER_MISSED_PONGS` pings sans pong, puis ferme
// avec `WS_CLOSE_CODE.DEAD_CLIENT`. Sans ce ping serveur, un iPhone verrouille restait
// « au premier plan » pour toujours et ses notifications de fin de tour etaient jetees.

export const WS_PING_INTERVAL_MS = 20_000;
export const WS_DEAD_AFTER_MISSED_PONGS = 2;

/**
 * Fraicheur du signal de premier plan (`ping.foregroundPaneId`). Un client n'est tenu
 * pour « en train de regarder ce pane » que si son dernier signal a moins de cette
 * duree. Trois pings de marge : un seul ping perdu ne coupe pas la suppression.
 *
 * C'est la moitie de la regle A1 / CA-31 : une notification n'est supprimee que si un
 * client VIVANT est AU PREMIER PLAN sur ce pane depuis moins de 60 s.
 */
export const FOREGROUND_TTL_MS = 60_000;

/**
 * PRD 4.4 et CA-31 : Robin devant son Mac, sur le pane concerne, la notification est
 * SUSPENDUE 60 s, puis part quand meme si l'etat n'a pas change. Jamais supprimee.
 */
export const MAC_FOCUSED_DEFER_MS = 60_000;

/**
 * CA-123 : sans socket Kova redecouvert dans ce delai, le daemon passe `kova` a `down`,
 * vide la liste des panes et l'annonce. Avant ce delai l'etat est `reconnecting`, un
 * simple redemarrage de Kova ne doit pas faire clignoter l'ecran « Kova n'est pas lance ».
 */
export const KOVA_DOWN_AFTER_MS = 10_000;
