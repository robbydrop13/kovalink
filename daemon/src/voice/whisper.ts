// Mode vocal : transcription par OpenAI Whisper (`whisper-1`), depuis le Mac.
//
// La cle vit dans `~/.kovalink/openai-key` (une ligne) et ne quitte JAMAIS le Mac :
// l'iPhone envoie l'audio au daemon, le daemon parle a OpenAI. L'audio est transmis en
// memoire et n'est jamais ecrit sur le disque du Mac. Un seul appel :
//   `POST /v1/audio/transcriptions` (multipart : file, model, response_format=json) -> { text }
// Aucune langue imposee : Robin parle francais et anglais, Whisper la detecte.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TranscribeResponse } from '@kovalink/protocol';
import { paths } from '../paths.js';

export const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const WHISPER_MODEL = 'whisper-1';
const TIMEOUT_MS = 120_000;

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

/** Whisper deduit le format de l'extension du fichier : on la cale sur le type MIME. */
function whisperFilename(mime: string, filename: string): string {
  const ext: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/webm': 'webm' };
  const wanted = ext[mime];
  if (!wanted) return filename;
  return `${filename.replace(/\.[^.]*$/, '')}.${wanted}`;
}

/** Message d'erreur d'OpenAI (`{ error: { message } }`), mot pour mot quand il existe. */
async function openaiErrorDetail(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '');
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown } | string };
    const m = typeof body.error === 'string' ? body.error : body.error?.message;
    if (typeof m === 'string') return m;
  } catch {
    // corps non JSON : on garde le texte brut
  }
  return raw.slice(0, 500);
}

/**
 * Transcrit un enregistrement. `audio` est le corps complet (10 Mo max, verifie par la
 * route), `mime` son type. Rend le texte ; `response_format=json` ne donne ni langue ni duree.
 */
export async function transcribe(
  audio: Buffer,
  mime: string,
  filename: string,
  deps: { fetch?: Fetch; key?: string | null; timeoutMs?: number } = {},
): Promise<TranscribeResponse> {
  const key = deps.key === undefined ? readOpenaiKey() : deps.key;
  if (!key) {
    throw new TranscriptionError(
      'TRANSCRIPTION_UNAVAILABLE',
      `no OpenAI key on the Mac: put it in ${openaiKeyFile()} (one line) to enable voice input`,
    );
  }
  const doFetch = deps.fetch ?? fetch;

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), whisperFilename(mime, filename));
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
    throw new TranscriptionError('TRANSCRIPTION_FAILED', `Whisper: ${why}`);
  }

  if (!res.ok) {
    const detail = await openaiErrorDetail(res);
    const code = res.status === 401 ? 'TRANSCRIPTION_UNAVAILABLE' : 'TRANSCRIPTION_FAILED';
    throw new TranscriptionError(code, `Whisper ${res.status}${detail ? `: ${detail}` : ''}`);
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
