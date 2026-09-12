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
  paneScreen: (paneId: number): string => `/v1/panes/${paneId}/screen`,
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
  paneScreen: '/v1/panes/:paneId/screen',
  sessionTurns: '/v1/sessions/:sessionId/turns',
  kovaLaunch: '/v1/kova/launch',
  kovaRecentProjects: '/v1/kova/recent-projects',
  kovaNewTab: '/v1/kova/new-tab',
  ws: '/ws',
  fsList: '/v1/fs/list',
  fsRead: '/v1/fs/read',
  fsText: '/v1/fs/text',
  fsQuickdests: '/v1/fs/quickdests',
  fsUploadInit: '/v1/fs/upload/init',
  fsUpload: '/v1/fs/upload/:uploadId',
  fsUploadComplete: '/v1/fs/upload/:uploadId/complete',
  audit: '/v1/audit',
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

/** Reponse de `POST /v1/kova/new-tab` : l'onglet et le pane crees, `claude` lance dedans. */
export interface KovaNewTabResponse {
  tabId: number;
  paneId: number;
  cwd: string;
}
