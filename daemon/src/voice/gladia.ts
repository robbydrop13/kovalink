// Mode vocal : transcription par Gladia (API v2, pre-enregistre), depuis le Mac.
//
// La cle vit dans `~/.kovalink/gladia-key` (une ligne) et ne quitte JAMAIS le Mac :
// l'iPhone envoie l'audio au daemon, le daemon parle a Gladia. L'audio est transmis en
// memoire et n'est jamais ecrit sur le disque du Mac. Trois appels :
//   1. `POST /v2/upload` (multipart)         -> { audio_url }
//   2. `POST /v2/pre-recorded` { audio_url } -> { id, result_url }
//   3. `GET result_url` jusqu'a `status: done` -> result.transcription.full_transcript
// Langue detectee automatiquement : Robin parle francais et anglais.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TranscribeResponse } from '@kovalink/protocol';
import { paths } from '../paths.js';

export const GLADIA_BASE = 'https://api.gladia.io';
const POLL_MS = 800;
const POLL_MAX_MS = 120_000;

export class TranscriptionError extends Error {
  constructor(
    readonly code: 'TRANSCRIPTION_UNAVAILABLE' | 'TRANSCRIPTION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

export function gladiaKeyFile(): string {
  return process.env['KOVALINK_GLADIA_KEY_FILE'] ?? join(paths.home(), 'gladia-key');
}

/** La cle, ou `null` si le fichier est absent ou vide. Jamais dans le journal. */
export function readGladiaKey(): string | null {
  try {
    const key = readFileSync(gladiaKeyFile(), 'utf8').trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export type Fetch = typeof fetch;

/** Message d'erreur de Gladia, mot pour mot quand le corps en porte un. */
async function gladiaError(res: Response, step: string): Promise<TranscriptionError> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown; detail?: unknown };
    const m = body.message ?? body.error ?? body.detail;
    detail = typeof m === 'string' ? m : JSON.stringify(m ?? body);
  } catch {
    detail = await res.text().catch(() => '');
  }
  return new TranscriptionError('TRANSCRIPTION_FAILED', `Gladia ${step} ${res.status}${detail ? `: ${detail}` : ''}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Transcrit un enregistrement. `audio` est le corps complet (10 Mo max, verifie par la
 * route), `mime` son type. Rend le texte, la langue et la duree.
 */
export async function transcribe(
  audio: Buffer,
  mime: string,
  filename: string,
  deps: { fetch?: Fetch; key?: string | null; pollMs?: number; now?: () => number } = {},
): Promise<TranscribeResponse> {
  const key = deps.key === undefined ? readGladiaKey() : deps.key;
  if (!key) {
    throw new TranscriptionError(
      'TRANSCRIPTION_UNAVAILABLE',
      `no Gladia key on the Mac: put it in ${gladiaKeyFile()} (one line) to enable voice input`,
    );
  }
  const doFetch = deps.fetch ?? fetch;
  const headers = { 'x-gladia-key': key };

  // 1. Upload : multipart, l'audio en memoire.
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audio)], { type: mime }), filename);
  const up = await doFetch(`${GLADIA_BASE}/v2/upload`, { method: 'POST', headers, body: form });
  if (!up.ok) throw await gladiaError(up, 'upload');
  const uploaded = (await up.json()) as { audio_url?: unknown };
  if (typeof uploaded.audio_url !== 'string') throw new TranscriptionError('TRANSCRIPTION_FAILED', 'Gladia upload: no audio_url in answer');

  // 2. Transcription : langue detectee automatiquement.
  const start = await doFetch(`${GLADIA_BASE}/v2/pre-recorded`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: uploaded.audio_url, detect_language: true }),
  });
  if (!start.ok) throw await gladiaError(start, 'pre-recorded');
  const job = (await start.json()) as { id?: unknown; result_url?: unknown };
  if (typeof job.result_url !== 'string') throw new TranscriptionError('TRANSCRIPTION_FAILED', 'Gladia pre-recorded: no result_url in answer');

  // 3. Resultat : on interroge jusqu'a `done`, ou `error`.
  const now = deps.now ?? Date.now;
  const deadline = now() + POLL_MAX_MS;
  while (now() < deadline) {
    const res = await doFetch(job.result_url, { headers });
    if (!res.ok) throw await gladiaError(res, 'result');
    const body = (await res.json()) as {
      status?: unknown;
      error_code?: unknown;
      result?: { transcription?: { full_transcript?: unknown; languages?: unknown }; metadata?: { audio_duration?: unknown } };
    };
    if (body.status === 'done') {
      const text = typeof body.result?.transcription?.full_transcript === 'string' ? body.result.transcription.full_transcript.trim() : '';
      const langs = body.result?.transcription?.languages;
      const language = Array.isArray(langs) && typeof langs[0] === 'string' ? (langs[0] as string) : null;
      const duration = body.result?.metadata?.audio_duration;
      return { text, language, durationMs: typeof duration === 'number' ? Math.round(duration * 1000) : null };
    }
    if (body.status === 'error') {
      throw new TranscriptionError('TRANSCRIPTION_FAILED', `Gladia result: ${typeof body.error_code === 'string' ? body.error_code : 'error'}`);
    }
    await sleep(deps.pollMs ?? POLL_MS);
  }
  throw new TranscriptionError('TRANSCRIPTION_FAILED', 'Gladia result: timed out after 120 s');
}
