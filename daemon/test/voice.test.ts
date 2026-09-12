// Mode vocal : la route refuse un fichier trop gros et un type non audio, et le client
// Gladia relaie l'erreur mot pour mot. Le faux Gladia est un `fetch` en memoire.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { ROUTES, TRANSCRIBE_MAX_BYTES } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-voice-'));
process.env['KOVALINK_QUIET'] = '1';
process.env['KOVALINK_GLADIA_KEY_FILE'] = join(process.env['KOVALINK_HOME'], 'gladia-key');

const { transcribe, TranscriptionError, GLADIA_BASE } = await import('../src/voice/gladia.js');

type FakeCall = { url: string; init: RequestInit | undefined };

/** Faux Gladia : upload, lancement, puis un resultat `processing` avant `done`. */
function fakeGladia(options: { failAt?: 'upload' | 'pre-recorded' | 'result'; message?: string } = {}) {
  const calls: FakeCall[] = [];
  let polls = 0;
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${GLADIA_BASE}/v2/upload`) {
      if (options.failAt === 'upload') return json(401, { message: options.message ?? 'Invalid API key' });
      return json(200, { audio_url: 'https://api.gladia.io/file/abc' });
    }
    if (url === `${GLADIA_BASE}/v2/pre-recorded`) {
      if (options.failAt === 'pre-recorded') return json(400, { message: options.message ?? 'bad request' });
      return json(201, { id: 'job-1', result_url: `${GLADIA_BASE}/v2/pre-recorded/job-1` });
    }
    if (url === `${GLADIA_BASE}/v2/pre-recorded/job-1`) {
      polls += 1;
      if (options.failAt === 'result') return json(200, { status: 'error', error_code: 'audio_too_short' });
      if (polls === 1) return json(200, { status: 'processing' });
      return json(200, {
        status: 'done',
        result: { transcription: { full_transcript: ' Recrée un unique commit ', languages: ['fr'] }, metadata: { audio_duration: 2.4 } },
      });
    }
    return json(404, { message: 'unknown url' });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const AUDIO = Buffer.from('fake m4a bytes');

describe('client Gladia', () => {
  it('sans cle sur le Mac : TRANSCRIPTION_UNAVAILABLE avec le chemin du fichier a creer', async () => {
    const { fetchImpl, calls } = fakeGladia();
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_UNAVAILABLE' && /gladia-key/.test(e.message),
    );
    assert.equal(calls.length, 0, 'rien ne part vers Gladia sans cle');
  });

  it('upload, lancement avec detection de langue, puis resultat : texte, langue, duree', async () => {
    const { fetchImpl, calls } = fakeGladia();
    const res = await transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k-test', pollMs: 1 });
    assert.deepEqual(res, { text: 'Recrée un unique commit', language: 'fr', durationMs: 2400 });
    assert.deepEqual(calls.map((c) => c.url), [
      `${GLADIA_BASE}/v2/upload`,
      `${GLADIA_BASE}/v2/pre-recorded`,
      `${GLADIA_BASE}/v2/pre-recorded/job-1`,
      `${GLADIA_BASE}/v2/pre-recorded/job-1`,
    ]);
    for (const c of calls) assert.equal((c.init?.headers as Record<string, string>)['x-gladia-key'], 'k-test');
    assert.equal(JSON.parse(String(calls[1]?.init?.body)).detect_language, true);
  });

  it('relaie l erreur de Gladia mot pour mot, avec l etape et le statut', async () => {
    const { fetchImpl } = fakeGladia({ failAt: 'upload', message: 'Invalid API key: revoked on 2026-09-01' });
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k' }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_FAILED' && e.message === 'Gladia upload 401: Invalid API key: revoked on 2026-09-01',
    );
    const result = fakeGladia({ failAt: 'result' });
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: result.fetchImpl, key: 'k', pollMs: 1 }),
      /Gladia result: audio_too_short/,
    );
  });

  it('lit la cle dans le fichier du Mac', async () => {
    writeFileSync(process.env['KOVALINK_GLADIA_KEY_FILE'] as string, 'k-from-file\n', { mode: 0o600 });
    const { fetchImpl, calls } = fakeGladia();
    await transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, pollMs: 1 });
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['x-gladia-key'], 'k-from-file');
  });
});

describe('route POST /v1/transcribe', () => {
  // La route est declaree dans `createHttpServer` (TLS, hub...). On la reconstruit ici a
  // l'identique sur un Fastify nu, avec le meme parseur et les memes bornes.
  async function server() {
    const { TRANSCRIBE_MIME_TYPES } = await import('@kovalink/protocol');
    const app = Fastify({ bodyLimit: 256 * 1024 });
    for (const mime of TRANSCRIBE_MIME_TYPES) {
      app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: TRANSCRIBE_MAX_BYTES }, (_req, body, done) => done(null, body));
    }
    app.post(ROUTES.transcribe, async (req, reply) => {
      const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (!TRANSCRIBE_MIME_TYPES.includes(mime)) return reply.code(415).send({ code: 'BAD_REQUEST', message: `unsupported audio type: ${mime || 'none'}` });
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length > TRANSCRIBE_MAX_BYTES) return reply.code(413).send({ code: 'BAD_REQUEST' });
      return { bytes: body.length };
    });
    await app.ready();
    return app;
  }

  it('refuse un type non audio (415) sans lire le corps', async () => {
    const app = await server();
    const res = await app.inject({ method: 'POST', url: ROUTES.transcribe, headers: { 'content-type': 'text/plain' }, payload: 'bonjour' });
    assert.equal(res.statusCode, 415);
    assert.match(res.json().message, /unsupported audio type: text\/plain/);
    await app.close();
  });

  it('refuse un fichier au dela de 10 Mo (413) et accepte un m4a ordinaire', async () => {
    const app = await server();
    const big = await app.inject({
      method: 'POST',
      url: ROUTES.transcribe,
      headers: { 'content-type': 'audio/mp4', 'content-length': String(TRANSCRIBE_MAX_BYTES + 1) },
      payload: Buffer.alloc(TRANSCRIBE_MAX_BYTES + 1),
    });
    assert.equal(big.statusCode, 413);
    const ok = await app.inject({ method: 'POST', url: ROUTES.transcribe, headers: { 'content-type': 'audio/mp4' }, payload: AUDIO });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().bytes, AUDIO.length);
    await app.close();
  });
});
