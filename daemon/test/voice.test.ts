// Mode vocal : la route refuse un fichier trop gros et un type non audio, le client
// Whisper normalise l'audio en wav avant l'envoi et rend une raison claire en cas d'echec.
// Le faux OpenAI est un `fetch` en memoire, la conversion est simulee.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { ROUTES, TRANSCRIBE_MAX_BYTES } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-voice-'));
process.env['KOVALINK_QUIET'] = '1';
process.env['KOVALINK_OPENAI_KEY_FILE'] = join(process.env['KOVALINK_HOME'], 'openai-key');

const { transcribe, afconvertToWav, TranscriptionError, OPENAI_TRANSCRIPTIONS_URL } = await import('../src/voice/whisper.js');

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
const WAV = Buffer.from('fake wav bytes');

/** Fausse conversion : rend `WAV` et garde les appels. */
function fakeConvert() {
  const calls: Array<{ bytes: string; ext: string }> = [];
  const convert = async (audio: Buffer, ext: string) => {
    calls.push({ bytes: audio.toString(), ext });
    return WAV;
  };
  return { convert, calls };
}
const failingConvert = async () => {
  throw new Error('afconvert: Couldn\'t open input file');
};

async function sentFile(call: FakeCall | undefined): Promise<{ name: string; type: string; bytes: string }> {
  const file = (call?.init?.body as FormData).get('file') as File;
  return { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()).toString() };
}

describe('client Whisper', () => {
  it('sans cle sur le Mac : TRANSCRIPTION_UNAVAILABLE avec le chemin du fichier a creer', async () => {
    const { fetchImpl, calls } = fakeOpenai();
    const conv = fakeConvert();
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, convert: conv.convert }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_UNAVAILABLE' && /openai-key/.test(e.message),
    );
    assert.equal(calls.length, 0, 'rien ne part vers OpenAI sans cle');
    assert.equal(conv.calls.length, 0, 'aucune conversion sans cle');
  });

  it('succes : convertit en wav, envoie un multipart file + whisper-1 + json sans langue, rend le texte', async () => {
    const { fetchImpl, calls } = fakeOpenai();
    const conv = fakeConvert();
    const res = await transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k-test', convert: conv.convert });
    assert.deepEqual(res, { text: 'Recrée un unique commit', language: null, durationMs: null });
    assert.deepEqual(conv.calls, [{ bytes: 'fake m4a bytes', ext: 'm4a' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, OPENAI_TRANSCRIPTIONS_URL);
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['authorization'], 'Bearer k-test');
    const form = calls[0]?.init?.body as FormData;
    assert.equal(form.get('model'), 'whisper-1');
    assert.equal(form.get('response_format'), 'json');
    assert.equal(form.get('language'), null);
    assert.deepEqual(await sentFile(calls[0]), { name: 'voice.wav', type: 'audio/wav', bytes: 'fake wav bytes' });
  });

  it('conversion impossible : le fichier d origine part tel quel', async () => {
    const { fetchImpl, calls } = fakeOpenai();
    const res = await transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k', convert: failingConvert });
    assert.equal(res.text, 'Recrée un unique commit');
    assert.deepEqual(await sentFile(calls[0]), { name: 'voice.m4a', type: 'audio/mp4', bytes: 'fake m4a bytes' });
  });

  it('400 audio indecodable : raison claire, code TRANSCRIPTION_FAILED', async () => {
    const { fetchImpl } = fakeOpenai(400, {
      error: { message: 'The audio file could not be decoded or its format is not supported.', type: 'invalid_request_error', code: null },
    });
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k', convert: failingConvert }),
      (e: unknown) =>
        e instanceof TranscriptionError &&
        e.code === 'TRANSCRIPTION_FAILED' &&
        e.message.startsWith('The recording could not be decoded (incomplete or unsupported audio file)') &&
        /Whisper 400: The audio file could not be decoded/.test(e.message),
    );
  });

  it('401 : TRANSCRIPTION_UNAVAILABLE, cle refusee, sans fragment de cle', async () => {
    const { fetchImpl } = fakeOpenai(401, { error: { message: 'Incorrect API key provided: sk-proj-****abcd.', code: 'invalid_api_key' } });
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k', convert: fakeConvert().convert }),
      (e: unknown) =>
        e instanceof TranscriptionError &&
        e.code === 'TRANSCRIPTION_UNAVAILABLE' &&
        e.message.startsWith('OpenAI refused the API key on the Mac') &&
        !/abcd/.test(e.message),
    );
  });

  it('429 insufficient_quota : plus de credits, code TRANSCRIPTION_FAILED', async () => {
    const { fetchImpl } = fakeOpenai(429, {
      error: { message: 'You exceeded your current quota, please check your plan and billing details.', code: 'insufficient_quota' },
    });
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k', convert: fakeConvert().convert }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_FAILED' && e.message.startsWith('OpenAI account has no credits left'),
    );
  });

  it('5xx et reseau : TRANSCRIPTION_FAILED', async () => {
    const { fetchImpl } = fakeOpenai(503, { error: { message: 'The server is overloaded' } });
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: fetchImpl, key: 'k', convert: fakeConvert().convert }),
      (e: unknown) =>
        e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_FAILED' && e.message === 'OpenAI is unavailable right now, try again (Whisper 503: The server is overloaded)',
    );
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await assert.rejects(
      () => transcribe(AUDIO, 'audio/mp4', 'voice.m4a', { fetch: down, key: 'k', convert: fakeConvert().convert }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_FAILED' && /fetch failed/.test(e.message),
    );
  });

  it('lit la cle dans le fichier du Mac', async () => {
    writeFileSync(process.env['KOVALINK_OPENAI_KEY_FILE'] as string, 'k-from-file\n', { mode: 0o600 });
    const { fetchImpl, calls } = fakeOpenai();
    await transcribe(AUDIO, 'audio/wav', 'voice.wav', { fetch: fetchImpl, convert: fakeConvert().convert });
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['authorization'], 'Bearer k-from-file');
  });
});

describe('conversion afconvert', () => {
  // Un faux `afconvert` : recopie le mode du fichier d'entree dans la sortie, ou echoue.
  function fakeBin(script: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'kovalink-fakebin-'));
    const bin = join(dir, 'afconvert');
    writeFileSync(bin, `#!/bin/sh\n${script}\n`);
    chmodSync(bin, 0o700);
    return bin;
  }

  it('fichier temporaire en 0600, arguments wav 16 kHz mono, dossier efface apres succes', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'kovalink-tmproot-'));
    const bin = fakeBin('printf "%s %s %s %s %s %s " "$1" "$2" "$3" "$4" "$5" "$6" > "$8"; stat -f %Lp "$7" >> "$8"');
    const out = await afconvertToWav(AUDIO, 'm4a', { bin, tmpRoot });
    assert.equal(out.toString().trim(), '-f WAVE -d LEI16@16000 -c 1 600');
    assert.deepEqual(readdirSync(tmpRoot), []);
  });

  it('echec : erreur lisible et dossier efface quand meme', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'kovalink-tmproot-'));
    const bin = fakeBin('echo "Error: Couldn\'t open input file" >&2; exit 1');
    await assert.rejects(() => afconvertToWav(AUDIO, 'm4a', { bin, tmpRoot }), /afconvert: Error: Couldn't open input file/);
    assert.deepEqual(readdirSync(tmpRoot), []);
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
