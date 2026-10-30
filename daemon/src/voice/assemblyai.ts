// Dictee en direct : l'iPhone envoie son PCM a AssemblyAI, qui rend le texte au fil de l'eau.
//
// La cle vit dans le TROUSSEAU macOS (service `assemblyai-api-key`) et ne quitte JAMAIS le
// Mac : cette route l'echange contre un jeton de streaming de 60 s, puis rend l'URL
// WebSocket complete (jeton, modele, langues, glossaire, format audio). L'iPhone ouvre
// cette URL et parle directement a AssemblyAI.
//
// Le glossaire (`daemon/glossary/keyterms.txt`) est relu a chaque demande : Robin peut
// l'editer sans redemarrer le daemon.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VOICE_STREAM_SAMPLE_RATE, type VoiceStreamTokenResponse } from '@kovalink/protocol';
import { TranscriptionError, type Fetch } from './whisper.js';

export const ASSEMBLYAI_KEYCHAIN_SERVICE = 'assemblyai-api-key';
export const ASSEMBLYAI_TOKEN_URL = 'https://streaming.assemblyai.com/v3/token';
export const ASSEMBLYAI_STREAM_URL = 'wss://streaming.assemblyai.com/v3/ws';
/** Modele multilingue d'AssemblyAI pour le streaming. */
export const ASSEMBLYAI_SPEECH_MODEL = 'universal-3-6-pro';
/** Robin dicte en francais, avec des termes anglais : les deux langues sont declarees. */
export const ASSEMBLYAI_LANGUAGE_CODES: readonly string[] = ['fr', 'en'];
/** Duree de vie du jeton rendu a l'app, alignee sur `expires_in_seconds`. */
export const ASSEMBLYAI_TOKEN_TTL_MS = 60_000;
const TOKEN_EXPIRES_IN_SECONDS = 60;
/** Une session WebSocket peut durer 15 min, bien plus que le jeton qui l'ouvre. */
const MAX_SESSION_DURATION_SECONDS = 900;
const TIMEOUT_MS = 10_000;
const SECURITY_BIN = '/usr/bin/security';
/** Limites AssemblyAI : 100 termes au plus, 50 caracteres par terme. */
const MAX_KEYTERMS = 100;
const MAX_KEYTERM_CHARS = 50;

let cachedKey: string | null = null;

/**
 * La cle AssemblyAI, ou `null` si le trousseau n'en a pas. Jamais dans le journal.
 * Une lecture reussie est gardee en memoire ; un echec ne l'est pas, pour qu'une cle
 * ajoutee apres le demarrage soit vue sans redemarrer.
 */
export function readAssemblyaiKey(): string | null {
  if (process.env['KOVALINK_ASSEMBLYAI_KEY_CMD_DISABLED'] === '1') return null;
  if (cachedKey) return cachedKey;
  try {
    const key = execFileSync(
      SECURITY_BIN,
      ['find-generic-password', '-s', ASSEMBLYAI_KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8' },
    ).trim();
    if (key.length === 0) return null;
    cachedKey = key;
    return key;
  } catch {
    return null;
  }
}

/** Le glossaire du depot, surchargeable par `KOVALINK_KEYTERMS_FILE` (tests). */
export function glossaryFile(): string {
  return (
    process.env['KOVALINK_KEYTERMS_FILE'] ??
    // Ce module compile dans `daemon/dist/src/voice` : trois niveaux au-dessus, c'est
    // `daemon/`, donc `daemon/glossary/keyterms.txt`.
    fileURLToPath(new URL('../../../glossary/keyterms.txt', import.meta.url))
  );
}

/**
 * Les termes du glossaire, les plus importants d'abord. Une ligne = un terme, `#` en
 * debut de ligne = commentaire, lignes vides ignorees. Un fichier absent rend `[]` :
 * la dictee marche sans glossaire. Relu a chaque appel, jamais mis en cache.
 */
export function loadKeyterms(file = glossaryFile()): string[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const term = line.trim();
    if (term.length === 0 || term.startsWith('#') || term.length > MAX_KEYTERM_CHARS) continue;
    const folded = term.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    terms.push(term);
    if (terms.length >= MAX_KEYTERMS) break;
  }
  return terms;
}

/** Le message d'erreur d'AssemblyAI, sans jamais toucher a la cle. */
async function assemblyaiError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '');
  try {
    const body: unknown = JSON.parse(raw);
    if (body === null || typeof body !== 'object') return raw.slice(0, 300);
    if ('error' in body && typeof body.error === 'string') return body.error.slice(0, 300);
    if ('message' in body && typeof body.message === 'string') return body.message.slice(0, 300);
    if ('error' in body && body.error !== null && typeof body.error === 'object' && 'message' in body.error && typeof body.error.message === 'string') {
      return body.error.message.slice(0, 300);
    }
  } catch {
    // corps non JSON : on garde le texte brut
  }
  return raw.slice(0, 300);
}

/**
 * Echange la cle du trousseau contre un jeton de streaming, et rend l'URL WebSocket
 * prete a ouvrir. Le jeton expire en 60 s ; la session peut durer jusqu'a 15 min.
 */
export async function mintStreamToken(
  opts: { fetch?: Fetch; key?: string | null; keyterms?: string[]; now?: () => number } = {},
): Promise<VoiceStreamTokenResponse> {
  const key = opts.key === undefined ? readAssemblyaiKey() : opts.key;
  if (!key) {
    throw new TranscriptionError(
      'TRANSCRIPTION_UNAVAILABLE',
      `no AssemblyAI key in the Mac Keychain (service ${ASSEMBLYAI_KEYCHAIN_SERVICE}) to enable live dictation`,
    );
  }
  const keyterms = opts.keyterms ?? loadKeyterms();
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;

  const tokenUrl = `${ASSEMBLYAI_TOKEN_URL}?expires_in_seconds=${TOKEN_EXPIRES_IN_SECONDS}&max_session_duration_seconds=${MAX_SESSION_DURATION_SECONDS}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(tokenUrl, { headers: { authorization: key }, signal: controller.signal });
  } catch (e) {
    const err = e as Error;
    const why = err.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000} s` : err.message;
    throw new TranscriptionError('TRANSCRIPTION_FAILED', `Could not reach AssemblyAI (token: ${why})`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const message = await assemblyaiError(res);
    if (res.status === 401 || res.status === 403) {
      throw new TranscriptionError(
        'TRANSCRIPTION_UNAVAILABLE',
        `AssemblyAI refused the API key on the Mac (check the Keychain service ${ASSEMBLYAI_KEYCHAIN_SERVICE})`,
      );
    }
    throw new TranscriptionError(
      'TRANSCRIPTION_FAILED',
      `AssemblyAI token request failed (${res.status}${message ? `: ${message}` : ''})`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new TranscriptionError('TRANSCRIPTION_FAILED', 'AssemblyAI: token answer is not JSON');
  }
  const token = body !== null && typeof body === 'object' && 'token' in body && typeof body.token === 'string' ? body.token : '';
  if (token.length === 0) throw new TranscriptionError('TRANSCRIPTION_FAILED', 'AssemblyAI: no token in answer');

  const params = new URLSearchParams({
    token,
    sample_rate: String(VOICE_STREAM_SAMPLE_RATE),
    encoding: 'pcm_s16le',
    speech_model: ASSEMBLYAI_SPEECH_MODEL,
    language_codes: JSON.stringify(ASSEMBLYAI_LANGUAGE_CODES),
  });
  if (keyterms.length > 0) params.set('keyterms_prompt', JSON.stringify(keyterms));

  return {
    wsUrl: `${ASSEMBLYAI_STREAM_URL}?${params.toString()}`,
    sampleRate: VOICE_STREAM_SAMPLE_RATE,
    expiresAt: now() + ASSEMBLYAI_TOKEN_TTL_MS,
    keyterms: keyterms.length,
  };
}
