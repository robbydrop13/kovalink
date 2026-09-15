// Mode vocal : transcription par OpenAI Whisper (`whisper-1`), depuis le Mac.
//
// La cle vit dans `~/.kovalink/openai-key` (une ligne) et ne quitte JAMAIS le Mac :
// l'iPhone envoie l'audio au daemon, le daemon parle a OpenAI. Un seul appel :
//   `POST /v1/audio/transcriptions` (multipart : file, model, response_format=json) -> { text }
// Aucune langue imposee : Robin parle francais et anglais, Whisper la detecte.
//
// Normalisation : avant l'envoi, l'audio est converti en wav 16 kHz mono (PCM 16 bits) par
// `afconvert` de macOS. Whisper refusait certains m4a de l'iPhone ("could not be decoded")
// que d'autres decodeurs lisent. `afconvert` ne sait lire que des fichiers : l'audio passe
// donc par un fichier temporaire prive (dossier `mkdtemp` 0700, fichier 0600), efface dans
// un `finally` meme en cas d'erreur. Il ne reste rien sur le disque apres la requete.
// Si la conversion echoue (format que Core Audio ne lit pas, webm par exemple), le fichier
// d'origine part tel quel et Whisper tranche.
// Taille : 16 kHz mono = 1,9 Mo par minute ; 10 Mo de m4a a 128 kbit/s font ~10 min, soit
// ~19 Mo de wav, sous la limite de 25 Mo d'OpenAI.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscribeResponse } from '@kovalink/protocol';
import { logger } from '../logger.js';
import { paths } from '../paths.js';

export const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const WHISPER_MODEL = 'whisper-1';
export const AFCONVERT_BIN = '/usr/bin/afconvert';
const TIMEOUT_MS = 120_000;
const CONVERT_TIMEOUT_MS = 60_000;

export class TranscriptionError extends Error {
  constructor(
    readonly code: 'TRANSCRIPTION_UNAVAILABLE' | 'TRANSCRIPTION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

export function openaiKeyFile(): string {
  return process.env['KOVALINK_OPENAI_KEY_FILE'] ?? join(paths.home(), 'openai-key');
}

/** La cle, ou `null` si le fichier est absent ou vide. Jamais dans le journal. */
export function readOpenaiKey(): string | null {
  try {
    const key = readFileSync(openaiKeyFile(), 'utf8').trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export type Fetch = typeof fetch;
/** Convertit l'audio (`ext` = extension d'origine, sans point) en wav 16 kHz mono. */
export type Convert = (audio: Buffer, ext: string) => Promise<Buffer>;

/** Extension d'origine deduite du type MIME : Whisper et `afconvert` s'y fient. */
export function audioExtension(mime: string): string {
  const ext: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/aac': 'aac' };
  return ext[mime] ?? 'm4a';
}

/** Whisper deduit le format de l'extension du fichier : on la cale sur le type MIME. */
function whisperFilename(mime: string, filename: string): string {
  return `${filename.replace(/\.[^.]*$/, '')}.${audioExtension(mime)}`;
}

/**
 * `afconvert` vers wav 16 kHz mono PCM 16 bits, via un dossier temporaire prive efface
 * quoi qu'il arrive. `bin` et `tmpRoot` sont injectables pour les tests.
 */
export async function afconvertToWav(
  audio: Buffer,
  ext: string,
  opts: { bin?: string; tmpRoot?: string; timeoutMs?: number } = {},
): Promise<Buffer> {
  const dir = await mkdtemp(join(opts.tmpRoot ?? tmpdir(), 'kovalink-voice-'));
  try {
    const input = join(dir, `in.${ext.replace(/[^a-z0-9]/gi, '') || 'm4a'}`);
    const output = join(dir, 'out.wav');
    await writeFile(input, audio, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      execFile(
        opts.bin ?? AFCONVERT_BIN,
        ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', input, output],
        { timeout: opts.timeoutMs ?? CONVERT_TIMEOUT_MS },
        (err, _stdout, stderr) => {
          if (!err) return resolve();
          const why = String(stderr).trim().split('\n').pop() || err.message;
          reject(new Error(`afconvert: ${why.slice(0, 200)}`));
        },
      );
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Retire tout ce qui ressemble a une cle OpenAI, meme masquee, d'un texte venu d'OpenAI. */
function scrubKey(s: string): string {
  return s.replace(/sk-[A-Za-z0-9_*\-]+/g, 'sk-[REDACTED]');
}

/** Message et code d'erreur d'OpenAI (`{ error: { message, code, type } }`). */
async function openaiError(res: Response): Promise<{ message: string; kind: string }> {
  const raw = await res.text().catch(() => '');
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown; code?: unknown; type?: unknown } | string };
    if (typeof body.error === 'string') return { message: scrubKey(body.error), kind: '' };
    const m = body.error?.message;
    const kind = [body.error?.code, body.error?.type].filter((x) => typeof x === 'string').join(' ');
    if (typeof m === 'string') return { message: scrubKey(m), kind };
  } catch {
    // corps non JSON : on garde le texte brut
  }
  return { message: scrubKey(raw.slice(0, 500)), kind: '' };
}

/** La raison lisible, en anglais, affichee telle quelle par l'app. */
function reasonFor(status: number, message: string, kind: string, converted: boolean): string {
  const text = `${kind} ${message}`;
  if (status === 401) return 'OpenAI refused the API key on the Mac (check ~/.kovalink/openai-key)';
  if (/insufficient_quota|billing|credit|quota/i.test(text)) return 'OpenAI account has no credits left (check billing)';
  if (status === 403) return 'OpenAI refused the API key for this request (check the key and project permissions)';
  if (status === 429) return 'OpenAI rate limit reached, try again in a moment';
  if (status === 400 && /decod|format|invalid file|corrupt/i.test(text)) {
    return converted
      ? 'OpenAI could not decode the audio'
      : 'The recording could not be decoded (incomplete or unsupported audio file)';
  }
  if (status === 413) return 'Recording too large for OpenAI';
  if (status >= 500) return 'OpenAI is unavailable right now, try again';
  return 'OpenAI rejected the request';
}

/**
 * Transcrit un enregistrement. `audio` est le corps complet (10 Mo max, verifie par la
 * route), `mime` son type. Rend le texte ; `response_format=json` ne donne ni langue ni duree.
 */
export async function transcribe(
  audio: Buffer,
  mime: string,
  filename: string,
  deps: { fetch?: Fetch; key?: string | null; timeoutMs?: number; convert?: Convert } = {},
): Promise<TranscribeResponse> {
  const key = deps.key === undefined ? readOpenaiKey() : deps.key;
  if (!key) {
    throw new TranscriptionError(
      'TRANSCRIPTION_UNAVAILABLE',
      `no OpenAI key on the Mac: put it in ${openaiKeyFile()} (one line) to enable voice input`,
    );
  }
  const doFetch = deps.fetch ?? fetch;
  const convert = deps.convert ?? ((a: Buffer, ext: string) => afconvertToWav(a, ext));

  let payload = audio;
  let payloadMime = mime;
  let payloadName = whisperFilename(mime, filename);
  let converted = false;
  try {
    payload = await convert(audio, audioExtension(mime));
    payloadMime = 'audio/wav';
    payloadName = `${filename.replace(/\.[^.]*$/, '')}.wav`;
    converted = true;
  } catch (e) {
    logger.warn('voix : conversion en wav impossible, envoi du fichier tel quel', {
      mime,
      bytes: audio.length,
      err: (e as Error).message,
    });
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(payload)], { type: payloadMime }), payloadName);
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'json');

  let res: Response;
  try {
    res = await doFetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    const why = err.name === 'TimeoutError' || err.name === 'AbortError' ? `timed out after ${Math.round((deps.timeoutMs ?? TIMEOUT_MS) / 1000)} s` : err.message;
    logger.warn('voix : OpenAI injoignable', { err: why });
    throw new TranscriptionError('TRANSCRIPTION_FAILED', `Could not reach OpenAI (Whisper: ${why})`);
  }

  if (!res.ok) {
    const { message, kind } = await openaiError(res);
    // Jamais la cle ni le texte : le statut, le message d'OpenAI et la forme de l'envoi.
    logger.warn('voix : OpenAI a refuse la transcription', {
      status: res.status,
      openaiError: message,
      openaiKind: kind,
      bytes: payload.length,
      sentAs: payloadName,
      converted,
    });
    const code = res.status === 401 ? 'TRANSCRIPTION_UNAVAILABLE' : 'TRANSCRIPTION_FAILED';
    const reason = reasonFor(res.status, message, kind, converted);
    throw new TranscriptionError(code, `${reason} (Whisper ${res.status}${message ? `: ${message}` : ''})`);
  }

  let body: { text?: unknown };
  try {
    body = (await res.json()) as { text?: unknown };
  } catch {
    throw new TranscriptionError('TRANSCRIPTION_FAILED', 'Whisper: answer is not JSON');
  }
  if (typeof body.text !== 'string') throw new TranscriptionError('TRANSCRIPTION_FAILED', 'Whisper: no text in answer');
  return { text: body.text.trim(), language: null, durationMs: null };
}
