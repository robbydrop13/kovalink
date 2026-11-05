// File d'attention : `attn list --open --json` est la seule source, et un geste de
// l'app devient un argv construit ici depuis une liste fermee de boutons. Ces tests fixent
// la lecture (champs gardes, entree mal formee ignoree), le refus SANS lancer `attn`, et
// l'argv exact de chaque geste, a travers les vraies routes.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { ATTENTION_TEXT_MAX, ROUTES, type AttentionResponse } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-attention-'));
process.env['KOVALINK_QUIET'] = '1';

const { AttentionBoard, AttentionError, attnPath, parseAttention, toAttentionEntry } = await import(
  '../src/attention.js'
);
const { registerAttentionRoutes } = await import('../src/server/attentionRoutes.js');
const { NonceStore } = await import('../src/server/services.js');
const { RateLimiter } = await import('../src/server/rate.js');
const { needInputOf, waitsOnYouOf } = await import('../src/needs.js');
import type { Exec, ExecResult } from '../src/routines.js';

/** Ce que `attn list --open --json` ecrit, champs en plus compris (`op`, `updated`). */
const RAW = [
  {
    op: 'add',
    id: 'a-36d0b2',
    ts: '2026-11-05T16:22:48+01:00',
    from: 'claap-agent',
    level: 'now',
    kind: 'decision',
    title: 'Training, CLA-10113',
    topic: 'training',
    needs: 'Relire les 5 choix',
    action: 'https://linear.app/claap/issue/CLA-10113',
    src: ['linear:CLA-10113'],
    body: 'Le corps',
    updated: '2026-11-05T17:00:00+01:00',
  },
  {
    op: 'add',
    id: 'a-2555da',
    ts: '2026-11-05T16:20:00+01:00',
    from: 'claap-agent',
    level: 'point',
    kind: 'would',
    title: 'Relancer Francisco',
  },
];

/** Faux `attn` : enregistre les argv, rend `list` puis les reponses forcees. */
function fake(
  raw: unknown = RAW,
  forced: (argv: string[]) => ExecResult | undefined = () => undefined,
): { calls: string[][]; exec: Exec } {
  const calls: string[][] = [];
  const exec: Exec = async (argv) => {
    calls.push(argv);
    const answer = forced(argv);
    if (answer) return answer;
    if (argv[0] === 'list') return { code: 0, stdout: JSON.stringify(raw), stderr: '' };
    return { code: 0, stdout: 'remis\n', stderr: '' };
  };
  return { calls, exec };
}

describe('attention : lecture', () => {
  it('garde les champs du contrat et rien d autre', () => {
    const [first, second] = parseAttention(JSON.stringify(RAW));
    assert.deepEqual(first, {
      id: 'a-36d0b2',
      ts: '2026-11-05T16:22:48+01:00',
      from: 'claap-agent',
      level: 'now',
      kind: 'decision',
      title: 'Training, CLA-10113',
      needs: 'Relire les 5 choix',
      action: 'https://linear.app/claap/issue/CLA-10113',
      topic: 'training',
      body: 'Le corps',
      src: ['linear:CLA-10113'],
    });
    // Les optionnels absents sont absents, pas `undefined` ni vides.
    assert.deepEqual(Object.keys(second ?? {}).sort(), ['from', 'id', 'kind', 'level', 'title', 'ts']);
  });

  it('ignore une entree mal formee, garde les autres', () => {
    const rows = [
      RAW[0],
      null,
      'a-123456',
      { ...RAW[1], id: 'a-XYZ' },
      { ...RAW[1], id: 'a-1234567' },
      { ...RAW[1], level: 'later' },
      { ...RAW[1], ts: 'hier' },
      { ...RAW[1], title: '' },
      RAW[1],
    ];
    assert.deepEqual(
      parseAttention(JSON.stringify(rows)).map((e) => e.id),
      ['a-36d0b2', 'a-2555da'],
    );
  });

  it('un genre inconnu reste lisible, un src mal forme est filtre', () => {
    const entry = toAttentionEntry({ ...RAW[1], kind: 'nouveau', src: ['pr:1', 3, ''] });
    assert.equal(entry?.kind, 'nouveau');
    assert.deepEqual(entry?.src, ['pr:1']);
  });

  it('une sortie qui n est pas un tableau JSON est une erreur, pas une file vide', () => {
    assert.throws(() => parseAttention('nope'), AttentionError);
    assert.throws(() => parseAttention('{"entries":[]}'), AttentionError);
  });

  it('le chemin du CLI se surcharge par KOVALINK_ATTN', () => {
    const before = process.env['KOVALINK_ATTN'];
    process.env['KOVALINK_ATTN'] = '/opt/attn';
    assert.equal(attnPath(), '/opt/attn');
    delete process.env['KOVALINK_ATTN'];
    assert.match(attnPath(), /\/\.local\/bin\/attn$/);
    if (before !== undefined) process.env['KOVALINK_ATTN'] = before;
  });
});

describe('attention : cache', () => {
  it('une lecture sert 10 s, un seul attn list en vol, invalidate relance', async () => {
    let now = 1_000_000;
    const h = fake();
    const board = new AttentionBoard(h.exec, () => now);
    await Promise.all([board.list(), board.list()]);
    assert.equal(h.calls.length, 1);
    now += 9_000;
    await board.list();
    assert.equal(h.calls.length, 1);
    now += 1_000;
    await board.list();
    assert.equal(h.calls.length, 2);
    board.invalidate();
    await board.list();
    assert.equal(h.calls.length, 3);
    assert.deepEqual(h.calls[0], ['list', '--open', '--json']);
  });

  it('une lecture partie avant invalidate ne fixe pas le cache et n est pas reprise', async () => {
    let release: (v: ExecResult) => void = () => undefined;
    const calls: string[][] = [];
    let slow = true;
    const exec: Exec = (argv) => {
      calls.push(argv);
      if (slow) {
        slow = false;
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve({ code: 0, stdout: JSON.stringify([RAW[0]]), stderr: '' });
    };
    const board = new AttentionBoard(exec);
    const old = board.list();
    board.invalidate();
    // Un appelant venu apres l'invalidation ne partage pas la lecture d'avant.
    const neuf = await board.list();
    assert.deepEqual(neuf.map((e) => e.id), ['a-36d0b2']);
    release({ code: 0, stdout: JSON.stringify(RAW), stderr: '' });
    assert.equal((await old).length, 2);
    // La vieille lecture, arrivee en dernier, n'a ecrase ni la liste ni son heure.
    assert.deepEqual(board.snapshot().map((e) => e.id), ['a-36d0b2']);
    await board.list();
    assert.equal(calls.length, 2, 'la lecture neuve sert encore depuis le cache');
  });

  it('le blocage du renvoi tombe apres 10 min', async () => {
    let now = 1_000_000;
    const h = fake();
    const board = new AttentionBoard(h.exec, () => now);
    await board.act('a-2555da', 'Envoyer', undefined);
    await assert.rejects(board.act('a-2555da', 'Envoyer', undefined), (e: unknown) => e instanceof AttentionError && e.reason === 'already_sent');
    now += 10 * 60_000;
    await board.act('a-2555da', 'Envoyer', undefined);
    assert.equal(h.calls.filter((argv) => argv[0] === 'act').length, 2);
  });

  it('un echec garde la derniere lecture', async () => {
    let fail = false;
    const h = fake(RAW, (argv) => (fail && argv[0] === 'list' ? { code: 1, stdout: '', stderr: 'boom' } : undefined));
    const board = new AttentionBoard(h.exec);
    await board.list();
    fail = true;
    board.invalidate();
    await assert.rejects(board.list(), AttentionError);
    assert.equal(board.snapshot().length, 2);
  });
});

describe('attention : waitsOnYou', () => {
  it('seules les entrees now comptent, datees par leur ts', () => {
    const entries = parseAttention(JSON.stringify(RAW));
    const input = needInputOf([], [], Date.parse('2026-11-05T18:00:00+01:00'), entries);
    assert.deepEqual(input.attention, [
      { id: 'a-36d0b2', since: Date.parse(RAW[0]!.ts) / 1000, level: 'now', title: 'Training, CLA-10113' },
      { id: 'a-2555da', since: Date.parse(RAW[1]!.ts) / 1000, level: 'point', title: 'Relancer Francisco' },
    ]);
    assert.equal(waitsOnYouOf([], [], Date.now(), entries), 1);
    assert.equal(waitsOnYouOf([], [], Date.now()), 0);
  });
});

describe('attention : routes', () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof fake>;
  let refreshed: string[];
  let boardRef: InstanceType<typeof AttentionBoard>;

  before(async () => {
    app = Fastify();
    app.addHook('onRequest', (req, _reply, done) => {
      req.deviceId = 'iphone-test';
      done();
    });
    // Chaque test a son executeur et son tableau (le blocage du renvoi vit dans le
    // tableau) : les routes passent par ce relais, monte une seule fois.
    const relay = {
      list: () => boardRef.list(),
      act: (id: unknown, button: unknown, text: unknown) => boardRef.act(id, button, text),
    } as unknown as InstanceType<typeof AttentionBoard>;
    registerAttentionRoutes(
      app,
      {
        rate: new RateLimiter(),
        nonces: new NonceStore(),
        refreshAttention: async (reason) => {
          refreshed.push(reason);
          boardRef.invalidate();
        },
      },
      relay,
    );
    await app.ready();
  });
  after(async () => {
    await app.close();
  });
  beforeEach(() => {
    h = fake();
    refreshed = [];
    boardRef = new AttentionBoard((argv) => h.exec(argv));
  });

  const act = (id: string, body: unknown) =>
    app.inject({ method: 'POST', url: ROUTES.attentionAct(id), payload: body as Record<string, unknown> });

  it('GET rend les entrees ouvertes', async () => {
    const res = await app.inject({ method: 'GET', url: ROUTES.attention });
    assert.equal(res.statusCode, 200);
    const body = res.json() as AttentionResponse;
    assert.deepEqual(
      body.entries.map((e) => e.id),
      ['a-36d0b2', 'a-2555da'],
    );
    assert.equal('op' in (body.entries[0] ?? {}), false);
  });

  it('GET : attn en echec vaut 502 sans sa sortie', async () => {
    h = fake(RAW, () => ({ code: 2, stdout: '', stderr: '/Users/robin/secret: boom' }));
    const res = await app.inject({ method: 'GET', url: ROUTES.attention });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().code, 'ATTENTION_ERROR');
    assert.equal(res.body.includes('secret'), false);
  });

  it('Envoyer : attn act <id> Envoyer, puis relecture', async () => {
    const res = await act('a-2555da', { button: 'Envoyer' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { applied: true, op: 'act' });
    assert.deepEqual(h.calls, [
      ['list', '--open', '--json'],
      ['act', 'a-2555da', 'Envoyer'],
    ]);
    assert.deepEqual(refreshed, ['act']);
  });

  it('Envoyer avec un texte : un seul element, meme s il commence par un tiret', async () => {
    const res = await act('a-2555da', { button: 'Envoyer', text: '  --by robin; rm -rf ~\nligne 2  ' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(h.calls[1], ['act', 'a-2555da', 'Envoyer', '--text=--by robin; rm -rf ~\nligne 2']);
  });

  it('Fait et Ignorer : attn close avec la note fixe, par robin', async () => {
    assert.equal((await act('a-36d0b2', { button: 'Fait' })).statusCode, 200);
    assert.deepEqual(h.calls[1], ['close', 'a-36d0b2', '--note', 'Fait (KovaLink)', '--by', 'robin']);
    h = fake();
    const res = await act('a-2555da', { button: 'Ignorer' });
    assert.deepEqual(res.json(), { applied: true, op: 'close' });
    assert.deepEqual(h.calls[1], ['close', 'a-2555da', '--note', 'Ignore (KovaLink)', '--by', 'robin']);
  });

  const rejected: [string, string, unknown][] = [
    ['identifiant hors format', 'a-36d0b', { button: 'Fait' }],
    ['identifiant en majuscules', 'a-36D0B2', { button: 'Fait' }],
    ['identifiant avec un point-virgule', 'a-36d0b2;ls', { button: 'Fait' }],
    ['identifiant avec un tiret de tete', '--help', { button: 'Fait' }],
    ['identifiant avec un dollar', '$(id)', { button: 'Fait' }],
    ['bouton inconnu', 'a-36d0b2', { button: 'Supprimer' }],
    ['bouton a la mauvaise casse', 'a-36d0b2', { button: 'envoyer' }],
    ['bouton avec metacaracteres', 'a-36d0b2', { button: 'Envoyer; rm -rf ~' }],
    ['bouton absent', 'a-36d0b2', {}],
    ['bouton non textuel', 'a-36d0b2', { button: 3 }],
    ['Ouvrir reste sur le telephone', 'a-36d0b2', { button: 'Ouvrir' }],
    ['texte sur Fait', 'a-36d0b2', { button: 'Fait', text: 'note' }],
    ['texte non textuel', 'a-36d0b2', { button: 'Envoyer', text: 42 }],
    ['texte trop long', 'a-36d0b2', { button: 'Envoyer', text: 'x'.repeat(ATTENTION_TEXT_MAX + 1) }],
    ['texte avec un echappement', 'a-2555da', { button: 'Envoyer', text: 'ok\x1b[2J' }],
    ['texte avec un retour chariot', 'a-2555da', { button: 'Envoyer', text: 'ok\rrm -rf ~' }],
    ['texte avec un nul', 'a-2555da', { button: 'Envoyer', text: 'ok\x00' }],
    ['texte avec DEL', 'a-2555da', { button: 'Envoyer', text: 'ok\x7f' }],
  ];
  for (const [name, id, body] of rejected) {
    it(`400 sans lancer attn : ${name}`, async () => {
      const res = await act(id, body);
      assert.equal(res.statusCode, 400, res.body);
      assert.equal(res.json().code, 'BAD_REQUEST');
      assert.deepEqual(h.calls, [], 'aucun argv ne doit partir');
    });
  }

  const misfit: [string, string, string][] = [
    ['Envoyer sur une decision', 'a-36d0b2', 'Envoyer'],
    ['Ignorer sur une decision', 'a-36d0b2', 'Ignorer'],
    ['Fait sur un would', 'a-2555da', 'Fait'],
  ];
  for (const [name, id, button] of misfit) {
    it(`400 sans geste quand le bouton ne va pas au genre : ${name}`, async () => {
      const res = await act(id, { button });
      assert.equal(res.statusCode, 400, res.body);
      assert.deepEqual(h.calls, [['list', '--open', '--json']], 'seule la relecture part');
    });
  }

  it('relit la file avant d agir : une entree fermee depuis la derniere lecture ne recoit rien', async () => {
    // Le cache la voit ouverte...
    assert.equal((await app.inject({ method: 'GET', url: ROUTES.attention })).statusCode, 200);
    // ...puis elle est fermee sur le Mac.
    h = fake([RAW[0]]);
    const res = await act('a-2555da', { button: 'Envoyer' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(h.calls, [['list', '--open', '--json']]);
  });

  it('un second Envoyer sur la meme entree est refuse 10 min, meme avec un autre nonce', async () => {
    assert.equal((await act('a-2555da', { button: 'Envoyer', nonce: 'n-a' })).statusCode, 200);
    h = fake();
    const again = await act('a-2555da', { button: 'Envoyer', nonce: 'n-b' });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().code, 'ATTENTION_ALREADY_SENT');
    assert.deepEqual(h.calls, []);
    // Ignorer reste possible : fermer n'envoie rien au chief.
    assert.equal((await act('a-2555da', { button: 'Ignorer' })).statusCode, 200);
  });

  it('404 pour une entree qui n est plus ouverte, sans geste', async () => {
    const res = await act('a-abcdef', { button: 'Fait' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().code, 'ATTENTION_NOT_FOUND');
    assert.deepEqual(h.calls, [['list', '--open', '--json']]);
  });

  it('502 quand attn act echoue, sa sortie reste sur le Mac', async () => {
    h = fake(RAW, (argv) => (argv[0] === 'act' ? { code: 1, stdout: '', stderr: 'claap-agent injoignable' } : undefined));
    const res = await act('a-2555da', { button: 'Envoyer' });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().code, 'ATTENTION_ERROR');
    assert.equal(res.body.includes('injoignable'), false);
    assert.deepEqual(refreshed, []);
  });

  it('409 pour un second geste pendant que le premier tourne', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[][] = [];
    h = {
      calls,
      exec: async (argv) => {
        calls.push(argv);
        if (argv[0] === 'list') return { code: 0, stdout: JSON.stringify(RAW), stderr: '' };
        await gate;
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    const first = act('a-2555da', { button: 'Envoyer' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await act('a-2555da', { button: 'Envoyer' });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().code, 'ATTENTION_BUSY');
    release();
    assert.equal((await first).statusCode, 200);
    assert.equal(calls.filter((argv) => argv[0] === 'act').length, 1);
  });

  it('un nonce rejoue est refuse sans geste', async () => {
    assert.equal((await act('a-36d0b2', { button: 'Fait', nonce: 'n-1' })).statusCode, 200);
    h = fake();
    const res = await act('a-36d0b2', { button: 'Fait', nonce: 'n-1' });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(h.calls, []);
  });
});
