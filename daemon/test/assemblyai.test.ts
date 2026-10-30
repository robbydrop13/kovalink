// Dictee en direct : le jeton AssemblyAI et l'URL WebSocket se construisent sans reseau,
// le glossaire est filtre aux limites d'AssemblyAI, et le chemin par defaut du fichier
// est verifie depuis le module compile (dist/src/voice -> daemon/glossary).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { TranscriptionError } from '../src/voice/whisper.js';
import {
  ASSEMBLYAI_STREAM_URL,
  ASSEMBLYAI_TOKEN_URL,
  glossaryFile,
  loadKeyterms,
  mintStreamToken,
  readAssemblyaiKey,
} from '../src/voice/assemblyai.js';

process.env['KOVALINK_QUIET'] = '1';
process.env['KOVALINK_ASSEMBLYAI_KEY_CMD_DISABLED'] = '1';

type FakeCall = { url: string; init: RequestInit | undefined };

/** Faux AssemblyAI : rend `status` et `body` pour chaque appel, et garde les appels. */
function fakeAssemblyai(status = 200, body: unknown = { token: 'tok-test' }) {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** Un glossaire temporaire, jamais celui du depot. */
function tempGlossary(lines: string[]): string {
  const file = join(mkdtempSync(join(tmpdir(), 'kovalink-keyterms-')), 'keyterms.txt');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

describe('jeton de streaming AssemblyAI', () => {
  it('construit l URL WebSocket avec le jeton, le format, le modele, les langues et le glossaire', async () => {
    const { fetchImpl, calls } = fakeAssemblyai();
    const res = await mintStreamToken({ fetch: fetchImpl, key: 'k-test', keyterms: ['Claap', 'lemlist'], now: () => 1_000 });

    assert.equal(calls.length, 1);
    const tokenCall = new URL(calls[0]?.url ?? '');
    assert.equal(`${tokenCall.protocol}//${tokenCall.host}${tokenCall.pathname}`, ASSEMBLYAI_TOKEN_URL);
    assert.equal(tokenCall.searchParams.get('expires_in_seconds'), '60');
    assert.equal(tokenCall.searchParams.get('max_session_duration_seconds'), '900');
    assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'k-test');

    const ws = new URL(res.wsUrl);
    assert.equal(`${ws.protocol}//${ws.host}${ws.pathname}`, ASSEMBLYAI_STREAM_URL);
    assert.equal(ws.searchParams.get('token'), 'tok-test');
    assert.equal(ws.searchParams.get('sample_rate'), '16000');
    assert.equal(ws.searchParams.get('encoding'), 'pcm_s16le');
    assert.equal(ws.searchParams.get('speech_model'), 'universal-3-6-pro');
    assert.deepEqual(JSON.parse(ws.searchParams.get('language_codes') ?? 'null'), ['fr', 'en']);
    assert.deepEqual(JSON.parse(ws.searchParams.get('keyterms_prompt') ?? 'null'), ['Claap', 'lemlist']);

    assert.equal(res.sampleRate, 16_000);
    assert.equal(res.expiresAt, 61_000);
    assert.equal(res.keyterms, 2);
  });

  it('sans terme : aucun parametre keyterms_prompt', async () => {
    const { fetchImpl } = fakeAssemblyai();
    const res = await mintStreamToken({ fetch: fetchImpl, key: 'k', keyterms: [] });
    assert.equal(new URL(res.wsUrl).searchParams.has('keyterms_prompt'), false);
    assert.equal(res.keyterms, 0);
  });

  it('401 : TRANSCRIPTION_UNAVAILABLE, cle refusee, sans la cle dans le message', async () => {
    const { fetchImpl } = fakeAssemblyai(401, { error: 'invalid api key' });
    await assert.rejects(
      () => mintStreamToken({ fetch: fetchImpl, key: 'k-secret', keyterms: [] }),
      (e: unknown) =>
        e instanceof TranscriptionError &&
        e.code === 'TRANSCRIPTION_UNAVAILABLE' &&
        e.message.includes('AssemblyAI refused the API key on the Mac') &&
        !e.message.includes('k-secret'),
    );
  });

  it('500 : TRANSCRIPTION_FAILED avec le message d AssemblyAI', async () => {
    const { fetchImpl } = fakeAssemblyai(500, { error: 'streaming is down' });
    await assert.rejects(
      () => mintStreamToken({ fetch: fetchImpl, key: 'k', keyterms: [] }),
      (e: unknown) =>
        e instanceof TranscriptionError &&
        e.code === 'TRANSCRIPTION_FAILED' &&
        e.message === 'AssemblyAI token request failed (500: streaming is down)',
    );
  });

  it('reseau et reponse sans jeton : TRANSCRIPTION_FAILED', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await assert.rejects(
      () => mintStreamToken({ fetch: down, key: 'k', keyterms: [] }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_FAILED' && /fetch failed/.test(e.message),
    );
    const { fetchImpl } = fakeAssemblyai(200, { expired: true });
    await assert.rejects(
      () => mintStreamToken({ fetch: fetchImpl, key: 'k', keyterms: [] }),
      (e: unknown) => e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_FAILED' && /no token/.test(e.message),
    );
  });

  it('sans cle : TRANSCRIPTION_UNAVAILABLE sans appeler AssemblyAI', async () => {
    const { fetchImpl, calls } = fakeAssemblyai();
    await assert.rejects(
      () => mintStreamToken({ fetch: fetchImpl, key: null }),
      (e: unknown) =>
        e instanceof TranscriptionError && e.code === 'TRANSCRIPTION_UNAVAILABLE' && /assemblyai-api-key/.test(e.message),
    );
    assert.equal(calls.length, 0, 'rien ne part vers AssemblyAI sans cle');
    assert.equal(readAssemblyaiKey(), null, 'lecture du trousseau desactivee en test');
  });
});

describe('glossaire', () => {
  it('ignore commentaires et lignes vides, coupe a 50 caracteres, deduit sans tenir compte de la casse', () => {
    const file = tempGlossary(['# commentaire', '', 'ClaapAgent', 'claaPagent', 'x'.repeat(51), '  Kova  ', '# fin', 'A']);
    assert.deepEqual(loadKeyterms(file), ['ClaapAgent', 'Kova', 'A']);
  });

  it('garde les 100 premiers termes classes', () => {
    const file = tempGlossary(Array.from({ length: 120 }, (_, i) => `terme${i}`));
    const terms = loadKeyterms(file);
    assert.equal(terms.length, 100);
    assert.equal(terms[0], 'terme0');
    assert.equal(terms[99], 'terme99');
  });

  it('fichier absent : liste vide', () => {
    assert.deepEqual(loadKeyterms(join(tmpdir(), 'kovalink-absent-keyterms.txt')), []);
  });

  it('le chemin par defaut tombe sur daemon/glossary/keyterms.txt depuis le module compile', () => {
    assert.equal(existsSync(glossaryFile()), true, `glossaire introuvable: ${glossaryFile()}`);
    const terms = loadKeyterms();
    assert.ok(terms.includes('ClaapAgent'));
    assert.ok(terms.includes('KovaLink'));
  });
});
