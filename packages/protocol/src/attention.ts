/**
 * La file d'attention de Robin (`attn`), telle que le telephone la voit.
 *
 * Une seule file pour tout ce qui attend Robin : chaque session, routine ou chief y ajoute
 * une entree, a un de trois niveaux. `now` (a toi maintenant) compte dans `waitsOnYou`
 * comme une question ; `point` (au prochain point groupe) et `memo` (pour memoire)
 * attendent un coup d'oeil plus tard. Seul le CLI `attn` la connait : le daemon le lance
 * avec un argv fixe (`attn list --open --json`, `attn act`, `attn close`), jamais une
 * ligne de shell, et ne lit pas son journal lui-meme.
 *
 * SOURCE UNIQUE DE VERITE de la forme cote frontiere : le daemon traduit la sortie de
 * `attn` une seule fois (`daemon/src/attention.ts`) et ne garde que les champs ci-dessous.
 */

/** Les trois niveaux, dans l'ordre ou l'ecran des questions les pose. */
export const ATTENTION_LEVELS = ['now', 'point', 'memo'] as const;
export type AttentionLevel = (typeof ATTENTION_LEVELS)[number];

/**
 * Les genres que `attn` connait. `kind` reste une chaine dans `AttentionEntry` : un genre
 * ajoute plus tard cote `attn` doit s'afficher, sans bouton propre, plutot que disparaitre.
 */
export const ATTENTION_KINDS = [
  'decision',
  'review',
  'test',
  'blocked',
  'done',
  'ask',
  'auto',
  'would',
  'info',
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** Une entree ouverte de la file. Les champs optionnels sont absents quand `attn` ne les a pas. */
export interface AttentionEntry {
  /** `a-` suivi de six chiffres hexadecimaux, tel que `attn add` l'a fabrique. */
  id: string;
  /** Date ISO avec decalage, celle de l'ajout. */
  ts: string;
  /** Qui l'a ajoutee : une session, une routine, un chief. */
  from: string;
  level: AttentionLevel;
  kind: string;
  title: string;
  /** Ce qu'il faut de Robin, en une phrase. */
  needs?: string;
  /**
   * Ce que `Ouvrir` ouvre : une URL http(s), un chemin de fichier du Mac (avec un
   * `#ancre` eventuel, des espaces possibles), ou un texte libre qui ne s'ouvre pas.
   */
  action?: string;
  /** Les fils d'ou elle vient (`pr:13752`, `linear:CLA-10113`...). */
  src?: string[];
  /** Le sujet qui regroupe les entrees au prochain point. */
  topic?: string;
  body?: string;
}

/** Reponse de `GET /v1/attention`. */
export interface AttentionResponse {
  entries: AttentionEntry[];
}

/** Le format d'un identifiant d'entree. Tout autre est refuse avant de lancer `attn`. */
export const ATTENTION_ID_RE = /^a-[0-9a-f]{6}$/;

/**
 * Les boutons d'une ligne, au mot pres : ce sont ceux de Kova. `Envoyer` transmet le clic
 * au chief (`attn act`), `Fait` et `Ignorer` ferment l'entree (`attn close`), `Ouvrir`
 * reste sur le telephone (le daemon le refuse, il n'a rien a noter).
 */
export const ATTENTION_BUTTONS = ['Envoyer', 'Ignorer', 'Fait', 'Ouvrir'] as const;
export type AttentionButton = (typeof ATTENTION_BUTTONS)[number];

export function isAttentionButton(v: unknown): v is AttentionButton {
  return typeof v === 'string' && (ATTENTION_BUTTONS as readonly string[]).includes(v);
}

/** Plafond du texte joint a `Envoyer`, en octets UTF-8. */
export const ATTENTION_TEXT_MAX = 2 * 1024;

/** Corps de `POST /v1/attention/:id/act`. */
export interface AttentionActRequest {
  button: AttentionButton;
  /** Seulement avec `Envoyer` : passe a `attn act --text`. */
  text?: string;
  nonce?: string;
}

/** Reponse de `POST /v1/attention/:id/act`. Un refus est une erreur HTTP, pas `applied:false`. */
export interface AttentionActResponse {
  applied: true;
  /** `act` : clic transmis au chief, l'entree reste ouverte ; `close` : entree fermee. */
  op: 'act' | 'close';
}

/**
 * L'etat qu'une session de l'equipe declare (`attn status`), lu dans `team list --json`.
 * La liste est fermee : un autre mot est ignore par le daemon.
 */
export const TEAM_STATUSES = [
  'awaiting-you',
  'awaiting-review',
  'blocked',
  'queued',
  'waiting-event',
  'working',
  'done',
] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

export function isTeamStatus(v: unknown): v is TeamStatus {
  return typeof v === 'string' && (TEAM_STATUSES as readonly string[]).includes(v);
}

/**
 * Les boutons d'une passation (`kind: handoff` de `kova ask --open` ou `--run`), au mot
 * pres : Kova les impose. Le pas (`Ouvrir` ou `Lancer`) est fait par Kova sur le Mac et
 * laisse la question ouverte ; `Fait` y repond.
 */
export const HANDOFF_KIND = 'handoff';
export const HANDOFF_OPEN = 'Ouvrir';
export const HANDOFF_RUN = 'Lancer';
export const HANDOFF_DONE = 'Fait';
