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
  // Les champs du Cockpit, lus comme Kova les lit (`kova/src/attention.rs`, `parse`). Tous
  // optionnels : une file plus ancienne ne les donne pas, une app plus ancienne les ignore.
  // Un champ illisible est omis, l'entree reste.
  /** Les gestes que la file offre sur la carte : mots connus, sans doublon, dans son ordre. Absent : les anciens boutons. */
  gestures?: AttentionGesture[];
  /** Le mot du bouton `go` (`Go`, `Go, envoyer`), 40 caracteres au plus. */
  goLabel?: string;
  /** Qui la carte attend : Robin, ou l'agent a qui il a pose une question. */
  waiting?: AttentionWaiting;
  /** La question que Robin a posee sur la carte, seulement quand `waiting` vaut `agent`. */
  ask?: AttentionAsk;
  /** L'empreinte de la carte telle que listee (`card_seen`), a renvoyer avec un geste. */
  cardSeen?: string;
  /** 1 urgent, 2 aujourd'hui, 3 cette semaine. */
  prio?: AttentionPrio;
  /** Son label du registre d'`attn`, avec sa couleur `#RRGGBB` (gris sans couleur lisible). */
  label?: AttentionLabel;
  /** La file pro ou perso (`--scope all` lit les deux). Absent : pro. */
  scope?: AttentionScope;
  /** Le brouillon a valider ou corriger, quand l'agent en a ecrit un. */
  draft?: AttentionDraft;
  /** Ce qu'`attn explain` a ecrit pour une carte qui ne disait rien d'autre. */
  detail?: string;
  /** Captures avant et apres un changement : chemins absolus du Mac. */
  before?: string;
  after?: string;
  /** La carte est revenue apres l'echec de son action : pourquoi. */
  failed?: string;
  /** La carte est revenue et personne ne sait si son message est parti : pourquoi. */
  uncertain?: string;
  /** La preuve que son action a eu lieu (id de message, lien, commit). */
  proof?: string;
  /** Date ISO jusqu'a laquelle la carte a ete reportee (`snoozed_until`). */
  snoozedUntil?: string;
}

/**
 * Les sept gestes d'une carte, au mot pres : ceux du contrat de la file
 * (`claude-config/tests/fixtures/gestures-contract.json`) et de Kova. La file liste ceux
 * qu'une carte offre (`gestures`) ; l'app montre ceux-la et n'en deduit aucun.
 */
export const ATTENTION_GESTURES = ['go', 'nogo', 'ask', 'seen', 'cancel', 'done', 'dismiss'] as const;
export type AttentionGesture = (typeof ATTENTION_GESTURES)[number];

export function isAttentionGesture(v: unknown): v is AttentionGesture {
  return typeof v === 'string' && (ATTENTION_GESTURES as readonly string[]).includes(v);
}

/** Les gestes qui portent le texte tape dans la carte : tous sauf `cancel` (`takes_text` de Kova). */
export function gestureTakesText(g: AttentionGesture): boolean {
  return g !== 'cancel';
}

/** Les gestes qui classent la carte : elle quitte la liste aussitot (`files` de Kova). */
export function gestureFilesCard(g: AttentionGesture): boolean {
  return g !== 'ask' && g !== 'cancel';
}

/**
 * Les deux mots d'une carte dont l'envoi est incertain (`uncertain`) : la file n'y liste
 * aucun geste, et Kova garde `C'est parti` (`parti` : Robin a vu le message partir) et
 * `Renvoyer` (rien n'est parti, une nouvelle validation). Acceptes seulement sur une carte
 * qui a `uncertain`.
 */
export const ATTENTION_UNCERTAIN_WORDS = ['parti', 'Renvoyer'] as const;
export type AttentionUncertainWord = (typeof ATTENTION_UNCERTAIN_WORDS)[number];

export function isAttentionUncertainWord(v: unknown): v is AttentionUncertainWord {
  return typeof v === 'string' && (ATTENTION_UNCERTAIN_WORDS as readonly string[]).includes(v);
}

export type AttentionWaiting = 'robin' | 'agent';
export type AttentionScope = 'pro' | 'perso';
export type AttentionPrio = 1 | 2 | 3;

export interface AttentionAsk {
  text: string;
  /** Date ISO de la question. */
  ts?: string;
  /** La session a qui elle est partie. */
  to?: string;
  /** Ou en est sa remise, dans les mots de la file (`non remis`...), 80 caracteres au plus. */
  label?: string;
}

export interface AttentionLabel {
  name: string;
  /** `#RRGGBB`. */
  color: string;
}

/** Le brouillon d'une carte, avec les champs du `Draft` de Kova. */
export interface AttentionDraft {
  text: string;
  /** Le nom qu'une personne lit. */
  to?: string;
  channel?: string;
  subject?: string;
  /** La ou le message part vraiment (`U...`, `#canal`, `/<ts>`). */
  target?: string;
  /** `target` en mots (`DM Sacha`). */
  targetLabel?: string;
  /** `dm`, `group`, `private`, `public` ou `external`. */
  targetKind?: string;
  /** L'empreinte de cette version du brouillon, a renvoyer avec `go` (`seen`). */
  seen?: string;
}

/** Une empreinte de la file (`draft.seen`, `card_seen`) : 8 a 64 chiffres hexadecimaux (`valid_seen` de Kova). */
export const ATTENTION_SEEN_RE = /^[0-9a-fA-F]{8,64}$/;

/**
 * L'identifiant d'un clic (`--client-id`) : lettres, chiffres, `-` et `_`, 64 au plus, pas
 * de tiret en tete (`valid_id` de Kova). L'app le garde pour reessayer le meme clic : la
 * file ne note qu'une fois un clic par identifiant.
 */
export const ATTENTION_CLIENT_ID_RE = /^(?!-)[A-Za-z0-9_-]{1,64}$/;

/** Plafond du brouillon reecrit joint a `go` (`--draft`), en octets UTF-8. */
export const ATTENTION_DRAFT_MAX = 16 * 1024;

/** Un report va au plus loin a 60 jours. */
export const ATTENTION_SNOOZE_MAX_DAYS = 60;

/** Corps de `POST /v1/attention/:id/gesture`. */
export interface AttentionGestureRequest {
  /**
   * Un des sept gestes, ou un mot d'une carte incertaine (`parti`, `Renvoyer`) : ceux-la ne
   * prennent ni texte ni brouillon, et partent sous la forme de Kova, sans `--client-id`
   * ni `--card-seen` (un `cardSeen` envoye est ignore) ; `seen` les accompagne.
   */
  gesture: AttentionGesture | AttentionUncertainWord;
  /** Le texte tape dans la carte : requis pour `ask`, refuse pour `cancel`. */
  text?: string;
  /** `go`, `parti` et `Renvoyer` seulement : l'empreinte du brouillon affiche (`draft.seen`). */
  seen?: string;
  /** `go` seulement : le brouillon tel que Robin l'a reecrit, son texte exact. */
  draft?: string;
  /** L'empreinte de la carte affichee (`cardSeen`) : la file refuse si elle a change. */
  cardSeen?: string;
  /**
   * L'identifiant du clic, que l'app garde pour le reessayer. Absent : le daemon en tire
   * un et le reprend pour le meme geste, texte et brouillon sur la meme carte.
   */
  clientId?: string;
  nonce?: string;
}

/**
 * Reponse de `POST /v1/attention/:id/gesture` quand la file a pris le clic. `delivered` :
 * remis a l'agent ; `noted` : note, remise a venir ; `said` : la file le dit elle-meme
 * (`line`, a montrer telle quelle), un envoi par le code ou un clic deja pris. Un refus
 * (`ATTENTION_REFUSED`, la ligne d'`attn` dans `message`) ou une carte changee
 * (`ATTENTION_CARD_CHANGED`) est une erreur HTTP.
 */
export interface AttentionGestureResponse {
  outcome: 'delivered' | 'noted' | 'said';
  line?: string;
}

/** Corps de `POST /v1/attention/:id/snooze`. */
export interface AttentionSnoozeRequest {
  /** ISO 8601 avec decalage, dans le futur, a 60 jours au plus. */
  until: string;
  /** L'empreinte de la carte affichee : la file refuse le report si elle a change. */
  cardSeen?: string;
  /** Le meme pour un report reessaye. Absent : le daemon en tire un, repris pour la meme date. */
  clientId?: string;
  nonce?: string;
}

/**
 * Reponse de `POST /v1/attention/:id/snooze`. Un refus (`ATTENTION_REFUSED`, la ligne
 * d'`attn` dans `message`) ou une carte changee (`ATTENTION_CARD_CHANGED`) est une erreur HTTP.
 */
export interface AttentionSnoozeResponse {
  applied: true;
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
export const ATTENTION_SEND = 'Envoyer';
export const ATTENTION_IGNORE = 'Ignorer';
export const ATTENTION_DONE = 'Fait';
export const ATTENTION_OPEN = 'Ouvrir';
export const ATTENTION_BUTTONS = [ATTENTION_SEND, ATTENTION_IGNORE, ATTENTION_DONE, ATTENTION_OPEN] as const;
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
