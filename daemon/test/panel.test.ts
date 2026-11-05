// Le panneau lateral sur le telephone : l'historique de Kova (lu, jamais ecrit) et les
// fiches de decisions natives (`get-sheet`, `answer-sheet`).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { ROUTES } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-panel-'));
process.env['KOVALINK_QUIET'] = '1';

const { mapPanelEntry, readPanelHistory } = await import('../src/kova/panelHistory.js');
const { AskBoard, AskError, checkSheetAnswers, mapAsk, mapSheet } = await import('../src/kova/asks.js');
const { IpcError } = await import('../src/kova/ipc.js');
const { registerPanelRoutes } = await import('../src/server/panelRoutes.js');
const { NonceStore } = await import('../src/server/services.js');
import type { Services } from '../src/server/services.js';

const ASK_ID = '6f1c0000-0000-4000-8000-000000000001';

const SHEET = {
  title: 'Launch plan',
  intro: 'Two calls',
  decisions: [
    { id: 'D1', title: 'When', options: [{ id: 'A', label: 'Now', reco: true }, { id: 'B', label: 'Later' }] },
    { id: 'D2', title: 'Who', options: [{ id: 'A', label: 'Me' }] },
  ],
};

/** Une question de fiche telle que `list-asks` la rend. */
const rawAsk = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ASK_ID,
  from: 'planner',
  message: 'Launch plan',
  buttons: ['Done'],
  input: true,
  asked_at: 1_792_000_000,
  snoozed_until: 0,
  due: true,
  waiting: true,
  session_id: null,
  cwd: '/Users/robin/p',
  kind: 'decision',
  url: null,
  sheet: true,
  decisions: 2,
  answered: 0,
  follow_up: false,
  ...over,
});

type Reply = { ok: boolean; data?: unknown; error?: string };

/** Un Kova de papier : la carte, puis la file de reponses donnee, et les requetes recues. */
function fakeIpc(replies: Reply[]) {
  const seen: Record<string, unknown>[] = [];
  return {
    seen,
    ipc: {
      request: async (payload: Record<string, unknown>) => {
        seen.push(payload);
        if (payload['cmd'] === 'list-asks') return { ok: true, data: { asks: [rawAsk()] } };
        const next = replies.shift();
        if (!next) throw new IpcError('IPC_TIMEOUT', 'no reply left');
        return next;
      },
    } as never,
  };
}

async function board(replies: Reply[]) {
  const fake = fakeIpc(replies);
  const b = new AskBoard(fake.ipc);
  await b.refresh();
  return { board: b, seen: fake.seen };
}

describe('historique du panneau de Kova', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kovalink-panel-history-'));

  it('traduit le fichier de Kova, secondes vers millisecondes, dans son ordre', () => {
    const file = join(dir, 'ok.json');
    writeFileSync(
      file,
      JSON.stringify([
        { kind: 'web', target: 'https://claude.ai/artifact/x', title: 'Plan', opened_at: 1_792_000_100 },
        { kind: 'markdown', target: '/Users/robin/notes.md', title: '', opened_at: 1_792_000_000 },
        { kind: 'sheet', target: ASK_ID, title: 'Sheet' },
      ]),
    );
    assert.deepEqual(readPanelHistory(file), [
      { kind: 'web', target: 'https://claude.ai/artifact/x', title: 'Plan', openedAtMs: 1_792_000_100_000 },
      { kind: 'markdown', target: '/Users/robin/notes.md', title: '', openedAtMs: 1_792_000_000_000 },
      { kind: 'sheet', target: ASK_ID, title: 'Sheet', openedAtMs: 0 },
    ]);
  });

  it('ecarte ce que le panneau n ouvrirait pas : autre schema, chemin relatif, id libre', () => {
    assert.equal(mapPanelEntry({ kind: 'web', target: 'file:///etc/passwd' }), null);
    assert.equal(mapPanelEntry({ kind: 'web', target: 'javascript:alert(1)' }), null);
    assert.equal(mapPanelEntry({ kind: 'html', target: 'notes/a.html' }), null);
    assert.equal(mapPanelEntry({ kind: 'sheet', target: '../../x' }), null);
    assert.equal(mapPanelEntry({ kind: 'history', target: 'x' }), null);
    assert.equal(mapPanelEntry('nope'), null);
  });

  it('fichier absent, tronque ou d une autre forme : une liste vide, jamais une erreur', () => {
    assert.deepEqual(readPanelHistory(join(dir, 'absent.json')), []);
    const cut = join(dir, 'cut.json');
    writeFileSync(cut, '[{"kind":"web","tar');
    assert.deepEqual(readPanelHistory(cut), []);
    const obj = join(dir, 'obj.json');
    writeFileSync(obj, '{"entries":[]}');
    assert.deepEqual(readPanelHistory(obj), []);
  });

  it('borne a 50 entrees', () => {
    const file = join(dir, 'many.json');
    const many = Array.from({ length: 70 }, (_, i) => ({ kind: 'web', target: `https://a.com/${i}`, title: '', opened_at: i }));
    writeFileSync(file, JSON.stringify(many));
    assert.equal(readPanelHistory(file).length, 50);
  });
});

describe('questions de fiche : traduction', () => {
  it('porte kind, url et sheet, et refuse une url hors http(s)', () => {
    const ask = mapAsk(rawAsk({ url: 'https://claude.ai/artifact/x' }));
    assert.equal(ask?.kind, 'decision');
    assert.equal(ask?.url, 'https://claude.ai/artifact/x');
    assert.equal(ask?.sheet, true);
    assert.equal(mapAsk(rawAsk({ url: 'file:///etc/hosts' }))?.url, null);
    const plain = mapAsk(rawAsk({ kind: undefined, url: undefined, sheet: undefined }));
    assert.equal(plain?.kind, null);
    assert.equal(plain?.sheet, false);
  });

  it('traduit get-sheet : enveloppe en camelCase, fiche et brouillon tels quels', () => {
    const out = mapSheet({
      id: ASK_ID,
      from: 'planner',
      message: 'm',
      asked_at: 1_792_000_000,
      follow_up: true,
      sheet: SHEET,
      draft: { decisions: [{ id: 'D1', choice: 'A' }], note: 'n' },
    });
    assert.equal(out?.askedAtMs, 1_792_000_000_000);
    assert.equal(out?.followUp, true);
    assert.equal(out?.sheet.decisions.length, 2);
    assert.deepEqual(out?.draft, { decisions: [{ id: 'D1', choice: 'A' }], note: 'n' });
    assert.deepEqual(mapSheet({ id: ASK_ID, sheet: SHEET })?.draft, { decisions: [] });
    assert.equal(mapSheet({ id: ASK_ID, sheet: { title: 'x' } }), null);
    assert.equal(mapSheet({ id: ASK_ID, sheet: { title: 'x', decisions: [{ id: 'D1', title: 't' }] } }), null);
    assert.equal(mapSheet({ id: ASK_ID, sheet: { title: 'x', decisions: [null] } }), null);
  });

  it('garde les images bien formees d une option et retire les autres, pas la fiche', () => {
    const out = mapSheet({
      id: ASK_ID,
      sheet: {
        title: 'UI',
        decisions: [
          {
            id: 'D1',
            title: 't',
            options: [
              {
                id: 'A',
                label: 'a',
                images: [{ label: 'Before', path: '/tmp/b.png' }, { path: '/tmp/a.png' }, { label: 'x' }, null, 'p.png'],
              },
              { id: 'B', label: 'b', images: 'nope' },
              { id: 'C', label: 'c' },
            ],
          },
        ],
      },
    });
    const options = out?.sheet.decisions[0]?.options;
    assert.deepEqual(options?.[0]?.images, [
      { label: 'Before', path: '/tmp/b.png' },
      { label: '', path: '/tmp/a.png' },
    ]);
    assert.deepEqual(options?.[1]?.images, []);
    assert.equal(options?.[2]?.images, undefined);
  });

  it('verifie la forme des reponses, pas leur contenu (Kova le fait)', () => {
    const checked = checkSheetAnswers({ decisions: { D1: { choice: 'A', note: 'n' } }, note: 'g' });
    assert.deepEqual(JSON.parse(JSON.stringify(checked)), { decisions: { D1: { choice: 'A', note: 'n' } }, note: 'g' });
    assert.deepEqual({ ...checkSheetAnswers({}).decisions }, {});
    assert.equal(
      JSON.stringify(checkSheetAnswers(JSON.parse('{"decisions":{"__proto__":{"choice":"A"}}}'))),
      '{"decisions":{"__proto__":{"choice":"A"}}}',
    );
    assert.throws(() => checkSheetAnswers([]), AskError);
    assert.throws(() => checkSheetAnswers({ decisions: [{ id: 'D1' }] }), AskError);
    assert.throws(() => checkSheetAnswers({ decisions: { D1: { choice: 3 } } }), AskError);
    assert.throws(() => checkSheetAnswers({ note: 'x'.repeat(8001) }), AskError);
  });
});

describe('questions de fiche : le tableau', () => {
  it('lit la fiche par get-sheet', async () => {
    const { board: b, seen } = await board([{ ok: true, data: { id: ASK_ID, sheet: SHEET, draft: {} } }]);
    const out = await b.sheet(ASK_ID);
    assert.equal(out.sheet.title, 'Launch plan');
    assert.deepEqual(seen.at(-1), { cmd: 'get-sheet', id: ASK_ID });
  });

  it('envoie answer-sheet avec l etat entier et rend la reponse de Kova', async () => {
    const { board: b, seen } = await board([
      { ok: true, data: { title: 'Launch plan', summary: 'D1: A (Now)', answered: 1, total: 2, done: true, follow_up: 'f-1' } },
    ]);
    const answers = { decisions: { D1: { choice: 'A' } }, note: '' };
    const out = await b.answerSheet(ASK_ID, answers, true);
    assert.deepEqual(out, { title: 'Launch plan', summary: 'D1: A (Now)', answered: 1, total: 2, done: true, followUp: 'f-1' });
    assert.equal(
      JSON.stringify(seen.find((s) => s['cmd'] === 'answer-sheet')),
      JSON.stringify({ cmd: 'answer-sheet', id: ASK_ID, answers, done: true }),
    );
  });

  it('un Kova anterieur a answer-sheet : KOVA_TOO_OLD', async () => {
    const { board: b } = await board([{ ok: false, error: 'unknown command: answer-sheet' }]);
    await assert.rejects(b.answerSheet(ASK_ID, { decisions: {} }, false), (e: unknown) => e instanceof AskError && e.code === 'KOVA_TOO_OLD');
  });

  it('une fiche deja rendue ailleurs : ASK_NOT_FOUND', async () => {
    const { board: b } = await board([{ ok: false, error: `no decision sheet ${ASK_ID} waiting` }]);
    await assert.rejects(b.answerSheet(ASK_ID, { decisions: {} }, true), (e: unknown) => e instanceof AskError && e.code === 'ASK_NOT_FOUND');
  });

  it('une question inconnue ne part jamais a Kova', async () => {
    const { board: b, seen } = await board([]);
    await assert.rejects(b.sheet('autre'), (e: unknown) => e instanceof AskError && e.code === 'ASK_NOT_FOUND');
    assert.equal(seen.some((s) => s['cmd'] === 'get-sheet'), false);
  });
});

describe('routes du panneau', () => {
  async function server(replies: Reply[]) {
    const { board: b, seen } = await board(replies);
    const services = {
      asks: b,
      rate: { allow: () => true },
      nonces: new NonceStore(),
    } as unknown as Services;
    const app = Fastify();
    registerPanelRoutes(app, services);
    await app.ready();
    return { app, seen };
  }

  it('GET panel-history sert le fichier de Kova sans l ecrire', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kovalink-panel-route-')), 'panel-history.json');
    const body = JSON.stringify([{ kind: 'html', target: '/Users/robin/a.html', title: 'A', opened_at: 10 }]);
    writeFileSync(file, body);
    process.env['KOVALINK_KOVA_PANEL_HISTORY'] = file;
    const { app } = await server([]);
    const res = await app.inject({ method: 'GET', url: ROUTES.kovaPanelHistory });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { entries: [{ kind: 'html', target: '/Users/robin/a.html', title: 'A', openedAtMs: 10_000 }] });
    assert.equal(readFileSync(file, 'utf8'), body);
    delete process.env['KOVALINK_KOVA_PANEL_HISTORY'];
    await app.close();
  });

  it('GET sheet rend la fiche, 501 sur un Kova trop ancien', async () => {
    const ok = await server([{ ok: true, data: { id: ASK_ID, sheet: SHEET, draft: {} } }]);
    const res = await ok.app.inject({ method: 'GET', url: ROUTES.askSheet(ASK_ID) });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { sheet: { title: string } }).sheet.title, 'Launch plan');
    await ok.app.close();

    const old = await server([{ ok: false, error: 'unknown command: get-sheet' }]);
    const res2 = await old.app.inject({ method: 'GET', url: ROUTES.askSheet(ASK_ID) });
    assert.equal(res2.statusCode, 501);
    assert.equal((res2.json() as { code: string }).code, 'KOVA_TOO_OLD');
    await old.app.close();
  });

  it('POST sheet : brouillon puis Done, nonce rejoue refuse, corps invalide 400', async () => {
    const { app, seen } = await server([
      { ok: true, data: { title: 't', summary: '', answered: 1, total: 2, done: false, follow_up: null } },
      { ok: true, data: { title: 't', summary: 's', answered: 2, total: 2, done: true, follow_up: null } },
    ]);
    const answers = { decisions: { D1: { choice: 'A' }, D2: { note: 'x' } } };
    const draft = await app.inject({ method: 'POST', url: ROUTES.askSheet(ASK_ID), payload: { answers, done: false } });
    assert.equal(draft.statusCode, 200);
    assert.equal((draft.json() as { done: boolean }).done, false);
    const done = await app.inject({ method: 'POST', url: ROUTES.askSheet(ASK_ID), payload: { answers, done: true, nonce: 'n1' } });
    assert.equal(done.statusCode, 200);
    assert.equal((done.json() as { done: boolean }).done, true);
    assert.deepEqual(
      seen.filter((s) => s['cmd'] === 'answer-sheet').map((s) => s['done']),
      [false, true],
    );
    const again = await app.inject({ method: 'POST', url: ROUTES.askSheet(ASK_ID), payload: { answers, done: true, nonce: 'n1' } });
    assert.equal(again.statusCode, 409);
    const bad = await app.inject({ method: 'POST', url: ROUTES.askSheet(ASK_ID), payload: { answers: { decisions: [] }, done: true } });
    assert.equal(bad.statusCode, 400);
    await app.close();
  });
});
