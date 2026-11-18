// Le Cockpit sur le telephone : les champs de carte lus comme Kova les lit (indulgents,
// bornes), l'argv exact d'un geste et d'un report, la sortie d'`attn act --exit-codes`
// traduite comme Kova, et les deux routes, refus SANS lancer `attn` compris.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { ATTENTION_DRAFT_MAX, ROUTES, type AttentionResponse } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-cockpit-'));
process.env['KOVALINK_QUIET'] = '1';

const {
  AttentionBoard,
  AttentionError,
  checkGesture,
  checkUncertain,
  checkUntil,
  execAttn,
  gestureArgv,
  gestureOutcome,
  snoozeArgv,
  toAttentionEntry,
  uncertainArgv,
} = await import('../src/attention.js');
const { registerAttentionRoutes } = await import('../src/server/attentionRoutes.js');
const { NonceStore } = await import('../src/server/services.js');
const { RateLimiter } = await import('../src/server/rate.js');
const { needInputOf, waitsOnYouOf } = await import('../src/needs.js');
const { countsOf } = await import('../src/push/counts.js');
import type { Exec, ExecResult } from '../src/routines.js';

const LIST = ['list', '--open', '--json', '--scope', 'all'];
const CARD_FP = 'fedcba9876543210';
const SEEN = '3fe43fde4beeba99';

/** Une carte telle que `attn list --open --json --scope all` l'ecrit aujourd'hui. */
const CARD = {
  op: 'add',
  id: 'a-36d0b2',
  ts: '2026-11-05T16:22:48+01:00',
  from: 'claap-agent',
  level: 'point',
  kind: 'would',
  title: 'Relancer Francisco',
  needs: 'Valider le message',
  scope: 'perso',
  prio: 1,
  card_seen: CARD_FP,
  gestures: ['go', 'nogo', 'ask', 'seen', 'done', 'dismiss'],
  waiting: 'robin',
  go_label: 'Go, envoyer',
  ask: null,
  label: 'Clients',
  label_color: '#22C55E',
  draft: {
    to: 'Francisco',
    channel: 'slack',
    text: 'Hello Francisco',
    seen: SEEN,
    target: 'D123',
    target_label: 'DM Francisco',
    target_kind: 'dm',
  },
  detail: 'Ce qu explain a ecrit',
  before: '/Users/robin/shots/before.png',
  after: 'relative/after.png',
  failed: ' ',
  proof: 'slack:D1/17.5',
  snoozed_until: '2026-11-16T09:00:00+01:00',
  routine: 'veille',
};

/** Une carte qui attend l'agent : on ne peut que retirer la question ou cocher. */
const ASKED = {
  id: 'a-0d0db1',
  ts: '2026-11-05T16:20:00+01:00',
  from: 'claap-agent',
  level: 'now',
  kind: 'decision',
  title: 'Choisir le plan',
  card_seen: '0123456789abcdef',
  gestures: ['cancel', 'done'],
  waiting: 'agent',
  ask: { act_id: 'c-1', text: ' Pourquoi ? ', ts: '2026-11-05T16:30:00+01:00', to: 'claap-agent', label: 'non remis\u0007' },
};

describe('cockpit : lecture des cartes', () => {
  it('passe les champs du Cockpit, en camelCase, valides comme Kova', () => {
    const e = toAttentionEntry(CARD);
    assert.ok(e);
    assert.deepEqual(e.gestures, ['go', 'nogo', 'ask', 'seen', 'done', 'dismiss']);
    assert.equal(e.goLabel, 'Go, envoyer');
    assert.equal(e.waiting, 'robin');
    assert.equal(e.ask, undefined, 'ask seulement quand la carte attend l agent');
    assert.equal(e.cardSeen, CARD_FP);
    assert.equal(e.prio, 1);
    assert.deepEqual(e.label, { name: 'Clients', color: '#22C55E' });
    assert.equal(e.scope, 'perso');
    assert.deepEqual(e.draft, {
      text: 'Hello Francisco',
      to: 'Francisco',
      channel: 'slack',
      target: 'D123',
      targetLabel: 'DM Francisco',
      targetKind: 'dm',
      seen: SEEN,
    });
    assert.equal(e.detail, 'Ce qu explain a ecrit');
    assert.equal(e.before, '/Users/robin/shots/before.png');
    assert.equal(e.after, undefined, 'un chemin relatif n est pas passe');
    assert.equal(e.failed, undefined, 'vide apres trim : omis');
    assert.equal(e.proof, 'slack:D1/17.5');
    assert.equal(e.snoozedUntil, '2026-11-16T09:00:00+01:00');
    assert.equal('routine' in e, false);
    assert.equal('card_seen' in e, false);
  });

  it('la question posee, quand la carte attend l agent, label nettoye et borne', () => {
    const e = toAttentionEntry(ASKED);
    assert.deepEqual(e?.ask, { text: 'Pourquoi ?', ts: '2026-11-05T16:30:00+01:00', to: 'claap-agent', label: 'non remis' });
    const long = toAttentionEntry({ ...ASKED, ask: { text: 'q', label: 'x'.repeat(200) } });
    assert.equal(long?.ask?.label?.length, 80);
  });

  it('indulgente : une prio, un brouillon, un label ou une empreinte illisible est omis, la carte reste', () => {
    const e = toAttentionEntry({
      ...CARD,
      prio: 7,
      draft: { to: 'x', text: '   ' },
      label_color: 'green',
      card_seen: '--by=robin',
      waiting: 'someone',
      scope: 'other',
      go_label: '\u0000Go\nnow' + 'x'.repeat(100),
      gestures: ['go', 'fly', 'go', 3, 'done'],
    });
    assert.ok(e, 'la carte se lit toujours');
    assert.equal(e.prio, undefined);
    assert.equal(e.draft, undefined);
    assert.deepEqual(e.label, { name: 'Clients', color: '#94A3B8' });
    assert.equal(e.cardSeen, undefined);
    assert.equal(e.waiting, undefined);
    assert.equal(e.scope, undefined);
    assert.equal(e.goLabel, 'Gonow' + 'x'.repeat(35));
    assert.deepEqual(e.gestures, ['go', 'done'], 'mots connus, sans doublon, dans l ordre');
    assert.equal(toAttentionEntry({ ...CARD, prio: '1' })?.prio, undefined);
    assert.equal(toAttentionEntry({ ...CARD, draft: 'texte' })?.draft, undefined);
    assert.equal(toAttentionEntry({ ...CARD, draft: { text: 'ok', seen: 'zz' } })?.draft?.seen, undefined);
  });

  it('une carte sans champs du Cockpit reste celle d avant', () => {
    const e = toAttentionEntry({ id: 'a-111111', ts: '2026-11-05T16:20:00+01:00', level: 'now', title: 't' });
    assert.deepEqual(e, { id: 'a-111111', ts: '2026-11-05T16:20:00+01:00', from: '', level: 'now', kind: 'info', title: 't' });
  });

  it('src : une liste, ou un seul mot', () => {
    assert.deepEqual(toAttentionEntry({ ...CARD, src: ' pr:13752 ' })?.src, ['pr:13752']);
    assert.deepEqual(toAttentionEntry({ ...CARD, src: ['pr:1', ''] })?.src, ['pr:1']);
  });
});

describe('cockpit : argv et sortie', () => {
  it('la forme exacte de Kova, chaque valeur en un seul element', () => {
    const g = checkGesture({ gesture: 'go', text: ' --by evil ', seen: SEEN, draft: 'Mon texte\n--x', cardSeen: CARD_FP });
    assert.deepEqual(gestureArgv('a-36d0b2', { ...g, clientId: 'c-1' }), [
      'act',
      '--by',
      'robin',
      '--exit-codes',
      '--client-id=c-1',
      `--card-seen=${CARD_FP}`,
      'a-36d0b2',
      'go',
      '--text=--by evil',
      `--seen=${SEEN}`,
      '--draft=Mon texte\n--x',
    ]);
    assert.deepEqual(gestureArgv('a-36d0b2', { ...checkGesture({ gesture: 'cancel' }), clientId: 'c-2' }), [
      'act',
      '--by',
      'robin',
      '--exit-codes',
      '--client-id=c-2',
      'a-36d0b2',
      'cancel',
    ]);
  });

  const refused: [string, Record<string, unknown>][] = [
    ['mot inconnu', { gesture: 'Envoyer' }],
    ['ask sans texte', { gesture: 'ask', text: '  ' }],
    ['cancel avec texte', { gesture: 'cancel', text: 'non' }],
    ['seen hors go', { gesture: 'done', seen: SEEN }],
    ['draft hors go', { gesture: 'nogo', draft: 'x' }],
    ['seen mal forme', { gesture: 'go', seen: '--by=robin0000000' }],
    ['cardSeen mal forme', { gesture: 'go', cardSeen: 'abc' }],
    ['clientId en option', { gesture: 'go', clientId: '--by' }],
    ['clientId trop long', { gesture: 'go', clientId: 'a'.repeat(65) }],
    ['texte avec controle', { gesture: 'go', text: 'a\u0007b' }],
    ['brouillon avec controle', { gesture: 'go', draft: 'a\u001bb' }],
    ['brouillon trop long', { gesture: 'go', draft: 'x'.repeat(ATTENTION_DRAFT_MAX + 1) }],
    ['texte pas une chaine', { gesture: 'go', text: 3 }],
  ];
  for (const [name, body] of refused) {
    it(`refuse avant de lancer : ${name}`, () => {
      assert.throws(() => checkGesture(body), (e: unknown) => e instanceof AttentionError && e.reason === 'bad_request');
    });
  }

  it('tabulation et saut de ligne passent dans le texte et le brouillon', () => {
    const g = checkGesture({ gesture: 'go', text: 'a\tb\nc', draft: 'l1\n\tl2' });
    assert.equal(g.text, 'a\tb\nc');
    assert.equal(g.draft, 'l1\n\tl2');
  });

  it('les codes de sortie : 0, 3, 4, 5 et le reste', () => {
    assert.deepEqual(gestureOutcome({ code: 0, stdout: 'remis a claap-agent\n', stderr: '' }), { outcome: 'delivered' });
    assert.deepEqual(gestureOutcome({ code: 3, stdout: '', stderr: '' }), { outcome: 'noted' });
    assert.deepEqual(gestureOutcome({ code: 0, stdout: 'envoi par le code (slack à U0BJ301TJNM)\nplus\n', stderr: '' }), {
      outcome: 'said',
      line: 'envoi par le code (slack à U0BJ301TJNM)',
    });
    assert.deepEqual(gestureOutcome({ code: 0, stdout: 'déjà parti ou en cours pour cette version du brouillon', stderr: '' }), {
      outcome: 'said',
      line: 'déjà parti ou en cours pour cette version du brouillon',
    });
    assert.throws(
      () => gestureOutcome({ code: 4, stdout: '', stderr: 'ce brouillon a change\u0007 ' + 'y'.repeat(300) + '\nsuite\n' }),
      (e: unknown) =>
        e instanceof AttentionError && e.reason === 'refused' && e.message.startsWith('ce brouillon a change y') && e.message.length === 140,
    );
    assert.throws(
      () => gestureOutcome({ code: 5, stdout: '', stderr: 'autre carte' }),
      (e: unknown) => e instanceof AttentionError && e.reason === 'card_changed',
    );
    assert.throws(
      () => gestureOutcome({ code: -1, stdout: '', stderr: 'spawn ENOENT /Users/robin/secret' }),
      (e: unknown) => e instanceof AttentionError && e.reason === 'attn_failed',
    );
  });

  it('carte incertaine : parti et Renvoyer, forme de Kova, seen seul', () => {
    assert.deepEqual(uncertainArgv('a-36d0b2', checkUncertain({ gesture: 'parti', seen: SEEN, cardSeen: CARD_FP, clientId: 'c-1' })), [
      'act',
      '--by',
      'robin',
      '--exit-codes',
      'a-36d0b2',
      'parti',
      `--seen=${SEEN}`,
    ]);
    assert.deepEqual(uncertainArgv('a-36d0b2', checkUncertain({ gesture: 'Renvoyer', text: '' })), [
      'act',
      '--by',
      'robin',
      '--exit-codes',
      'a-36d0b2',
      'Renvoyer',
    ]);
    for (const body of [
      { gesture: 'parti', text: 'x' },
      { gesture: 'Renvoyer', draft: 'x' },
      { gesture: 'parti', seen: '--by=robin0000000' },
      { gesture: 'go' },
    ]) {
      assert.throws(() => checkUncertain(body), (e: unknown) => e instanceof AttentionError && e.reason === 'bad_request');
    }
    assert.throws(() => checkGesture({ gesture: 'parti' }), (e: unknown) => e instanceof AttentionError, 'pas un des sept');
  });

  it('un autre code avec une ligne : refuse avec la ligne d attn, la fin (noté dans ...) coupee', () => {
    const refusal = (code: number, stderr: string): string => {
      try {
        gestureOutcome({ code, stdout: '', stderr });
      } catch (e) {
        assert.ok(e instanceof AttentionError);
        return `${e.reason}: ${e.message}`;
      }
      return 'ok';
    };
    assert.equal(
      refusal(1, 'attn act : --by robin refusé, ce geste ne vient ni de Kova ni de KovaLink (noté dans /Users/robin/.attn/refus.log)\n'),
      'refused: attn act : --by robin refusé, ce geste ne vient ni de Kova ni de KovaLink',
    );
    assert.equal(
      refusal(1, "attn: a-f7c938 n'a pas d'envoi incertain pour ce brouillon\n"),
      "refused: attn: a-f7c938 n'a pas d'envoi incertain pour ce brouillon",
    );
    assert.equal(refusal(2, '\n  premiere\nseconde'), 'refused: premiere', 'la premiere ligne non vide');
    assert.match(refusal(1, ''), /^attn_failed/, 'sans ligne : un echec');
    assert.match(refusal(-1, 'spawn ETIMEDOUT'), /^attn_failed/, 'sans code : un echec');
  });

  it('un CLI absent n a pas de code : un echec (502), jamais un refus', async () => {
    const was = process.env['KOVALINK_ATTN'];
    process.env['KOVALINK_ATTN'] = '/nonexistent/kovalink-attn';
    try {
      const res = await execAttn(['snooze', '--until=2026-11-19T09:00:00+01:00', 'a-36d0b2']);
      assert.equal(res.code, -1);
      assert.throws(() => gestureOutcome(res), (e: unknown) => e instanceof AttentionError && e.reason === 'attn_failed');
    } finally {
      if (was === undefined) delete process.env['KOVALINK_ATTN'];
      else process.env['KOVALINK_ATTN'] = was;
    }
  });

  it('le report : snooze --by robin --until=<ISO> <carte>, date future a 60 jours au plus', () => {
    const now = Date.parse('2026-11-18T10:00:00+01:00');
    assert.deepEqual(snoozeArgv('a-36d0b2', '2026-11-19T09:00:00+01:00'), [
      'snooze',
      '--by',
      'robin',
      '--until=2026-11-19T09:00:00+01:00',
      'a-36d0b2',
    ]);
    assert.equal(checkUntil('2026-11-19T09:00:00+01:00', now), '2026-11-19T09:00:00+01:00');
    assert.equal(checkUntil('2026-11-19T08:00:00Z', now), '2026-11-19T08:00:00Z');
    for (const bad of ['2026-11-19', '2026-11-19T09:00:00', '2026-11-17T09:00:00+01:00', '2027-03-01T09:00:00+01:00', '--by=x', 5]) {
      assert.throws(() => checkUntil(bad, now), (e: unknown) => e instanceof AttentionError && e.reason === 'bad_request', String(bad));
    }
  });
});

describe('cockpit : compte des Urgentes', () => {
  it('une carte prio 1 compte comme une now dans waitsOnYou et la pastille', () => {
    const now = Date.parse('2026-11-06T10:00:00+01:00');
    const entries = [toAttentionEntry(CARD), toAttentionEntry({ ...CARD, id: 'a-222222', prio: 2 })].filter(
      (e): e is NonNullable<typeof e> => e !== null,
    );
    assert.equal(waitsOnYouOf([], [], now, entries), 1);
    assert.equal(countsOf([], [], now, entries).asks, 1);
    assert.equal(countsOf([], [], now, entries).oldestAt, Math.floor(Date.parse(CARD.ts) / 1000));
    // Comptee, mais pas ajoutee a la liste des needs comme une `now`.
    assert.deepEqual(
      needInputOf([], [], now, entries).attention?.map((a) => a.level),
      ['point', 'point'],
    );
    const nowUrgent = toAttentionEntry({ ...CARD, level: 'now' });
    assert.ok(nowUrgent);
    assert.equal(waitsOnYouOf([], [], now, [nowUrgent]), 1, 'une now Urgente ne compte qu une fois');
  });
});

/** Faux `attn` : enregistre les argv, rend `list` puis les reponses forcees. */
function fake(
  raw: unknown = [CARD, ASKED],
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

describe('cockpit : routes', () => {
  let app: FastifyInstance;
  let h: ReturnType<typeof fake>;
  let refreshed: string[];
  let boardRef: InstanceType<typeof AttentionBoard>;
  const NOW = Date.parse('2026-11-18T10:00:00+01:00');

  before(async () => {
    app = Fastify();
    app.addHook('onRequest', (req, _reply, done) => {
      req.deviceId = 'iphone-test';
      done();
    });
    // Un tableau neuf par test, derriere un relais monte une seule fois.
    const relay = new Proxy({} as InstanceType<typeof AttentionBoard>, {
      get: (_t, key) => {
        const v = (boardRef as unknown as Record<string | symbol, unknown>)[key];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(boardRef) : v;
      },
    });
    registerAttentionRoutes(
      app,
      {
        rate: new RateLimiter(),
        nonces: new NonceStore(),
        refreshAttention: async (reason) => {
          refreshed.push(reason);
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
    boardRef = new AttentionBoard((argv) => h.exec(argv), () => NOW);
  });

  const gesture = (id: string, body: unknown) =>
    app.inject({ method: 'POST', url: ROUTES.attentionGesture(id), payload: body as Record<string, unknown> });
  const snooze = (id: string, body: unknown) =>
    app.inject({ method: 'POST', url: ROUTES.attentionSnooze(id), payload: body as Record<string, unknown> });

  it('GET rend les champs du Cockpit', async () => {
    const res = await app.inject({ method: 'GET', url: ROUTES.attention });
    const body = res.json() as AttentionResponse;
    assert.deepEqual(body.entries[0]?.gestures, CARD.gestures);
    assert.equal(body.entries[1]?.ask?.text, 'Pourquoi ?');
    assert.deepEqual(h.calls, [LIST]);
  });

  it('go avec brouillon : relecture, puis l argv de Kova, puis relecture de la file', async () => {
    const res = await gesture('a-36d0b2', {
      gesture: 'go',
      text: 'ok',
      seen: SEEN,
      draft: 'Hello Francisco !',
      cardSeen: CARD_FP,
      clientId: 'app-click-1',
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { outcome: 'delivered' });
    assert.deepEqual(h.calls, [
      LIST,
      [
        'act',
        '--by',
        'robin',
        '--exit-codes',
        '--client-id=app-click-1',
        `--card-seen=${CARD_FP}`,
        'a-36d0b2',
        'go',
        '--text=ok',
        `--seen=${SEEN}`,
        '--draft=Hello Francisco !',
      ],
    ]);
    assert.deepEqual(refreshed, ['gesture']);
  });

  it('un geste que la carte n offre pas est refuse sans lancer act', async () => {
    const res = await gesture('a-0d0db1', { gesture: 'go' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'ATTENTION_GESTURE_NOT_OFFERED');
    assert.deepEqual(h.calls, [LIST]);
  });

  it('une carte sans gestures (file d avant) : aucun geste du Cockpit', async () => {
    h = fake([{ ...CARD, gestures: undefined }]);
    const res = await gesture('a-36d0b2', { gesture: 'done' });
    assert.equal(res.json().code, 'ATTENTION_GESTURE_NOT_OFFERED');
  });

  it('404 pour une carte partie, sans geste', async () => {
    const res = await gesture('a-999999', { gesture: 'done' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().code, 'ATTENTION_NOT_FOUND');
    assert.deepEqual(h.calls, [LIST]);
  });

  it('400 sans rien lancer : id hors format, geste inconnu, ask sans texte', async () => {
    for (const [id, body] of [
      ['--by', { gesture: 'done' }],
      ['a-36d0b2', { gesture: 'Envoyer' }],
      ['a-36d0b2', { gesture: 'ask' }],
      ['a-36d0b2', { gesture: 'done', draft: 'x' }],
    ] as const) {
      const res = await gesture(id, body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
    }
    assert.deepEqual(h.calls, []);
  });

  it('code 3 : noted ; code 0 avec la ligne de la file : said', async () => {
    h = fake(undefined, (argv) => (argv[0] === 'act' ? { code: 3, stdout: '', stderr: '' } : undefined));
    assert.deepEqual((await gesture('a-36d0b2', { gesture: 'seen' })).json(), { outcome: 'noted' });
    h = fake(undefined, (argv) =>
      argv[0] === 'act' ? { code: 0, stdout: 'déjà noté pour ce clic\n', stderr: '' } : undefined,
    );
    assert.deepEqual((await gesture('a-36d0b2', { gesture: 'seen' })).json(), {
      outcome: 'said',
      line: 'déjà noté pour ce clic',
    });
  });

  it('code 4 : refuse, la ligne d attn va a l app ; code 5 : carte changee ; autre : 502 sans sortie', async () => {
    h = fake(undefined, (argv) =>
      argv[0] === 'act' ? { code: 4, stdout: '', stderr: 'ce brouillon a change, relis-le\nusage...\n' } : undefined,
    );
    let res = await gesture('a-36d0b2', { gesture: 'go' });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { code: 'ATTENTION_REFUSED', message: 'ce brouillon a change, relis-le', retryable: false });
    h = fake(undefined, (argv) => (argv[0] === 'act' ? { code: 5, stdout: '', stderr: 'autre carte' } : undefined));
    res = await gesture('a-36d0b2', { gesture: 'go', cardSeen: CARD_FP });
    assert.equal(res.json().code, 'ATTENTION_CARD_CHANGED');
    assert.equal(res.body.includes('autre carte'), false);
    h = fake(undefined, (argv) => (argv[0] === 'act' ? { code: -1, stdout: '', stderr: '/Users/robin/secret' } : undefined));
    res = await gesture('a-36d0b2', { gesture: 'go' });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.includes('secret'), false);
  });

  it('sans clientId de l app : le meme essai reprend le meme identifiant, un autre texte non', async () => {
    h = fake(undefined, (argv) => (argv[0] === 'act' ? { code: 1, stdout: '', stderr: 'boom' } : undefined));
    await gesture('a-36d0b2', { gesture: 'ask', text: 'pourquoi ?' });
    await gesture('a-36d0b2', { gesture: 'ask', text: 'pourquoi ?' });
    await gesture('a-36d0b2', { gesture: 'ask', text: 'autre' });
    const ids = h.calls.filter((a) => a[0] === 'act').map((a) => a.find((x) => x.startsWith('--client-id=')));
    assert.equal(ids.length, 3);
    assert.equal(ids[0], ids[1]);
    assert.notEqual(ids[1], ids[2]);
    assert.match(ids[0] ?? '', /^--client-id=[0-9a-f-]{36}$/);
  });

  it('409 pour un second geste pendant que le premier tourne', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h = fake(undefined, () => undefined);
    const inner = h.exec;
    h.exec = async (argv) => {
      if (argv[0] === 'act') await gate;
      return inner(argv);
    };
    const first = gesture('a-36d0b2', { gesture: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await gesture('a-36d0b2', { gesture: 'dismiss' });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().code, 'ATTENTION_BUSY');
    const snoozed = await snooze('a-36d0b2', { until: '2026-11-19T09:00:00+01:00' });
    assert.equal(snoozed.json().code, 'ATTENTION_BUSY', 'la garde vaut aussi pour le report');
    release();
    assert.equal((await first).statusCode, 200);
    assert.equal(h.calls.filter((a) => a[0] === 'act').length, 1);
  });

  it('un nonce rejoue est refuse sans geste, un nonce d un refus est rendu', async () => {
    assert.equal((await gesture('a-36d0b2', { gesture: 'done', nonce: 'n-1' })).statusCode, 200);
    h = fake();
    const res = await gesture('a-36d0b2', { gesture: 'done', nonce: 'n-1' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'BAD_REQUEST');
    assert.deepEqual(h.calls, []);
    assert.equal((await gesture('a-999999', { gesture: 'done', nonce: 'n-2' })).statusCode, 404);
    assert.equal((await gesture('a-36d0b2', { gesture: 'done', nonce: 'n-2' })).statusCode, 200);
  });

  it('parti et Renvoyer : seulement sur une carte incertaine relue', async () => {
    h = fake([{ ...CARD, gestures: [], uncertain: 'timeout' }, ASKED]);
    const res = await gesture('a-36d0b2', { gesture: 'Renvoyer', seen: SEEN, cardSeen: CARD_FP });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { outcome: 'delivered' });
    assert.deepEqual(h.calls[1], ['act', '--by', 'robin', '--exit-codes', 'a-36d0b2', 'Renvoyer', `--seen=${SEEN}`]);
    const refused = await gesture('a-0d0db1', { gesture: 'parti' });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().code, 'ATTENTION_GESTURE_NOT_OFFERED');
    assert.equal(h.calls.filter((a) => a[0] === 'act').length, 1);
  });

  it('snooze : carte ouverte, argv signe, relecture', async () => {
    const res = await snooze('a-36d0b2', { until: '2026-11-19T09:00:00+01:00' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { applied: true });
    assert.deepEqual(h.calls, [LIST, ['snooze', '--by', 'robin', '--until=2026-11-19T09:00:00+01:00', 'a-36d0b2']]);
    assert.deepEqual(refreshed, ['snooze']);
  });

  it('snooze refuse par attn : 409 ATTENTION_REFUSED avec sa ligne', async () => {
    h = fake(undefined, (argv) =>
      argv[0] === 'snooze' ? { code: 1, stdout: '', stderr: 'attn: a-36d0b2 deja reportee (noté dans /Users/x/log)\n' } : undefined,
    );
    const res = await snooze('a-36d0b2', { until: '2026-11-19T09:00:00+01:00' });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { code: 'ATTENTION_REFUSED', message: 'attn: a-36d0b2 deja reportee', retryable: false });
  });

  it('un geste refuse par attn avec le code 1 : 409, pas 502', async () => {
    h = fake(undefined, (argv) =>
      argv[0] === 'act' ? { code: 1, stdout: '', stderr: "attn: a-36d0b2 n'a pas d'envoi incertain pour ce brouillon\n" } : undefined,
    );
    const res = await gesture('a-36d0b2', { gesture: 'go' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'ATTENTION_REFUSED');
  });

  it('snooze : 400 sans rien lancer, 404 pour une carte partie, 502 quand attn echoue', async () => {
    for (const until of ['demain', '2026-11-17T09:00:00+01:00', '2027-02-01T09:00:00+01:00', undefined]) {
      assert.equal((await snooze('a-36d0b2', { until })).statusCode, 400, String(until));
    }
    assert.deepEqual(h.calls, []);
    assert.equal((await snooze('a-999999', { until: '2026-11-19T09:00:00+01:00' })).statusCode, 404);
    h = fake(undefined, (argv) => (argv[0] === 'snooze' ? { code: -1, stdout: '', stderr: '/Users/x' } : undefined));
    const res = await snooze('a-36d0b2', { until: '2026-11-19T09:00:00+01:00' });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.includes('/Users'), false);
  });
});
