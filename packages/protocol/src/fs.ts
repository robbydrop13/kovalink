/**
 * Bloc C, les fichiers. Contrat partage, SOURCE UNIQUE DE VERITE.
 *
 * Pourquoi tout est ici et nulle part ailleurs : un format invente separement de chaque
 * cote a deja coute une journee sur l'appairage. Les noms de champs, les bornes de
 * pagination, la taille des morceaux d'upload et les libelles de tri traversent la
 * frontiere : ils se declarent une fois.
 *
 * Ce que ce fichier ne declare PAS, volontairement : aucune forme de `mkdir`, `move`,
 * `copy`, `delete`, `rename` ou `reveal`. Le PRD les exclut (section 6) et le critere
 * CA-110 verifie leur absence du code source du daemon. Une route absente du protocole
 * ne peut pas etre servie par distraction.
 */

// --- Navigation ---------------------------------------------------------------

/** Nature d'une entree. `symlink` est rendu tel quel : on ne suit jamais en silence. */
export type FsEntryKind = 'dir' | 'file' | 'symlink' | 'other';

export interface FsEntry {
  name: string;
  /** Chemin absolu, `~` jamais abrege cote daemon : l'abreviation est un rendu. */
  path: string;
  kind: FsEntryKind;
  /** Octets. `null` pour un dossier : on ne calcule pas la taille recursive. */
  size: number | null;
  /** ISO 8601. `null` quand `lstat` a echoue sur l'entree. */
  mtime: string | null;
  hidden: boolean;
  /** Extension en minuscules, point compris (`.png`). Vide si absente. */
  ext: string;
  /** Type MIME devine par extension. Sert a choisir l'apercu, jamais a autoriser. */
  mime: string | null;
  /**
   * Cible d'un lien symbolique, telle qu'ecrite sur le disque. `null` sinon.
   * Elle est AFFICHEE, jamais suivie pour decider d'un droit.
   */
  linkTarget: string | null;
  /** Faux quand `lstat` a echoue : la ligne s'affiche grisee, elle ne disparait pas. */
  readable: boolean;
}

export const FS_SORT_KEYS = ['name', 'size', 'mtime'] as const;
export type FsSortKey = (typeof FS_SORT_KEYS)[number];
export type FsSortDir = 'asc' | 'desc';

/** Pagination par 500 (PRD C1). Une seule valeur, des deux cotes. */
export const FS_PAGE_SIZE = 500;

export interface FsListResponse {
  /** Chemin absolu reellement lu, apres resolution des `..` et des liens. */
  path: string;
  /** Parent, ou `null` a la racine `/`. */
  parent: string | null;
  entries: FsEntry[];
  /** Nombre total d'entrees du dossier APRES filtrage des caches, avant pagination. */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  sort: FsSortKey;
  dir: FsSortDir;
  showHidden: boolean;
}

/** Parametres de requete de `fsList`. Construits ici, lus ici. */
export const FS_LIST_QUERY = {
  path: 'path',
  offset: 'offset',
  limit: 'limit',
  sort: 'sort',
  dir: 'dir',
  showHidden: 'showHidden',
} as const;

// --- Raccourcis de destination -------------------------------------------------

/**
 * Origine d'un raccourci. L'ordre d'affichage impose par le design 4.8 est :
 * `recent-dest`, puis `pane`, puis `project`, puis `system`.
 */
export type QuickDestKind = 'pane' | 'project' | 'system';

export interface QuickDest {
  path: string;
  /** Libelle court, deja abrege pour l'affichage (`link / docs`). */
  label: string;
  kind: QuickDestKind;
  /** `recent`, `systeme`, ou le nom du projet. Affiche en pastille a droite. */
  badge: string;
  /** Faux quand la liste noire d'ecriture couvre ce chemin : la ligne est grisee. */
  writable: boolean;
  /** Millisecondes epoch du dernier acces, pour le tri. `null` pour les dossiers systeme. */
  lastOpenedMs: number | null;
}

export interface FsQuickDestsResponse {
  dests: QuickDest[];
  /** `cwd` du pane focalise, deja present dans `dests`. C'est le « bon dossier ». */
  focusedCwd: string | null;
  home: string;
}

// --- Lecture de fichier --------------------------------------------------------

/**
 * Parametres de `fsRead`. `download` force un `Content-Disposition: attachment`.
 * `digest=true` demande l'empreinte SHA-256 du fichier ENTIER dans l'en-tete
 * `FS_READ_DIGEST_HEADER` (CA-101, sens Mac vers iPhone). Le daemon la calcule en flux
 * avant d'envoyer le corps, jamais le fichier en memoire : c'est une seconde lecture du
 * disque, donc a demander seulement quand on va verifier. Ignore avec un en-tete `Range`.
 */
export const FS_READ_QUERY = {
  path: 'path',
  download: 'download',
  digest: 'digest',
} as const;

/** En-tete de reponse portant l'empreinte SHA-256 hexadecimale, sur `digest=true` sans `Range`. */
export const FS_READ_DIGEST_HEADER = 'x-kovalink-sha256';

/**
 * Apercu texte : integral jusqu'a 10 Mo, puis les 200 premiers Ko avec mention
 * de troncature (PRD 5.2, CA-99).
 */
export const TEXT_PREVIEW_FULL_MAX = 10 * 1024 * 1024;
export const TEXT_PREVIEW_TRUNCATED = 200 * 1024;

/** Parametres de `fsText`. */
export const FS_TEXT_QUERY = { path: 'path' } as const;

export interface FsTextResponse {
  path: string;
  /** Contenu UTF-8. Tronque a `TEXT_PREVIEW_TRUNCATED` au dela du seuil. */
  text: string;
  size: number;
  truncated: boolean;
  /** Octets reellement renvoyes. Egal a `size` quand `truncated` est faux. */
  bytes: number;
  mime: string | null;
}

// --- Upload --------------------------------------------------------------------

/**
 * Morceaux de 4 Mo (PRD 5.2). L'architecture annoncait 8 Mo : R1 tranche, le PRD fait
 * foi, et la valeur ne vit plus qu'ici.
 */
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

/** Avertissement cellulaire au dela de 100 Mo (A4). AUCUN plafond de taille n'existe. */
export const CELLULAR_WARN_BYTES = 100 * 1024 * 1024;

/** Marge de disque exigee a l'`init` : `size + 1 Go` (architecture 2.10). */
export const UPLOAD_FREE_SPACE_MARGIN = 1024 * 1024 * 1024;

/** Selection multiple, les deux sens (PRD C3, C4). */
export const TRANSFER_SELECTION_MAX = 20;

/** Reprise : 3 tentatives, temporisation 2 s, 8 s, 30 s, puis abandon (PRD 5.3). */
export const UPLOAD_RETRY_BACKOFF_MS = [2_000, 8_000, 30_000] as const;

export interface UploadInitRequest {
  destDir: string;
  filename: string;
  size: number;
  /** SHA-256 hexadecimal du fichier complet. Verifie a `complete`, jamais avant. */
  sha256?: string;
}

export interface UploadInitResponse {
  uploadId: string;
  /** Octets deja recus. Non nul quand l'`init` a retrouve un transfert interrompu. */
  receivedBytes: number;
  chunkBytes: number;
  /**
   * Nom final PRESSENTI, collision comprise (`capture-2.png`). Il est recalcule au
   * `complete` : un autre programme a pu creer le fichier entre temps.
   */
  plannedName: string;
}

export interface UploadStatusResponse {
  uploadId: string;
  receivedBytes: number;
  size: number;
  destDir: string;
  filename: string;
  chunkBytes: number;
}

export interface UploadCompleteResponse {
  path: string;
  /** Nom REELLEMENT ecrit. Different de `filename` en cas de collision. */
  name: string;
  size: number;
  sha256: string;
  /** Vrai quand le nom a ete suffixe : l'app affiche « renomme en … » 3 s. */
  renamed: boolean;
}

/** Parametres de `fsUploadChunk`. L'offset est obligatoire : il n'a pas de defaut. */
export const UPLOAD_QUERY = { offset: 'offset' } as const;

/**
 * Reponse d'un `PUT` dont l'offset ne correspond pas. Le client se RECALE sur
 * `receivedBytes`, il ne recommence pas le fichier.
 */
export interface UploadOffsetMismatch {
  code: 'OFFSET_MISMATCH';
  receivedBytes: number;
}

// --- Pieces jointes du chat (docs/15) ------------------------------------------

/**
 * Racine des pieces jointes envoyees depuis le composer. Le message envoye a Claude
 * porte le chemin absolu de chaque piece, exactement comme le collage d'image de Kova.
 *
 * Hors de `$HOME`, donc hors de la regle structurelle des fichiers caches, et purge au
 * redemarrage du Mac : c'est le comportement voulu pour une piece de conversation. Le
 * daemon cree le dossier de session en 0700 a l'`init` du premier transfert ; c'est le
 * SEUL dossier qu'il cree jamais, et seulement sous cette racine (PRD section 6).
 *
 * `/tmp` est un lien vers `/private/tmp` sur macOS : le daemon repond avec le chemin
 * reel, l'app compose le message avec cette racine telle quelle. Les deux designent le
 * meme fichier, et Claude Code lit l'un comme l'autre.
 */
export const ATTACHMENTS_ROOT = '/tmp/kovalink/attachments';

/** Segment de session accepte sous la racine : court, sans separateur, sans point. */
const ATTACHMENTS_SESSION_RE = /^[A-Za-z0-9-]{1,64}$/;

/** Dossier des pieces d'une session : les 8 premiers caracteres de l'identifiant. */
export function attachmentsDir(sessionId: string): string {
  const short = sessionId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 8);
  return `${ATTACHMENTS_ROOT}/${short.length > 0 ? short : 'session'}`;
}

/**
 * Segment de session d'un dossier EXACTEMENT de la forme `<racine>/<session>`, ou
 * `null`. Le daemon ne cree un dossier que sur un `non-null` : ni la racine seule, ni
 * un sous-dossier plus profond, ni une traversee.
 */
export function attachmentsSessionOf(dir: string): string | null {
  if (!dir.startsWith(`${ATTACHMENTS_ROOT}/`)) return null;
  const rest = dir.slice(ATTACHMENTS_ROOT.length + 1);
  return ATTACHMENTS_SESSION_RE.test(rest) ? rest : null;
}

/** Vrai pour une ligne de message qui est un chemin de piece jointe. */
export function isAttachmentPath(line: string): boolean {
  return line.startsWith(`${ATTACHMENTS_ROOT}/`) && line.length > ATTACHMENTS_ROOT.length + 1;
}

/**
 * Nom de piece sur le Mac : `20260911-153012-IMG_4231.jpg`. L'horodatage rend l'ordre
 * lisible dans le navigateur de fichiers et evite la collision entre deux photos du
 * meme nom ; la collision restante est traitee par le suffixe habituel du daemon.
 */
export function attachmentName(original: string, now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const base = original.split('/').pop()?.trim() || 'piece';
  return `${stamp}-${base}`;
}

// --- Journal d'audit (C7) ------------------------------------------------------

export type AuditDirection = 'read' | 'write';

export interface AuditFileEntry {
  ts: string;
  action: string;
  path: string | null;
  bytes: number | null;
  direction: AuditDirection | null;
  result: 'ok' | 'denied' | 'error';
  /** Motif du refus, ou regle de liste noire declenchee. Jamais un libelle generique. */
  detail: string | null;
}

export interface AuditDiagnostic {
  parseFailed: number;
  nseFailed: number;
  /** Age en millisecondes de la derniere notification livree. `null` si aucune. */
  lastNotificationAgeMs: number | null;
  notificationsToday: number;
  bytesReadToday: number;
  bytesWrittenToday: number;
}

export interface AuditResponse {
  files: AuditFileEntry[];
  diagnostic: AuditDiagnostic;
  /** Jours de retention effectivement conserves. */
  retentionDays: number;
}

export const AUDIT_QUERY = { limit: 'limit', days: 'days' } as const;
export const AUDIT_PAGE_SIZE = 200;
export const AUDIT_RETENTION_DAYS = 30;
