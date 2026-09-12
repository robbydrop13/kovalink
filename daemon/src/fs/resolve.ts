import {
  closeSync,
  constants as FS,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import type { ErrorCode } from '@kovalink/protocol';
import type { KovalinkConfig } from '../config.js';
import { checkRead, checkWrite } from '../security/denylist.js';

/**
 * Erreur de chemin qui porte sa CAUSE REELLE.
 *
 * Regle du projet : jamais un libelle generique. Un refus de liste noire, un dossier
 * inexistant et une permission macOS manquante produisent trois messages differents,
 * parce qu'ils appellent trois gestes differents de la part de Robin. Huit `catch`
 * trompeurs ont deja ete supprimes de ce depot.
 */
export class FsError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly path: string,
    /** Regle de liste noire declenchee, quand c'en est une. Journalisee telle quelle. */
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'FsError';
  }
}

/** Traduit un `errno` de Node en cause lisible. Le code systeme reste dans le message. */
function fromErrno(e: unknown, path: string): FsError {
  const err = e as { code?: string; message?: string };
  switch (err.code) {
    case 'ENOENT':
      return new FsError('PATH_NOT_FOUND', 404, `${path} n existe pas`, path);
    case 'EACCES':
    case 'EPERM':
      return new FsError(
        'READ_DENIED',
        403,
        `macOS refuse l acces a ${path} (${err.code}). Le daemon tourne sous ton utilisateur : ce dossier ne lui est pas accessible.`,
        path,
      );
    case 'ENOTDIR':
      return new FsError('NOT_A_DIRECTORY', 400, `${path} n est pas un dossier`, path);
    case 'EISDIR':
      return new FsError('NOT_A_FILE', 400, `${path} est un dossier`, path);
    case 'ELOOP':
      return new FsError(
        'PATH_DENIED',
        403,
        `${path} est un lien symbolique la ou un fichier reel est exige`,
        path,
      );
    case 'ENOSPC':
      return new FsError('NO_SPACE', 507, `plus d espace disque pour ecrire ${path}`, path);
    case 'ENAMETOOLONG':
      return new FsError('BAD_REQUEST', 400, `nom de fichier trop long : ${path}`, path);
    default:
      return new FsError(
        'IO_ERROR',
        500,
        `${err.code ?? 'erreur'} sur ${path}${err.message ? ` : ${err.message}` : ''}`,
        path,
      );
  }
}

/**
 * Normalise un chemin venu du reseau.
 *
 * `resolve` ecrase les `..`, donc `~/dev/../.ssh/id_rsa` devient `~/.ssh/id_rsa` AVANT
 * toute comparaison de liste noire : la traversee de repertoire ne peut pas survivre
 * a cette etape. Un chemin relatif est refuse, jamais resolu contre le `cwd` du daemon.
 */
export function normalizeRequestPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new FsError('BAD_REQUEST', 400, 'chemin requis', '');
  }
  if (raw.includes('\0')) {
    throw new FsError('BAD_REQUEST', 400, 'chemin contenant un octet nul', '');
  }
  if (!isAbsolute(raw)) {
    throw new FsError(
      'BAD_REQUEST',
      400,
      `chemin relatif refuse : ${raw}. Le daemon n a pas de repertoire courant partage avec l app.`,
      raw,
    );
  }
  return resolve(raw);
}

export interface ReadTarget {
  /** Chemin demande, normalise. */
  path: string;
  /** Chemin apres resolution des liens. Peut differer de `path`. */
  realPath: string;
  stat: Stats;
}

/**
 * LECTURE TOTALE sur tout le disque, c'est le choix arrete de Robin (C5, PRD C1).
 *
 * La seule restriction est `denyRead`, qui couvre les secrets du daemon lui meme. On
 * verifie la liste noire AVANT et APRES resolution des liens : un lien pose dans un
 * dossier lisible vers `~/.kovalink/devices.json` doit echouer, et il echoue sur le
 * second controle.
 */
export function resolveForRead(raw: unknown, cfg: KovalinkConfig): ReadTarget {
  const path = normalizeRequestPath(raw);

  const before = checkRead(path, cfg);
  if (!before.allowed) {
    throw new FsError('PATH_DENIED', 403, `lecture refusee sur ${path}`, path, before.rule);
  }

  let realPath: string;
  try {
    realPath = realpathSync.native(path);
  } catch (e) {
    throw fromErrno(e, path);
  }

  const after = checkRead(realPath, cfg);
  if (!after.allowed) {
    throw new FsError(
      'PATH_DENIED',
      403,
      `lecture refusee : ${path} pointe sur ${realPath}`,
      path,
      after.rule,
    );
  }

  try {
    return { path, realPath, stat: statSync(realPath) };
  } catch (e) {
    throw fromErrno(e, path);
  }
}

/** Meme resolution, plus l'exigence d'un dossier. Utilise par le listing. */
export function resolveDirForRead(raw: unknown, cfg: KovalinkConfig): ReadTarget {
  const target = resolveForRead(raw, cfg);
  if (!target.stat.isDirectory()) {
    throw new FsError('NOT_A_DIRECTORY', 400, `${target.path} n est pas un dossier`, target.path);
  }
  return target;
}

/** Meme resolution, plus l'exigence d'un fichier ordinaire. */
export function resolveFileForRead(raw: unknown, cfg: KovalinkConfig): ReadTarget {
  const target = resolveForRead(raw, cfg);
  if (!target.stat.isFile()) {
    throw new FsError(
      'NOT_A_FILE',
      400,
      `${target.path} n est pas un fichier ordinaire`,
      target.path,
    );
  }
  return target;
}

/**
 * Nom de fichier accepte a l'ecriture.
 *
 * Un nom n'est JAMAIS un chemin : tout separateur, tout `..`, toute chaine vide est
 * refusee ici, en amont de la jointure. C'est le seul endroit du daemon ou un nom
 * venu du reseau devient un segment de chemin.
 */
export function sanitizeFilename(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new FsError('BAD_REQUEST', 400, 'nom de fichier requis', '');
  }
  const name = raw.trim();
  if (name.length === 0) {
    throw new FsError('BAD_REQUEST', 400, 'nom de fichier vide', '');
  }
  if (name === '.' || name === '..') {
    throw new FsError('BAD_REQUEST', 400, `nom de fichier refuse : ${name}`, name);
  }
  if (name.includes(sep) || name.includes('/') || name.includes('\0')) {
    throw new FsError(
      'BAD_REQUEST',
      400,
      `le nom « ${name} » contient un separateur de chemin. Le dossier de destination se choisit dans « destDir », jamais dans le nom.`,
      name,
    );
  }
  if (Buffer.byteLength(name, 'utf8') > 255) {
    throw new FsError('BAD_REQUEST', 400, `nom de fichier trop long : ${name.slice(0, 40)}…`, name);
  }
  return name;
}

export interface WriteTarget {
  /** Dossier de destination, apres resolution des liens. */
  dir: string;
  /** Chemin final absolu, `dir` + nom. */
  path: string;
  name: string;
}

/**
 * ECRITURE : liste noire (C5), et RIEN d'autre n'est permissif.
 *
 * Deroulement, dans cet ordre et pas un autre :
 * 1. le dossier est resolu par `realpath`, donc les liens symboliques du chemin sont
 *    aplatis avant toute decision ;
 * 2. `checkWrite` s'applique au dossier REEL, pas au chemin demande : un lien
 *    `~/raccourci` vers `~/Library/LaunchAgents` est refuse comme la cible ;
 * 3. `checkWrite` s'applique une seconde fois au chemin final, parce que les regles
 *    `name:` et `mode:executable` portent sur le dernier segment.
 *
 * L'ouverture elle meme passe par `openForWrite`, qui ajoute `O_NOFOLLOW` et la
 * comparaison d'inode. Les deux sont indissociables : la resolution seule laisse une
 * fenetre entre la verification et l'ouverture.
 */
export function resolveForWrite(rawDir: unknown, rawName: unknown, cfg: KovalinkConfig): WriteTarget {
  const requested = normalizeRequestPath(rawDir);
  const name = sanitizeFilename(rawName);

  let dir: string;
  try {
    dir = realpathSync.native(requested);
  } catch (e) {
    const err = fromErrno(e, requested);
    if (err.code === 'PATH_NOT_FOUND') {
      // Message specifique : le bloc C n'a pas de route `mkdir`, c'est une decision
      // du PRD. Dire « choisis un dossier existant » evite de chercher un bouton
      // qui n'existera jamais.
      throw new FsError(
        'PATH_NOT_FOUND',
        404,
        `${requested} n existe pas. KovaLink ne cree pas de dossier : choisis un dossier deja present sur le Mac.`,
        requested,
      );
    }
    throw err;
  }

  let st: Stats;
  try {
    st = statSync(dir);
  } catch (e) {
    throw fromErrno(e, dir);
  }
  if (!st.isDirectory()) {
    throw new FsError('NOT_A_DIRECTORY', 400, `${dir} n est pas un dossier`, dir);
  }

  const dirVerdict = checkWrite(dir, cfg);
  if (!dirVerdict.allowed) {
    throw new FsError(
      'PATH_DENIED',
      403,
      `Ecriture refusee sur ${dir} (regle ${dirVerdict.rule}). Ce dossier fait partie des mecanismes de demarrage et d authentification du Mac. La lecture reste possible.`,
      dir,
      dirVerdict.rule,
    );
  }

  const path = join(dir, name);
  const fileVerdict = checkWrite(path, cfg);
  if (!fileVerdict.allowed) {
    throw new FsError(
      'PATH_DENIED',
      403,
      `Ecriture refusee sur ${path} (regle ${fileVerdict.rule}). La lecture reste possible.`,
      path,
      fileVerdict.rule,
    );
  }

  return { dir, path, name };
}

export interface OpenedWrite {
  fd: number;
  path: string;
  /** Inode et peripherique observes a l'ouverture. Revalides a chaque reprise. */
  ino: bigint;
  dev: bigint;
}

/**
 * Ouverture d'un fichier en ecriture avec `O_NOFOLLOW` et comparaison d'inode.
 *
 * `O_NOFOLLOW` fait echouer l'ouverture si le DERNIER segment est un lien symbolique :
 * c'est ce qui empeche un lien depose entre la verification et l'ouverture de rediriger
 * l'ecriture (TOCTOU). La comparaison `fstat` contre `lstat` ferme la fenetre restante :
 * si le fichier a ete remplace entre les deux appels, les inodes divergent et on refuse.
 *
 * `mode` de creation en 0600 : un `.part` a moitie ecrit ne doit pas etre lisible par
 * les agents qui tournent sous le meme uid tant qu'il n'est pas publie.
 */
export function openForWrite(path: string, mode: 'create' | 'resume'): OpenedWrite {
  const flags =
    mode === 'create'
      ? FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW
      : FS.O_WRONLY | FS.O_NOFOLLOW;

  let fd: number;
  try {
    fd = openSync(path, flags, 0o600);
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'ELOOP') {
      throw new FsError(
        'PATH_DENIED',
        403,
        `${path} est un lien symbolique : KovaLink n ecrit jamais au travers d un lien.`,
        path,
      );
    }
    throw fromErrno(e, path);
  }

  try {
    const viaFd = fstatSync(fd, { bigint: true });
    const viaPath = lstatSync(path, { bigint: true });
    if (viaFd.ino !== viaPath.ino || viaFd.dev !== viaPath.dev) {
      throw new FsError(
        'PATH_DENIED',
        409,
        `${path} a change d inode entre la verification et l ouverture : ecriture abandonnee.`,
        path,
      );
    }
    if (!viaFd.isFile()) {
      throw new FsError('NOT_A_FILE', 400, `${path} n est pas un fichier ordinaire`, path);
    }
    return { fd, path, ino: viaFd.ino, dev: viaFd.dev };
  } catch (e) {
    closeSync(fd);
    if (e instanceof FsError) throw e;
    throw fromErrno(e, path);
  }
}

/** Revalidation d'un `.part` repris : meme inode qu'a l'`init`, ou on refuse. */
export function assertSameInode(opened: OpenedWrite, expected: { ino: string; dev: string }): void {
  if (String(opened.ino) !== expected.ino || String(opened.dev) !== expected.dev) {
    throw new FsError(
      'PATH_DENIED',
      409,
      `le fichier temporaire ${opened.path} a ete remplace depuis le debut du transfert : reprise refusee.`,
      opened.path,
    );
  }
}

/**
 * Nom libre dans `dir` : `capture.png`, puis `capture-2.png`, `capture-3.png`.
 *
 * Format unique dans tout le projet (PRD C4, design 4.7). Jamais d'ecrasement, jamais
 * de bouton « Remplacer ». La boucle s'arrete a 999 : au dela, c'est un bug d'appel,
 * pas une collision, et il faut le dire plutot que de tourner.
 */
export function uniqueName(dir: string, name: string): { name: string; renamed: boolean } {
  if (!exists(join(dir, name))) return { name, renamed: false };
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; i <= 999; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!exists(join(dir, candidate))) return { name: candidate, renamed: true };
  }
  throw new FsError(
    'IO_ERROR',
    409,
    `999 fichiers nommes ${name} existent deja dans ${dir} : le suffixe automatique ne suffit plus.`,
    join(dir, name),
  );
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Abrege `/Users/<moi>` en `~` pour l'affichage. Jamais pour une comparaison. */
export function abbreviate(path: string, home: string): string {
  if (path === home) return '~';
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

export { basename, dirname };
