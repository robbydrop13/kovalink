// Client HTTPS du bloc C. `fetch` standard, comme le reste de l'app (A12).
//
// Règle du fichier : aucun chemin n'est écrit en dur, tout passe par `ROUTES` et par les
// noms de paramètres du protocole partagé. Un format inventé séparément de chaque côté a
// déjà coûté une journée sur l'appairage.
//
// Règle de mémoire : ni le téléchargement ni l'envoi ne construisent le fichier entier en
// mémoire. Le téléchargement écrit directement sur le disque de l'iPhone via
// `File.downloadFileAsync`, l'envoi lit des tranches de 4 Mo via `FileHandle.readBytes`.
import { File, type FileHandle } from 'expo-file-system';
import {
  AUDIT_QUERY,
  FS_LIST_QUERY,
  FS_READ_DIGEST_HEADER,
  FS_READ_QUERY,
  UPLOAD_CHUNK_BYTES,
  FS_TEXT_QUERY,
  ROUTES,
  UPLOAD_QUERY,
  type AuditResponse,
  type FsListResponse,
  type FsQuickDestsResponse,
  type FsSortDir,
  type FsSortKey,
  type FsTextResponse,
  type UploadCompleteResponse,
  type UploadInitRequest,
  type UploadInitResponse,
  type UploadOffsetMismatch,
} from '@/protocol';
import { loadCredentials, type Credentials } from '@/store/credentials';
import { Sha256, digestVerdict } from '@/utils/sha256';
import { HttpError, baseUrl } from './http';

async function creds(): Promise<Credentials> {
  const c = await loadCredentials();
  if (!c) throw new HttpError(401, 'UNAUTHORIZED', 'Appareil non appairé');
  return c;
}

/**
 * Lit la réponse d'erreur du daemon et la relaie TELLE QUELLE.
 *
 * Le daemon renvoie un `code` et un `message` qui portent la cause réelle : un chemin en
 * liste noire, un dossier qu'aucun droit macOS ne laisse lire, un offset à recaler. Les
 * remplacer par « Une erreur est survenue » a déjà coûté des heures de diagnostic sur ce
 * projet, et ces messages sont écrits pour être affichés.
 */
async function readError(res: Response, path: string): Promise<HttpError> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { code?: string; message?: string } & Partial<UploadOffsetMismatch>;
    const err = new HttpError(res.status, body.code ?? 'INTERNAL', body.message ?? `HTTP ${res.status} sur ${path}`);
    if (typeof body.receivedBytes === 'number') {
      (err as HttpError & { receivedBytes?: number }).receivedBytes = body.receivedBytes;
    }
    return err;
  } catch {
    return new HttpError(res.status, 'INTERNAL', `HTTP ${res.status} sur ${path} : ${text.slice(0, 200)}`);
  }
}

interface JsonOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function json<T>(path: string, o: JsonOptions = {}): Promise<T> {
  const c = await creds();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 12_000);
  const onAbort = (): void => controller.abort();
  o.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${baseUrl(c)}${path}`, {
      method: o.method ?? 'GET',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${c.token}`,
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
    if (!res.ok) throw await readError(res, path);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

// --- Navigation ---------------------------------------------------------------

export function listDirectory(
  path: string,
  o: { offset?: number; sort?: FsSortKey; dir?: FsSortDir; showHidden?: boolean } = {},
): Promise<FsListResponse> {
  const q = new URLSearchParams();
  q.set(FS_LIST_QUERY.path, path);
  if (o.offset !== undefined) q.set(FS_LIST_QUERY.offset, String(o.offset));
  if (o.sort) q.set(FS_LIST_QUERY.sort, o.sort);
  if (o.dir) q.set(FS_LIST_QUERY.dir, o.dir);
  if (o.showHidden) q.set(FS_LIST_QUERY.showHidden, 'true');
  return json(`${ROUTES.fsList}?${q.toString()}`);
}

export function fetchQuickDests(): Promise<FsQuickDestsResponse> {
  return json(ROUTES.fsQuickdests);
}

export function fetchText(path: string): Promise<FsTextResponse> {
  const q = new URLSearchParams();
  q.set(FS_TEXT_QUERY.path, path);
  return json(`${ROUTES.fsText}?${q.toString()}`, { timeoutMs: 20_000 });
}

export function fetchAudit(limit?: number): Promise<AuditResponse> {
  const q = new URLSearchParams();
  if (limit !== undefined) q.set(AUDIT_QUERY.limit, String(limit));
  return json(`${ROUTES.audit}?${q.toString()}`);
}

/** URL absolue d'un fichier du Mac. Utilisée par l'aperçu image et par le téléchargement. */
export async function fileUrl(path: string, download = false): Promise<{ url: string; headers: Record<string, string> }> {
  const c = await creds();
  const q = new URLSearchParams();
  q.set(FS_READ_QUERY.path, path);
  if (download) q.set(FS_READ_QUERY.download, 'true');
  return {
    url: `${baseUrl(c)}${ROUTES.fsRead}?${q.toString()}`,
    // Le jeton reste dans un en-tête. Il ne transite JAMAIS par une URL (C8), même pour
    // une balise `<Image>` : une URL finit dans un journal, un cache, un partage.
    headers: { authorization: `Bearer ${c.token}` },
  };
}

/**
 * Empreinte et taille annoncées par le Mac, lues par un `HEAD ?digest=true` AVANT le
 * téléchargement (CA-101, sens Mac vers iPhone). `File.downloadFileAsync` n'expose pas
 * les en-têtes de réponse, d'où cette requête séparée. Le daemon calcule l'empreinte en
 * flux et n'envoie aucun octet sur un HEAD.
 */
async function fetchDigest(
  path: string,
  signal?: AbortSignal,
): Promise<{ sha256: string | null; size: number | null }> {
  const c = await creds();
  const q = new URLSearchParams();
  q.set(FS_READ_QUERY.path, path);
  q.set(FS_READ_QUERY.digest, 'true');
  const route = `${ROUTES.fsRead}?${q.toString()}`;
  const res = await fetch(`${baseUrl(c)}${route}`, {
    method: 'HEAD',
    ...(signal ? { signal } : {}),
    headers: { authorization: `Bearer ${c.token}` },
  });
  if (!res.ok) throw await readError(res, route);
  const length = Number(res.headers.get('content-length'));
  return {
    sha256: res.headers.get(FS_READ_DIGEST_HEADER),
    size: Number.isFinite(length) ? length : null,
  };
}

export type DownloadPhase = 'downloading' | 'verifying';

/**
 * Téléchargement vers l'iPhone, EN FLUX, puis vérification d'empreinte.
 *
 * `File.downloadFileAsync` écrit directement sur le disque : le fichier de 1,2 Go du
 * critère CA-101 ne passe jamais par la mémoire de l'app. La progression est relayée
 * telle quelle, et l'annulation passe par un `AbortSignal` réel.
 *
 * Une fois écrit, le fichier est haché par tranches et comparé à l'empreinte du Mac.
 * Une divergence SUPPRIME le fichier et lève `CHECKSUM_MISMATCH` : un fichier corrompu
 * enregistré en silence est pire qu'un échec. Sans empreinte du Mac, le résultat est dit
 * `unverified`, jamais présenté comme vérifié.
 */
export async function downloadToDevice(
  remotePath: string,
  destination: File,
  o: {
    onProgress?: (received: number, total: number) => void;
    onPhase?: (phase: DownloadPhase) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ file: File; verified: boolean }> {
  const expected = await fetchDigest(remotePath, o.signal);
  const { url, headers } = await fileUrl(remotePath, true);
  o.onPhase?.('downloading');
  const file = await File.downloadFileAsync(url, destination, {
    headers,
    idempotent: true,
    ...(o.signal ? { signal: o.signal } : {}),
    ...(o.onProgress
      ? {
          onProgress: (p: { bytesWritten?: number; totalBytes?: number }) =>
            o.onProgress?.(p.bytesWritten ?? 0, p.totalBytes ?? 0),
        }
      : {}),
  });

  o.onPhase?.('verifying');
  const { handle } = openLocalFile(file.uri);
  let actual: string;
  try {
    actual = await sha256OfLocalFile(handle, file.size, () => o.signal?.aborted === true);
  } finally {
    try {
      handle.close();
    } catch {
      // Poignée déjà fermée : rien à signaler.
    }
  }
  if (o.signal?.aborted) {
    file.delete();
    throw new HttpError(499, 'ABORTED', 'Téléchargement annulé.');
  }
  const verdict = digestVerdict(expected.sha256, actual);
  if (verdict === 'mismatch') {
    file.delete();
    throw new HttpError(
      422,
      'CHECKSUM_MISMATCH',
      `Empreinte différente après téléchargement : ${actual.slice(0, 12)}… sur l’iPhone, ` +
        `${(expected.sha256 ?? '').slice(0, 12)}… sur le Mac. Le fichier a été supprimé, réessaie.`,
    );
  }
  return { file, verified: verdict === 'ok' };
}

// --- Envoi vers le Mac ---------------------------------------------------------

export function uploadInit(body: UploadInitRequest): Promise<UploadInitResponse> {
  return json(ROUTES.fsUploadInit, { method: 'POST', body });
}

export function uploadComplete(uploadId: string): Promise<UploadCompleteResponse> {
  // La vérification d'empreinte se fait en flux côté Mac : elle peut prendre plusieurs
  // secondes sur un gros fichier, d'où un délai large.
  return json(ROUTES.fsUploadComplete(uploadId), { method: 'POST', timeoutMs: 120_000 });
}

export function uploadAbort(uploadId: string): Promise<{ aborted: boolean }> {
  return json(ROUTES.fsUpload(uploadId), { method: 'DELETE' });
}

/**
 * Envoie UN morceau, à une position absolue.
 *
 * Le corps est un `Uint8Array` de 4 Mo au plus : c'est le seul endroit de l'app où des
 * octets de fichier existent en mémoire, et ils y restent le temps d'une requête.
 *
 * Un `409 OFFSET_MISMATCH` n'est pas une panne : il porte le `receivedBytes` réel du Mac,
 * et l'appelant s'y recale au lieu de recommencer le fichier (CA-107).
 */
export async function uploadChunk(
  uploadId: string,
  offset: number,
  chunk: Uint8Array,
  signal?: AbortSignal,
): Promise<{ receivedBytes: number }> {
  const c = await creds();
  const q = new URLSearchParams();
  q.set(UPLOAD_QUERY.offset, String(offset));
  const path = `${ROUTES.fsUpload(uploadId)}?${q.toString()}`;
  const res = await fetch(`${baseUrl(c)}${path}`, {
    method: 'PUT',
    ...(signal ? { signal } : {}),
    headers: {
      authorization: `Bearer ${c.token}`,
      'content-type': 'application/octet-stream',
    },
    body: chunk as unknown as BodyInit,
  });
  if (!res.ok) throw await readError(res, path);
  return (await res.json()) as { receivedBytes: number };
}

/** Lecture par tranches d'un fichier local. Ouvre, lit, referme : jamais tout d'un coup. */
export function openLocalFile(uri: string): { file: File; handle: FileHandle } {
  const file = new File(uri);
  return { file, handle: file.open() };
}

export function readSlice(handle: FileHandle, offset: number, length: number): Uint8Array {
  handle.offset = offset;
  return handle.readBytes(length);
}

/** Tranches de lecture pour l'empreinte : les mêmes 4 Mo que l'envoi. */
const HASH_SLICE_BYTES = UPLOAD_CHUNK_BYTES;

/**
 * Empreinte d'un fichier local, en flux. Cède la main entre deux tranches pour ne pas
 * geler l'interface, et s'arrête net si le transfert est annulé. Sert dans les deux sens
 * de CA-101 : avant l'envoi vers le Mac, après le téléchargement depuis le Mac.
 */
export async function sha256OfLocalFile(
  handle: FileHandle,
  size: number,
  isCanceled: () => boolean = () => false,
): Promise<string> {
  const hash = new Sha256();
  for (let offset = 0; offset < size; offset += HASH_SLICE_BYTES) {
    if (isCanceled()) return '';
    hash.update(readSlice(handle, offset, Math.min(HASH_SLICE_BYTES, size - offset)));
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return hash.digest();
}
