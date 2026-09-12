import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  createReadStream,
  fstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_FREE_SPACE_MARGIN,
  type UploadCompleteResponse,
  type UploadInitResponse,
  type UploadStatusResponse,
} from '@kovalink/protocol';
import type { KovalinkConfig } from '../config.js';
import { paths } from '../paths.js';
import { ensureAttachmentsDir } from './attachments.js';
import {
  assertSameInode,
  FsError,
  openForWrite,
  resolveForWrite,
  uniqueName,
} from './resolve.js';

/** Manifeste persiste : la reprise survit a un redemarrage du daemon (archi 2.10). */
interface Manifest {
  uploadId: string;
  destDir: string;
  filename: string;
  size: number;
  sha256: string | null;
  partPath: string;
  receivedBytes: number;
  /** Inode du `.part` a la creation. Revalide a chaque morceau. */
  ino: string;
  dev: string;
  createdAt: string;
  updatedAt: string;
}

/** Purge des `.part` abandonnes apres 24 h (archi 2.10). */
const ABANDON_MS = 24 * 60 * 60 * 1000;

function uploadsDir(): string {
  return join(paths.home(), 'uploads');
}

function manifestPath(uploadId: string): string {
  return join(uploadsDir(), `${uploadId}.json`);
}

/**
 * Transferts iPhone vers Mac, en trois temps : `init`, `PUT` par morceaux, `complete`.
 *
 * Aucun fichier entier ne passe en memoire, dans aucun des trois temps. Les morceaux
 * arrivent en flux et sont ecrits au fur et a mesure a une position absolue ; l'empreinte
 * SHA-256 de verification est calculee en relisant le `.part` en flux.
 *
 * Le `.part` vit dans le dossier de DESTINATION, donc sur le meme volume : le `rename`
 * final est alors atomique, et il n'existe jamais de fichier a moitie ecrit portant le
 * nom definitif. Une annulation ne laisse rien derriere elle (CA-108).
 */
export class UploadStore {
  private readonly busy = new Set<string>();

  constructor(private readonly cfg: () => KovalinkConfig) {
    mkdirSync(uploadsDir(), { recursive: true, mode: 0o700 });
  }

  // --- Persistance ------------------------------------------------------

  private read(uploadId: string): Manifest {
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) {
      throw new FsError('BAD_REQUEST', 400, `identifiant de transfert invalide`, uploadId);
    }
    try {
      return JSON.parse(readFileSync(manifestPath(uploadId), 'utf8')) as Manifest;
    } catch {
      throw new FsError(
        'UPLOAD_NOT_FOUND',
        404,
        `transfert ${uploadId} inconnu : il a ete termine, annule, ou purge apres 24 h.`,
        uploadId,
      );
    }
  }

  private write(m: Manifest): void {
    m.updatedAt = new Date().toISOString();
    mkdirSync(uploadsDir(), { recursive: true, mode: 0o700 });
    writeFileSync(manifestPath(m.uploadId), `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
  }

  /** Verrou par transfert : deux `PUT` simultanes ecriraient a la meme position. */
  private lock(uploadId: string): void {
    if (this.busy.has(uploadId)) {
      throw new FsError(
        'RATE_LIMITED',
        409,
        `un morceau du transfert ${uploadId} est deja en cours d ecriture`,
        uploadId,
      );
    }
    this.busy.add(uploadId);
  }

  private unlock(uploadId: string): void {
    this.busy.delete(uploadId);
  }

  // --- Init -------------------------------------------------------------

  /**
   * Ouvre un transfert, ou retrouve celui qui a ete coupe.
   *
   * Reprise : un transfert deja ouvert sur le meme dossier, le meme nom et la meme
   * taille est repris a son `receivedBytes` reel, relu sur le disque et non sur le
   * manifeste. Le manifeste peut retarder d'un morceau si le daemon est mort pendant
   * l'ecriture ; le disque, lui, ne ment pas.
   */
  init(req: { destDir?: unknown; filename?: unknown; size?: unknown; sha256?: unknown }): UploadInitResponse {
    const cfg = this.cfg();
    const size = typeof req.size === 'number' ? req.size : Number.NaN;
    if (!Number.isFinite(size) || size < 0 || !Number.isInteger(size)) {
      throw new FsError('BAD_REQUEST', 400, 'taille de fichier requise, en octets', '');
    }
    const sha256 =
      typeof req.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(req.sha256)
        ? req.sha256.toLowerCase()
        : null;

    // Pieces jointes du chat (docs/15) : le dossier de session est cree ici, en 0700,
    // et SEULEMENT sous la racine du protocole. Toute autre destination doit exister.
    ensureAttachmentsDir(req.destDir);

    // Liste noire, O_NOFOLLOW et inode : toute ecriture passe par la, sans exception.
    const target = resolveForWrite(req.destDir, req.filename, cfg);

    // Aucun plafond arbitraire (A4) : la seule limite est le disque. On refuse quand
    // il manquerait la place, avec le chiffre reel, pas un seuil invente.
    this.assertFreeSpace(target.dir, size);

    const resumed = this.findResumable(target.dir, target.name, size, sha256);
    if (resumed) {
      const onDisk = this.partSize(resumed);
      if (onDisk !== resumed.receivedBytes) {
        resumed.receivedBytes = onDisk;
        this.write(resumed);
      }
      return {
        uploadId: resumed.uploadId,
        receivedBytes: resumed.receivedBytes,
        chunkBytes: UPLOAD_CHUNK_BYTES,
        plannedName: uniqueName(target.dir, target.name).name,
      };
    }

    const uploadId = randomUUID();
    const partName = `.kovalink-upload-${uploadId}.part`;
    // Le `.part` est lui aussi soumis a la liste noire : c'est une ecriture reelle.
    const part = resolveForWrite(target.dir, partName, cfg);
    const opened = openForWrite(part.path, 'create');
    closeSync(opened.fd);

    const manifest: Manifest = {
      uploadId,
      destDir: target.dir,
      filename: target.name,
      size,
      sha256,
      partPath: part.path,
      receivedBytes: 0,
      ino: String(opened.ino),
      dev: String(opened.dev),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.write(manifest);

    return {
      uploadId,
      receivedBytes: 0,
      chunkBytes: UPLOAD_CHUNK_BYTES,
      plannedName: uniqueName(target.dir, target.name).name,
    };
  }

  private assertFreeSpace(dir: string, size: number): void {
    let free: number;
    try {
      const fs = statfsSync(dir);
      free = Number(fs.bavail) * Number(fs.bsize);
    } catch {
      // `statfs` indisponible : on n'invente pas un refus, on laisse le disque trancher.
      return;
    }
    const needed = size + UPLOAD_FREE_SPACE_MARGIN;
    if (free >= needed) return;
    throw new FsError(
      'NO_SPACE',
      507,
      `il reste ${mib(free)} sur le volume de ${dir}, il en faut ${mib(needed)} pour ce fichier de ${mib(size)}.`,
      dir,
    );
  }

  private findResumable(
    destDir: string,
    filename: string,
    size: number,
    sha256: string | null,
  ): Manifest | null {
    for (const m of this.allManifests()) {
      if (m.destDir !== destDir || m.filename !== filename || m.size !== size) continue;
      // Deux fichiers de meme nom et meme taille mais de contenus differents existent :
      // l'empreinte, quand elle est fournie, tranche. Sans empreinte, on reprend, et
      // le `complete` refusera si le resultat ne correspond a rien d'attendu.
      if (sha256 && m.sha256 && sha256 !== m.sha256) continue;
      try {
        statSync(m.partPath);
      } catch {
        // Le `.part` a disparu : le manifeste ne vaut plus rien.
        this.forget(m.uploadId);
        continue;
      }
      return m;
    }
    return null;
  }

  private allManifests(): Manifest[] {
    let names: string[];
    try {
      names = readdirSync(uploadsDir());
    } catch {
      return [];
    }
    const out: Manifest[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(readFileSync(join(uploadsDir(), name), 'utf8')) as Manifest);
      } catch {
        /* manifeste illisible : ignore, il sera purge */
      }
    }
    return out;
  }

  private partSize(m: Manifest): number {
    try {
      return statSync(m.partPath).size;
    } catch {
      return 0;
    }
  }

  // --- Morceaux ---------------------------------------------------------

  status(uploadId: string): UploadStatusResponse {
    const m = this.read(uploadId);
    return {
      uploadId: m.uploadId,
      receivedBytes: this.partSize(m),
      size: m.size,
      destDir: m.destDir,
      filename: m.filename,
      chunkBytes: UPLOAD_CHUNK_BYTES,
    };
  }

  /**
   * Ecrit un morceau a une position absolue.
   *
   * Un `offset` qui ne correspond pas repond `409` avec le `receivedBytes` REEL : le
   * client se recale sur ce chiffre, il ne recommence pas le fichier. C'est ce qui tient
   * le critere CA-107, ou le total d'octets envoyes doit rester sous 1,6 fois la taille.
   *
   * Le flux est consomme morceau par morceau : rien n'est concatene en memoire.
   */
  async writeChunk(uploadId: string, offset: number, body: Readable): Promise<{ receivedBytes: number }> {
    const m = this.read(uploadId);
    const onDisk = this.partSize(m);

    if (!Number.isInteger(offset) || offset < 0) {
      throw new FsError('BAD_REQUEST', 400, `offset invalide : ${offset}`, m.partPath);
    }
    if (offset !== onDisk) {
      const err = new FsError(
        'OFFSET_MISMATCH',
        409,
        `offset ${offset} alors que ${onDisk} octets sont deja recus : reprends a ${onDisk}.`,
        m.partPath,
      );
      // Le client a besoin du chiffre, pas seulement du message.
      (err as FsError & { receivedBytes: number }).receivedBytes = onDisk;
      throw err;
    }
    if (offset > m.size) {
      throw new FsError(
        'BAD_REQUEST',
        400,
        `offset ${offset} au dela de la taille annoncee (${m.size})`,
        m.partPath,
      );
    }

    this.lock(uploadId);
    // O_NOFOLLOW et comparaison d'inode a CHAQUE morceau, pas seulement a l'ouverture :
    // un transfert dure des minutes, et le `.part` pourrait etre remplace entre deux.
    const opened = openForWrite(m.partPath, 'resume');
    try {
      assertSameInode(opened, { ino: m.ino, dev: m.dev });
      if (fstatSync(opened.fd).size !== onDisk) {
        throw new FsError(
          'PATH_DENIED',
          409,
          `la taille de ${m.partPath} a change pendant l ouverture : ecriture abandonnee.`,
          m.partPath,
        );
      }

      let position = offset;
      for await (const piece of body) {
        const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as Uint8Array);
        if (buf.length === 0) continue;
        if (position + buf.length > m.size) {
          throw new FsError(
            'BAD_REQUEST',
            400,
            `le morceau depasse la taille annoncee : ${position + buf.length} octets pour ${m.size} declares.`,
            m.partPath,
          );
        }
        let written = 0;
        while (written < buf.length) {
          written += writeSync(opened.fd, buf, written, buf.length - written, position + written);
        }
        position += buf.length;
      }

      m.receivedBytes = position;
      this.write(m);
      return { receivedBytes: position };
    } finally {
      closeSync(opened.fd);
      this.unlock(uploadId);
    }
  }

  // --- Complete ---------------------------------------------------------

  /**
   * Publie le fichier.
   *
   * Trois gardes, dans cet ordre : la taille recue doit egaler la taille annoncee,
   * l'empreinte SHA-256 doit correspondre quand le client en a fourni une, et le nom
   * final repasse par `resolveForWrite`. Ce dernier point n'est pas une formalite : le
   * `.part` a ete valide sous SON nom, la collision en produit un AUTRE, qui doit
   * repasser la liste noire (archi 2.10).
   */
  async complete(uploadId: string): Promise<UploadCompleteResponse> {
    const cfg = this.cfg();
    const m = this.read(uploadId);
    const received = this.partSize(m);

    if (received !== m.size) {
      throw new FsError(
        'BAD_REQUEST',
        409,
        `transfert incomplet : ${received} octets recus sur ${m.size} annonces. Reprends a ${received}.`,
        m.partPath,
      );
    }

    const actual = await sha256OfFile(m.partPath);
    if (m.sha256 && actual !== m.sha256) {
      // Rien n'est publie. Le `.part` reste pour un rejeu, il sera purge a 24 h.
      throw new FsError(
        'CHECKSUM_MISMATCH',
        422,
        `empreinte differente : ${actual} recu, ${m.sha256} attendu. Le fichier n a PAS ete publie.`,
        m.partPath,
      );
    }

    const chosen = uniqueName(m.destDir, m.filename);
    const final = resolveForWrite(m.destDir, chosen.name, cfg);

    // Le `.part` vit en 0600 pour qu'un fichier a moitie ecrit ne soit pas lisible par
    // les agents qui tournent sous le meme uid. Une fois publie, c'est un fichier de
    // Robin comme les autres : on lui rend les droits que lui donnerait le Finder, en
    // respectant son umask. Un fichier a 0600 au milieu d'un projet surprendrait les
    // outils qui le lisent ensuite.
    try {
      chmodSync(m.partPath, 0o666 & ~currentUmask());
    } catch {
      // Droits non modifiables : ce n'est pas une raison pour perdre le transfert.
    }

    try {
      renameSync(m.partPath, final.path);
    } catch (e) {
      const err = e as { code?: string };
      throw new FsError(
        'IO_ERROR',
        500,
        `publication de ${final.path} impossible : ${err.code ?? 'erreur inconnue'}`,
        final.path,
      );
    }
    this.forget(uploadId);

    return {
      path: final.path,
      name: chosen.name,
      size: m.size,
      sha256: actual,
      renamed: chosen.renamed,
    };
  }

  /** Annulation : le `.part` disparait, rien ne subsiste dans la destination (CA-108). */
  abort(uploadId: string): { aborted: boolean } {
    const m = this.read(uploadId);
    try {
      unlinkSync(m.partPath);
    } catch {
      /* deja parti */
    }
    this.forget(uploadId);
    return { aborted: true };
  }

  private forget(uploadId: string): void {
    try {
      unlinkSync(manifestPath(uploadId));
    } catch {
      /* deja parti */
    }
  }

  /** Purge des transferts abandonnes. Appelee au demarrage du daemon. */
  purge(now = Date.now()): number {
    let removed = 0;
    for (const m of this.allManifests()) {
      if (now - Date.parse(m.updatedAt) < ABANDON_MS) continue;
      try {
        unlinkSync(m.partPath);
      } catch {
        /* deja parti */
      }
      this.forget(m.uploadId);
      removed += 1;
    }
    return removed;
  }
}

/** SHA-256 en FLUX. Un fichier de 1,2 Go ne passe jamais en memoire (CA-101). */
export function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
    stream.on('data', (c) => hash.update(c));
    stream.on('error', (e) =>
      reject(
        new FsError(
          'IO_ERROR',
          500,
          `lecture de ${path} impossible pour le calcul d empreinte : ${(e as Error).message}`,
          path,
        ),
      ),
    );
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/** Umask du processus, lu sans le modifier durablement. */
function currentUmask(): number {
  const mask = process.umask(0o022);
  process.umask(mask);
  return mask;
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
