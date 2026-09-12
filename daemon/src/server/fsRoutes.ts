import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { basename } from 'node:path';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AUDIT_PAGE_SIZE,
  AUDIT_RETENTION_DAYS,
  FS_LIST_QUERY,
  FS_READ_DIGEST_HEADER,
  FS_READ_QUERY,
  FS_TEXT_QUERY,
  ROUTE_PATTERNS,
  TEXT_PREVIEW_FULL_MAX,
  TEXT_PREVIEW_TRUNCATED,
  UPLOAD_QUERY,
  type ErrorPayload,
  type FsSortDir,
  type FsSortKey,
  type FsTextResponse,
} from '@kovalink/protocol';
import { audit, readAudit } from '../audit.js';
import { listDirectory } from '../fs/list.js';
import { buildQuickDests } from '../fs/quickdests.js';
import { FsError, resolveFileForRead } from '../fs/resolve.js';
import { UploadStore } from '../fs/uploads.js';
import { logger } from '../logger.js';
import type { Services } from './services.js';

/**
 * Reponse d'erreur du bloc C.
 *
 * Elle porte le code REEL et le message REEL de la `FsError`. Un refus de liste noire
 * ne doit jamais arriver dans l'app sous l'etiquette « Mac injoignable » : c'est
 * exactement le genre de `catch` trompeur que ce depot a deja du purger huit fois.
 */
function sendFsError(reply: FastifyReply, e: unknown): void {
  if (e instanceof FsError) {
    const payload: ErrorPayload & { receivedBytes?: number } = {
      code: e.code,
      message: e.message,
      retryable: e.code === 'IO_ERROR' || e.code === 'OFFSET_MISMATCH',
    };
    const received = (e as FsError & { receivedBytes?: number }).receivedBytes;
    if (typeof received === 'number') payload.receivedBytes = received;
    void reply.code(e.status).send(payload);
    return;
  }
  const message = e instanceof Error ? e.message : String(e);
  logger.warn('route fichiers en echec', { err: message });
  const payload: ErrorPayload = { code: 'INTERNAL', message, retryable: false };
  void reply.code(500).send(payload);
}

function num(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** `Range: bytes=0-1023`. Une seule plage : le multipart byteranges est hors perimetre. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    // Suffixe : les N derniers octets.
    const len = Number(rawEnd);
    if (!Number.isFinite(len) || len <= 0) return null;
    return { start: Math.max(size - len, 0), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Routes du bloc C. Sept routes, pas une de plus.
 *
 * Il n'existe ici AUCUNE route de creation de dossier, de renommage, de deplacement, de
 * copie, de suppression ni de `reveal` : le PRD les exclut sans exception et le critere
 * CA-110 verifie leur absence du code source. Un balayage accidentel dans le metro est
 * irreparable, pour un bloc qui pese 4 % des ouvertures.
 */
/** SHA-256 hexadecimal d'un fichier, lu par morceaux de 64 Ko. */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export function registerFsRoutes(app: FastifyInstance, services: Services, uploads: UploadStore): void {
  // Corps binaire brut : le flux est passe TEL QUEL, sans mise en tampon. Sans ce
  // parseur, Fastify accumulerait le morceau entier en memoire et le plafond global de
  // 256 Ko le refuserait des le premier `PUT`.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
    done(null, payload);
  });

  // --- Navigation -------------------------------------------------------

  app.get<{ Querystring: Record<string, string | undefined> }>(
    ROUTE_PATTERNS.fsList,
    async (req, reply) => {
      if (!services.rate.allow(req.deviceId ?? '', 'fsList')) {
        const payload: ErrorPayload = {
          code: 'RATE_LIMITED',
          message: 'trop de listings',
          retryable: true,
        };
        return reply.code(429).send(payload);
      }
      const q = req.query;
      const path = q[FS_LIST_QUERY.path];
      try {
        const body = listDirectory(services.cfg(), {
          path,
          offset: num(q[FS_LIST_QUERY.offset]),
          limit: num(q[FS_LIST_QUERY.limit]),
          sort: q[FS_LIST_QUERY.sort] as FsSortKey | undefined,
          dir: q[FS_LIST_QUERY.dir] as FsSortDir | undefined,
          showHidden: q[FS_LIST_QUERY.showHidden] === 'true',
        });
        audit({
          deviceId: req.deviceId,
          action: 'fs.list',
          path: body.path,
          direction: 'read',
          result: 'ok',
          detail: `n=${body.entries.length}/${body.total}`,
        });
        return body;
      } catch (e) {
        audit({
          deviceId: req.deviceId,
          action: 'fs.list',
          path: typeof path === 'string' ? path : undefined,
          direction: 'read',
          result: e instanceof FsError && e.code === 'PATH_DENIED' ? 'denied' : 'error',
          detail: e instanceof FsError ? (e.rule ?? e.code) : 'INTERNAL',
        });
        return sendFsError(reply, e);
      }
    },
  );

  app.get(ROUTE_PATTERNS.fsQuickdests, async (req, reply) => {
    try {
      const body = buildQuickDests(services.panes.all(), services.cfg());
      audit({
        deviceId: req.deviceId,
        action: 'fs.quickdests',
        direction: 'read',
        result: 'ok',
        detail: `n=${body.dests.length}`,
      });
      return body;
    } catch (e) {
      return sendFsError(reply, e);
    }
  });

  // --- Lecture de fichier -----------------------------------------------

  /**
   * Telechargement EN FLUX, avec `Range` complet.
   *
   * La reprise d'un telechargement de 2 Go coupe au milieu est un `Range` de plus, rien
   * d'autre : aucun etat cote daemon, aucune session de download. Le fichier n'est jamais
   * charge en memoire, ni ici ni dans l'app (CA-101).
   *
   * `HEAD` est declare ICI, explicitement : la route HEAD que Fastify derive d'un GET
   * consomme le flux en entier (`payload.resume()`), soit une lecture complete du disque
   * pour ne rien envoyer. L'app fait un `HEAD ?digest=true` avant de telecharger pour
   * connaitre l'empreinte et la taille.
   */
  app.route<{ Querystring: Record<string, string | undefined> }>({
    method: ['GET', 'HEAD'],
    url: ROUTE_PATTERNS.fsRead,
    handler: async (req, reply) => {
      if (!services.rate.allow(req.deviceId ?? '', 'fsRead')) {
        const payload: ErrorPayload = {
          code: 'RATE_LIMITED',
          message: 'trop de lectures de fichier',
          retryable: true,
        };
        return reply.code(429).send(payload);
      }
      const raw = req.query[FS_READ_QUERY.path];
      try {
        const target = resolveFileForRead(raw, services.cfg());
        const size = target.stat.size;
        const range = parseRange(req.headers.range, size);

        reply.header('accept-ranges', 'bytes');
        reply.header('content-type', 'application/octet-stream');
        // `filename*` en UTF-8 : les fichiers de Robin portent des accents et des espaces.
        const name = basename(target.realPath);
        const disposition = req.query[FS_READ_QUERY.download] === 'true' ? 'attachment' : 'inline';
        reply.header(
          'content-disposition',
          `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
        );

        // Un fichier de 0 octet se telecharge sans erreur (CA-100) : `end` vaudrait -1,
        // ce que `createReadStream` refuse. On rend un corps vide, explicitement.
        if (size === 0) {
          audit({
            deviceId: req.deviceId,
            action: 'fs.read',
            path: target.realPath,
            bytes: 0,
            direction: 'read',
            result: 'ok',
          });
          reply.header('content-length', '0');
          return reply.code(range ? 206 : 200).send('');
        }

        const start = range?.start ?? 0;
        const end = range?.end ?? size - 1;
        const length = end - start + 1;

        if (range) {
          reply.header('content-range', `bytes ${start}-${end}/${size}`);
          reply.code(206);
        } else if (req.query[FS_READ_QUERY.digest] === 'true') {
          // CA-101, sens Mac vers iPhone : empreinte du fichier entier, calculee EN FLUX
          // (jamais le fichier en memoire), envoyee en en-tete avant le corps.
          reply.header(FS_READ_DIGEST_HEADER, await sha256OfFile(target.realPath));
        }
        reply.header('content-length', String(length));

        // `HEAD` (route creee par Fastify a partir du GET) : l'app lit l'empreinte et la
        // taille AVANT de telecharger. Aucun octet ne part, le journal ne dit pas le
        // contraire, et aucun flux n'est ouvert pour etre aussitot detruit.
        if (req.method === 'HEAD') {
          audit({
            deviceId: req.deviceId,
            action: 'fs.read',
            path: target.realPath,
            bytes: 0,
            direction: 'read',
            result: 'ok',
            detail: `head size=${size}`,
          });
          return reply.send();
        }

        audit({
          deviceId: req.deviceId,
          action: 'fs.read',
          path: target.realPath,
          bytes: length,
          direction: 'read',
          result: 'ok',
          detail: range ? `range=${start}-${end}/${size}` : `full=${size}`,
        });
        return reply.send(createReadStream(target.realPath, { start, end }));
      } catch (e) {
        audit({
          deviceId: req.deviceId,
          action: 'fs.read',
          path: typeof raw === 'string' ? raw : undefined,
          direction: 'read',
          result: e instanceof FsError && e.code === 'PATH_DENIED' ? 'denied' : 'error',
          detail: e instanceof FsError ? (e.rule ?? e.code) : 'INTERNAL',
        });
        return sendFsError(reply, e);
      }
    },
  });

  /**
   * Apercu texte. Integral jusqu'a 10 Mo, puis les 200 premiers Ko (PRD C2, CA-99).
   *
   * La troncature est ANNONCEE dans la reponse : un fichier coupe en silence ferait
   * croire a Robin qu'il a tout lu.
   */
  app.get<{ Querystring: Record<string, string | undefined> }>(
    ROUTE_PATTERNS.fsText,
    async (req, reply) => {
      if (!services.rate.allow(req.deviceId ?? '', 'fsRead')) {
        const payload: ErrorPayload = {
          code: 'RATE_LIMITED',
          message: 'trop de lectures de fichier',
          retryable: true,
        };
        return reply.code(429).send(payload);
      }
      const raw = req.query[FS_TEXT_QUERY.path];
      try {
        const target = resolveFileForRead(raw, services.cfg());
        const size = target.stat.size;
        const truncated = size > TEXT_PREVIEW_FULL_MAX;
        const wanted = truncated ? TEXT_PREVIEW_TRUNCATED : size;

        const chunks: Buffer[] = [];
        let read = 0;
        if (wanted > 0) {
          const stream = createReadStream(target.realPath, { start: 0, end: wanted - 1 });
          for await (const piece of stream) {
            const buf = piece as Buffer;
            chunks.push(buf);
            read += buf.length;
          }
        }
        const text = Buffer.concat(chunks, read).toString('utf8');

        audit({
          deviceId: req.deviceId,
          action: 'fs.text',
          path: target.realPath,
          bytes: read,
          direction: 'read',
          result: 'ok',
          detail: truncated ? 'tronque' : 'integral',
        });
        const body: FsTextResponse = {
          path: target.realPath,
          text,
          size,
          truncated,
          bytes: read,
          mime: null,
        };
        return body;
      } catch (e) {
        audit({
          deviceId: req.deviceId,
          action: 'fs.text',
          path: typeof raw === 'string' ? raw : undefined,
          direction: 'read',
          result: e instanceof FsError && e.code === 'PATH_DENIED' ? 'denied' : 'error',
          detail: e instanceof FsError ? (e.rule ?? e.code) : 'INTERNAL',
        });
        return sendFsError(reply, e);
      }
    },
  );

  // --- Upload -----------------------------------------------------------

  app.post<{ Body: { destDir?: unknown; filename?: unknown; size?: unknown; sha256?: unknown } }>(
    ROUTE_PATTERNS.fsUploadInit,
    async (req, reply) => {
      const body = req.body ?? {};
      try {
        const res = uploads.init(body);
        audit({
          deviceId: req.deviceId,
          action: 'fs.upload.init',
          path: `${String(body.destDir)}/${String(body.filename)}`,
          // Pas de `bytes` ici : la taille ANNONCEE n'est pas une taille transferee.
          // Le volume du jour se compte sur `fs.upload.complete`, une fois seulement.
          direction: 'write',
          result: 'ok',
          detail:
            res.receivedBytes > 0
              ? `reprise a ${res.receivedBytes} sur ${String(body.size)}`
              : `nouveau, ${String(body.size)} octets annonces`,
        });
        return res;
      } catch (e) {
        // Le refus de liste noire arrive ICI, AVANT le moindre octet transfere (CA-109).
        audit({
          deviceId: req.deviceId,
          action: 'fs.upload.init',
          path: typeof body.destDir === 'string' ? body.destDir : undefined,
          direction: 'write',
          result: e instanceof FsError && e.code === 'PATH_DENIED' ? 'denied' : 'error',
          detail: e instanceof FsError ? (e.rule ?? e.code) : 'INTERNAL',
        });
        return sendFsError(reply, e);
      }
    },
  );

  app.put<{ Params: { uploadId: string }; Querystring: Record<string, string | undefined> }>(
    ROUTE_PATTERNS.fsUpload,
    async (req, reply) => {
      const offset = num(req.query[UPLOAD_QUERY.offset]);
      if (offset === undefined) {
        const payload: ErrorPayload = {
          code: 'BAD_REQUEST',
          message: `parametre ${UPLOAD_QUERY.offset} requis : un morceau sans position ne peut pas etre repris.`,
          retryable: false,
        };
        return reply.code(400).send(payload);
      }
      try {
        const res = await uploads.writeChunk(
          req.params.uploadId,
          offset,
          // Le parseur de contenu binaire passe le flux tel quel : `body` EST le flux.
          req.body as unknown as Readable,
        );
        audit({
          deviceId: req.deviceId,
          action: 'fs.upload.chunk',
          bytes: res.receivedBytes - offset,
          direction: 'write',
          result: 'ok',
          detail: `offset=${offset}`,
        });
        return res;
      } catch (e) {
        audit({
          deviceId: req.deviceId,
          action: 'fs.upload.chunk',
          direction: 'write',
          result: 'error',
          detail: e instanceof FsError ? e.code : 'INTERNAL',
        });
        return sendFsError(reply, e);
      }
    },
  );

  app.get<{ Params: { uploadId: string } }>(ROUTE_PATTERNS.fsUpload, async (req, reply) => {
    try {
      return uploads.status(req.params.uploadId);
    } catch (e) {
      return sendFsError(reply, e);
    }
  });

  /**
   * Annulation. Aucun fichier partiel ne subsiste dans le dossier de destination (CA-108).
   *
   * C'est le SEUL `DELETE` du bloc C, et il ne touche qu'un `.kovalink-upload-*.part`
   * cree par le daemon lui meme. Il ne peut, par construction, supprimer aucun fichier
   * de Robin : le chemin vient du manifeste, jamais de la requete.
   */
  app.delete<{ Params: { uploadId: string } }>(ROUTE_PATTERNS.fsUpload, async (req, reply) => {
    try {
      const res = uploads.abort(req.params.uploadId);
      audit({
        deviceId: req.deviceId,
        action: 'fs.upload.abort',
        direction: 'write',
        result: 'ok',
      });
      return res;
    } catch (e) {
      return sendFsError(reply, e);
    }
  });

  app.post<{ Params: { uploadId: string } }>(ROUTE_PATTERNS.fsUploadComplete, async (req, reply) => {
    try {
      const res = await uploads.complete(req.params.uploadId);
      audit({
        deviceId: req.deviceId,
        action: 'fs.upload.complete',
        path: res.path,
        bytes: res.size,
        direction: 'write',
        result: 'ok',
        detail: res.renamed ? `renomme en ${res.name}` : 'nom conserve',
      });
      return res;
    } catch (e) {
      audit({
        deviceId: req.deviceId,
        action: 'fs.upload.complete',
        direction: 'write',
        result: e instanceof FsError && e.code === 'PATH_DENIED' ? 'denied' : 'error',
        detail: e instanceof FsError ? (e.rule ?? e.code) : 'INTERNAL',
      });
      return sendFsError(reply, e);
    }
  });

  // --- Journal d'audit (C7) ---------------------------------------------

  app.get<{ Querystring: Record<string, string | undefined> }>(
    ROUTE_PATTERNS.audit,
    async (req, reply) => {
      if (!services.rate.allow(req.deviceId ?? '', 'audit')) {
        const payload: ErrorPayload = {
          code: 'RATE_LIMITED',
          message: 'trop de lectures du journal',
          retryable: true,
        };
        return reply.code(429).send(payload);
      }
      return readAudit({
        limit: num(req.query['limit']) ?? AUDIT_PAGE_SIZE,
        days: num(req.query['days']) ?? AUDIT_RETENTION_DAYS,
      });
    },
  );
}
