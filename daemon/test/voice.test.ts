// Mode vocal : la route refuse un fichier trop gros et un type non audio, et le client
// Whisper relaie l'erreur mot pour mot. Le faux OpenAI est un `fetch` en memoire.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { ROUTES, TRANSCRIBE_MAX_BYTES } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-voice-'));
process.env['KOVALINK_QUIET'] = '1';
process.env['KOVALINK_OPENAI_KEY_FILE'] = join(process.env['KOVALINK_HOME'], 'openai-key');

const { transcribe, TranscriptionError, OPENAI_TRANSCRIPTIONS_URL } = await import('../src/voice/whisper.js');

type FakeCall = { url: string; init: RequestInit | undefined };

/** Faux OpenAI : rend `status` et `body` pour chaque appel, et garde les appels. */
function fakeOpenai(status = 200, body: unknown = { text: ' Recrée un unique commit ' }) {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const AUDIO = Buffer.from('fake m4a bytes');

describe('client Whisper', () => {
  it('sans cle sur le Mac : TRANSCRIPTION_UNAVAILABLE avec le chemin du fichier a creer', async () => {
    const { fetchImpl, calls } = fakeOpenai();
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_UNAVAILABLE' && /openai-key/.test(e.message),
    );
    assert.equal(calls.length, 0, 'rien ne part vers OpenAI sans cle');
  });

  it('succes : un multipart file + whisper-1 + json, sans langue imposee, rend le texte', async () => {
    const { fetchImpl, calls } = fakeOpenai();
    const res = await transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k-test' });
    assert.deepEqual(res, { text: 'Recrée un unique commit', language: null, durationMs: null });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, OPENAI_TRANSCRIPTIONS_URL);
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['authorization'], 'Bearer k-test');
    const form = calls[0]?.init?.body as FormData;
    assert.equal(form.get('model'), 'whisper-1');
    assert.equal(form.get('response_format'), 'json');
    assert.equal(form.get('language'), null);
    const file = form.get('file') as File;
    assert.equal(file.name, 'voice.m4a');
    assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'fake m4a bytes');
  });

  it('401 : TRANSCRIPTION_UNAVAILABLE avec le message d OpenAI', async () => {
    const { fetchImpl } = fakeOpenai(401, { error: { message: 'Incorrect API key provided' } });
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k' }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_UNAVAILABLE' && e.message === 'Whisper 401: Incorrect API key provided',
    );
  });

  it('5xx et reseau : TRANSCRIPTION_FAILED', async () => {
    const { fetchImpl } = fakeOpenai(503, { error: { message: 'The server is overloaded' } });
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k' }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_FAILED' && e.message === 'Whisper 503: The server is overloaded',
    );
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: down, key: 'k' }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_FAILED' && /fetch failed/.test(e.message),
    );
  });

  it('lit la cle dans le fichier du Mac', async () => {
    writeFileSync(process.env['KOVALINK_OPENAI_KEY_FILE'] as string, 'k-from-file\n', { mode: 0o600 });
    const { fetchImpl, calls } = fakeOpenai();
    await transcribe(AUDIO, 'audio/wav', 'voice.wav', { fetch: fetchImpl });
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['authorization'], 'Bearer k-from-file');
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
