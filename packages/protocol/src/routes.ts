import type { ActionResponse } from './errors.js';
/**
 * Table des routes HTTPS. SOURCE UNIQUE DE VERITE.
 *
 * Pourquoi ce fichier existe : l'app appelait `POST /v1/panes/:id/answer`, une route que
 * le daemon n'a jamais servie. Fastify repondait un 404 dont le corps ne porte pas de
 * champ `code`, l'app en deduisait `INTERNAL`, et l'ecran affichait « Mac injoignable ».
 * Une route absente se presentait donc comme une panne reseau.
 *
 * Regle : aucune moitie du projet n'ecrit un chemin en dur. Les deux passent par ici.
 */

export const ROUTES = {
  health: '/health',
  pairClaim: '/v1/pair/claim',
  pairDevice: (deviceId: string): string => `/v1/pair/devices/${encodeURIComponent(deviceId)}`,
  panes: '/v1/panes',
  prompt: (promptRef: string): string => `/v1/prompt/${encodeURIComponent(promptRef)}`,
  paneAnswer: (paneId: number): string => `/v1/panes/${paneId}/answer`,
  paneInterrupt: (paneId: number): string => `/v1/panes/${paneId}/interrupt`,
  paneText: (paneId: number): string => `/v1/panes/${paneId}/text`,
  /**
   * Gestion depuis l'app, les memes gestes que sur le Mac : fermer (le seul geste
   * destructeur, confirme cote app), renommer l'onglet (`set-tab-title`, titre assaini
   * cote daemon), favori (`~/.config/kova/bookmarks.json`, ecriture atomique).
   */
  paneClose: (paneId: number): string => `/v1/panes/${paneId}/close`,
  paneTitle: (paneId: number): string => `/v1/panes/${paneId}/title`,
  /**
   * Renommage au sens Claude : `/rename <name>` tape par le daemon dans le pane, via
   * KeyGate, nom assaini. Le nom survit a la fermeture et a la reprise de la session.
   */
  paneSessionName: (paneId: number): string => `/v1/panes/${paneId}/session-name`,
  kovaBookmark: '/v1/kova/bookmark',
  /**
   * Reordonner depuis l'app, comme un glisser sur le Mac. Un onglet se deplace parmi
   * les onglets de sa fenetre (`move-tab`, Kova posterieur a la 1.11.0, sinon 501
   * `KOVA_TOO_OLD`). Un pane se deplace parmi les panes de son onglet, par une chaine de
   * `swap-pane` voisins, et ne change jamais d'onglet. L'index est celui de l'ordre de
   * `list-panes` (l'ordre des feuilles de Kova), borne au dernier rang.
   */
  tabReorder: (tabId: number): string => `/v1/kova/tabs/${tabId}/reorder`,
  paneReorder: (paneId: number): string => `/v1/panes/${paneId}/reorder`,
  /**
   * Mode vocal : l'app envoie l'audio (m4a, 10 Mo max) au daemon, qui appelle Gladia
   * avec la cle lue sur le Mac. La cle ne quitte jamais le Mac, l'audio n'y reste pas.
   */
  transcribe: '/v1/transcribe',
  paneScreen: (paneId: number): string => `/v1/panes/${paneId}/screen`,
  /**
   * Les commandes `/` que Claude Code accepte dans ce pane : integrees, puis celles du
   * Mac (`~/.claude/commands`, skills, plugins) et du projet (`.claude` du `cwd`). Servent
   * l'autocompletion de la barre de message, comme le menu du terminal.
   */
  paneCommands: (paneId: number): string => `/v1/panes/${paneId}/commands`,
  /**
   * Lancer `claude` dans un pane qui n'est qu'un shell (par exemple un pane restaure par
   * Kova au redemarrage, sans Claude). Le daemon tape la commande, toujours `claude`,
   * jamais une chaine du client, puis le pane passe « en demarrage » comme apres `new-tab`.
   */
  paneStartClaude: (paneId: number): string => `/v1/panes/${paneId}/start-claude`,
  /**
   * Saisie dans le terminal depuis l'app : une ligne suivie de l'Entree, ou des touches de
   * la table fermee. Passe par `KeyGate` (garde du prompt parse), auditee sans le contenu.
   */
  paneTerminal: (paneId: number): string => `/v1/panes/${paneId}/terminal`,
  sessionTurns: (sessionId: string): string =>
    `/v1/sessions/${encodeURIComponent(sessionId)}/turns`,
  /**
   * `Lancer Kova` (PRD 5.4, CA-123) : `open -a Kova` sur le Mac. Ce n'est pas une
   * ecriture dans un pane, donc pas `KeyGate` : une route dediee, auditee.
   */
  kovaLaunch: '/v1/kova/launch',
  /**
   * Cmd+O de Kova depuis l'app (PRD A9) : la liste des projets recents de
   * `~/.config/kova/recent_projects.json`, puis `new-tab` sur l'UN d'eux, designe par
   * son index dans cette liste. Jamais un `cwd` libre, jamais une commande libre : le
   * daemon resout l'index et lance toujours `claude`.
   */
  kovaRecentProjects: '/v1/kova/recent-projects',
  kovaNewTab: '/v1/kova/new-tab',
  kovaSplit: '/v1/kova/split',
  /**
   * Sessions ouvertes ET fermees, comme les palettes de Kova (PRD 3.4, design 4.11), et
   * la reprise d'une session fermee : `new-tab` avec `claude --resume <id>`, identifiant
   * valide contre l'index, commande construite par le daemon.
   */
  kovaSessions: '/v1/kova/sessions',
  kovaResume: '/v1/kova/resume',
  ws: '/ws',

  // --- Bloc C, les fichiers ---------------------------------------------
  // Sept routes, pas une de plus. Il n'existe volontairement AUCUNE route de
  // creation de dossier, de renommage, de deplacement, de copie, de suppression
  // ni de `reveal` : le PRD les exclut et CA-110 verifie leur absence.
  fsList: '/v1/fs/list',
  fsRead: '/v1/fs/read',
  fsText: '/v1/fs/text',
  fsQuickdests: '/v1/fs/quickdests',
  fsUploadInit: '/v1/fs/upload/init',
  fsUpload: (uploadId: string): string => `/v1/fs/upload/${encodeURIComponent(uploadId)}`,
  fsUploadComplete: (uploadId: string): string =>
    `/v1/fs/upload/${encodeURIComponent(uploadId)}/complete`,
  audit: '/v1/audit',

  // --- Navigateur, le miroir de Mira -------------------------------------
  // Trois routes : la liste des onglets, une image d'un onglet, un geste sur un onglet.
  // Le daemon parle a la socket de Mira ; il n'appelle jamais `focus-app`.
  miraTabs: '/v1/mira/tabs',
  miraFrame: (tabId: string): string => `/v1/mira/tabs/${encodeURIComponent(tabId)}/frame`,
  miraAct: (tabId: string): string => `/v1/mira/tabs/${encodeURIComponent(tabId)}/act`,
} as const;

/** Gabarits Fastify correspondants. Ecrits une fois, a cote des chemins clients. */
export const ROUTE_PATTERNS = {
  health: '/health',
  pairClaim: '/v1/pair/claim',
  pairDevice: '/v1/pair/devices/:deviceId',
  panes: '/v1/panes',
  prompt: '/v1/prompt/:promptRef',
  paneAnswer: '/v1/panes/:paneId/answer',
  paneInterrupt: '/v1/panes/:paneId/interrupt',
  paneText: '/v1/panes/:paneId/text',
  paneClose: '/v1/panes/:paneId/close',
  paneTitle: '/v1/panes/:paneId/title',
  paneSessionName: '/v1/panes/:paneId/session-name',
  kovaBookmark: '/v1/kova/bookmark',
  tabReorder: '/v1/kova/tabs/:tabId/reorder',
  paneReorder: '/v1/panes/:paneId/reorder',
  /**
   * Mode vocal : l'app envoie l'audio (m4a, 10 Mo max) au daemon, qui appelle Gladia
   * avec la cle lue sur le Mac. La cle ne quitte jamais le Mac, l'audio n'y reste pas.
   */
  transcribe: '/v1/transcribe',
  paneScreen: '/v1/panes/:paneId/screen',
  paneCommands: '/v1/panes/:paneId/commands',
  paneStartClaude: '/v1/panes/:paneId/start-claude',
  paneTerminal: '/v1/panes/:paneId/terminal',
  sessionTurns: '/v1/sessions/:sessionId/turns',
  kovaLaunch: '/v1/kova/launch',
  kovaRecentProjects: '/v1/kova/recent-projects',
  kovaNewTab: '/v1/kova/new-tab',
  kovaSplit: '/v1/kova/split',
  kovaSessions: '/v1/kova/sessions',
  kovaResume: '/v1/kova/resume',
  ws: '/ws',
  fsList: '/v1/fs/list',
  fsRead: '/v1/fs/read',
  fsText: '/v1/fs/text',
  fsQuickdests: '/v1/fs/quickdests',
  fsUploadInit: '/v1/fs/upload/init',
  fsUpload: '/v1/fs/upload/:uploadId',
  fsUploadComplete: '/v1/fs/upload/:uploadId/complete',
  audit: '/v1/audit',
  miraTabs: '/v1/mira/tabs',
  miraFrame: '/v1/mira/tabs/:tabId/frame',
  miraAct: '/v1/mira/tabs/:tabId/act',
} as const;

/**
 * Verbes bannis du bloc C, listes pour etre TESTES (CA-110).
 *
 * Le test parcourt `daemon/src` et echoue si l'un de ces mots apparait dans un chemin
 * de route. Une interdiction qui n'est pas verifiee finit par revenir : `resize-pane`
 * a deja reapparu apres avoir ete retiree en passe 1.
 */
export const FS_FORBIDDEN_VERBS: readonly string[] = [
  'mkdir',
  'move',
  'copy',
  'delete',
  'rename',
  'reveal',
] as const;

/** Routes servies SANS jeton. Toute autre route exige `Authorization: Bearer`. */
export const PUBLIC_ROUTE_PATHS: readonly string[] = [ROUTES.health, ROUTES.pairClaim];

/**
 * Noms des parametres de requete de `sessionTurns`. Ils etaient construits par l'app et
 * ignores par le daemon : la pagination etait donc une illusion.
 */
export const TURNS_QUERY = {
  limit: 'limit',
  beforeSeq: 'beforeSeq',
  afterSeq: 'afterSeq',
} as const;

/** Corps de `POST /v1/pair/claim`. */
export interface PairClaimRequest {
  pairingCode: string;
  deviceName: string;
}

export interface PairClaimResponse {
  deviceId: string;
  token: string;
  tsDns: string;
  port: number;
  protocol: number;
  /** Jeton court reserve a la Notification Service Extension. Absent en lot 1. */
  nseToken?: string;
}

/** Reponse de `POST /v1/kova/launch`. `alreadyUp` : Kova tournait deja, `open` l'a mis au premier plan. */
export interface KovaLaunchResponse {
  launched: boolean;
  alreadyUp: boolean;
}

/** Un projet recent de Kova, tel que `GET /v1/kova/recent-projects` le rend. */
export interface RecentProject {
  /** Position dans la liste dedupliquee et triee du daemon : c'est elle que `new-tab` prend. */
  index: number;
  path: string;
  /** Libelle court, deja abrege (`link / docs`). */
  label: string;
  /** Millisecondes epoch de la derniere ouverture dans Kova. */
  lastOpenedMs: number;
}

export interface KovaRecentProjectsResponse {
  projects: RecentProject[];
}

/**
 * Corps de `POST /v1/kova/new-tab`. `path` est une confirmation, pas une source : le
 * daemon relit la liste, resout `recentProjectIndex`, et refuse si le chemin ne concorde
 * plus (la liste a bouge entre les deux appels).
 */
export interface KovaNewTabRequest {
  recentProjectIndex: number;
  path: string;
}

/**
 * Reponse de `POST /v1/kova/new-tab` : l'onglet et le pane crees. `launched` dit si le
 * retour chariot qui execute `claude` est parti (le champ `command` de Kova est tape,
 * pas execute) ; sinon la commande attend dans le shell du nouveau pane.
 */
export interface KovaNewTabResponse {
  tabId: number;
  paneId: number;
  cwd: string;
  launched: boolean;
}

/**
 * Corps de `POST /v1/kova/split` : un pane de plus DANS un onglet existant, avec `claude`
 * lance dedans. Le dossier est celui du projet recent designe (comme `new-tab`), sinon
 * celui du pane focalise de l'onglet : jamais une chaine libre du client. Le daemon
 * focalise un pane de l'onglet puis demande `split` a Kova, qui coupe le pane focalise.
 */
export interface KovaSplitRequest {
  tabId: number;
  recentProjectIndex?: number;
  path?: string;
}

/** Reponse de `POST /v1/kova/split` : le pane cree, meme forme que `new-tab`. */
export interface KovaSplitResponse {
  tabId: number;
  paneId: number;
  cwd: string;
  launched: boolean;
}

/** Une commande `/` de Claude Code, telle que le menu du terminal la propose. */
export interface SlashCommand {
  /** Sans le `/` initial : `compact`, `qa`, `frontend-design:frontend-design`. */
  name: string;
  description: string;
  /** Indication d'arguments de la commande, si elle en declare une. */
  argumentHint: string | null;
  source: 'builtin' | 'user' | 'project' | 'plugin';
}

/** Reponse de `GET /v1/panes/:paneId/commands`. */
export interface PaneCommandsResponse {
  commands: SlashCommand[];
}

/**
 * Reponse de `POST /v1/panes/:paneId/start-claude`. `launched` dit si l'Entree qui
 * execute `claude` est partie ; sinon la commande attend dans le shell du pane.
 */
export type PaneStartMode = 'new' | 'resume';

/**
 * Corps de `POST /v1/panes/:paneId/start-claude`. `new` (defaut) tape `claude` ; `resume`
 * demande a Kova de relancer la session du pane (`resume_command` non nul), sans que le
 * daemon ne tape de commande lui-meme.
 */
export interface PaneStartClaudeRequest {
  mode?: PaneStartMode;
}

export interface PaneStartClaudeResponse {
  launched: boolean;
  /** Quand `launched` est faux : la cause lisible (anglais), a montrer telle quelle. */
  reason?: string;
}

/** Une session Claude Code, ouverte dans un pane ou fermee (transcript sur disque). */
export interface KovaSessionEntry {
  sessionId: string;
  cwd: string;
  /** Nom du dossier. */
  projectName: string;
  /** Libelle de Kova, sinon `ai-title`, sinon le premier prompt tronque. */
  title: string;
  /** Derniere activite, ms epoch (`mtime` du transcript). */
  lastActiveMs: number;
  promptCount: number;
  state: 'open' | 'closed';
  /** Pane qui la porte quand elle est ouverte. */
  paneId: number | null;
  /** Presente dans `bookmarks.json` de Kova : etoile, en tete des palettes. */
  bookmarked: boolean;
}

export interface KovaSessionsResponse {
  sessions: KovaSessionEntry[];
}

/** Corps de `POST /v1/kova/resume` : l'identifiant seulement, valide contre l'index. */
export interface KovaResumeRequest {
  sessionId: string;
}

/**
 * Reponse de `POST /v1/kova/resume`. `alreadyOpen` : la session vivait deja dans un pane,
 * rien n'a ete lance, `paneId` est ce pane.
 */
export interface KovaResumeResponse {
  tabId: number | null;
  paneId: number;
  cwd: string;
  launched: boolean;
  alreadyOpen: boolean;
}

/** Une entree de `~/.config/kova/bookmarks.json`, format de Kova conserve tel quel. */
export interface KovaBookmark {
  agent: string;
  session_id: string;
  cwd: string;
  label: string;
}

/** Corps de `POST /v1/kova/bookmark`. L'identifiant est valide par forme et resolu par le daemon. */
export interface KovaBookmarkRequest {
  op: 'add' | 'remove';
  sessionId: string;
}

export interface KovaBookmarkResponse {
  bookmarked: boolean;
}

/** Corps de `POST /v1/panes/:paneId/title`. `null` : retour au titre automatique. */
export interface PaneTitleRequest {
  title: string | null;
}

export interface PaneTitleResponse {
  title: string | null;
}

/** Corps de `POST /v1/panes/:paneId/session-name` : le nom seulement, assaini par le daemon. */
export interface PaneSessionNameRequest {
  name: string;
}

export type PaneSessionNameResponse = ActionResponse & { name: string };

/**
 * Corps de `POST /v1/kova/tabs/:tabId/reorder` et de `POST /v1/panes/:paneId/reorder` : le
 * rang vise, entier positif ou nul, borne par le daemon au dernier rang.
 */
export interface ReorderRequest {
  index: number;
}

export interface TabReorderResponse {
  moved: boolean;
}

/**
 * `swaps` : le nombre de `swap-pane` appliques. Une chaine interrompue rend 502 avec ce
 * compte dans le message ; l'instantane suivant montre l'ordre reel.
 */
export interface PaneReorderResponse {
  moved: boolean;
  swaps: number;
}

/** Plafond d'un enregistrement vocal envoye au daemon. */
export const TRANSCRIBE_MAX_BYTES = 10 * 1024 * 1024;
/** Types MIME acceptes par `POST /v1/transcribe`. */
export const TRANSCRIBE_MIME_TYPES: readonly string[] = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/webm'];

/** Reponse de `POST /v1/transcribe` : le texte, la langue detectee, la duree entendue. */
export interface TranscribeResponse {
  text: string;
  language: string | null;
  durationMs: number | null;
}
