// Navigateur : les trois routes tournent contre un FAUX Mira, un serveur sur socket unix
// qui repond commande par commande et enregistre ce qu'il recoit. Ce qui atteint le faux
// est exactement ce qui atteindrait le vrai. Aucun test ne touche `/tmp/mira.sock`.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { MIRA_TEXT_MAX, ROUTES, type MiraFrameResponse, type MiraTabsResponse } from '@kovalink/protocol';

const HOME = mkdtempSync(join(tmpdir(), 'kovalink-mira-'));
process.env['KOVALINK_HOME'] = HOME;
process.env['KOVALINK_QUIET'] = '1';

const { registerMiraRoutes } = await import('../src/server/miraRoutes.js');
const { RateLimiter } = await import('../src/server/rate.js');
const { MiraUnavailable, miraCall } = await import('../src/mira/client.js');
const { auditDetail, isAllowedKey, normalizeNavUrl, parseMiraAction } = await import('../src/mira/actions.js');
import type { Services } from '../src/server/services.js';

/** Un PNG de 1x1 pixel : ce que le faux ecrit au chemin demande par `screenshot`. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const WIN_A = 'win-a';
const WIN_B = 'win-b';
const TAB_1 = '11111111-1111-4111-8111-111111111111';
const TAB_2 = '22222222-2222-4222-8222-222222222222';
const TAB_3 = '33333333-3333-4333-8333-333333333333';
const KNOWN = new Set([TAB_1, TAB_2, TAB_3]);

class FakeMira {
  readonly dir = mkdtempSync(join(tmpdir(), 'kovalink-mira-sock-'));
  readonly path = join(this.dir, 'mira.sock');
  received: { command: string; params: Record<string, unknown> }[] = [];
  private server: Server | null = null;

  answer(command: string, params: Record<string, unknown>): Record<string, unknown> {
    const tabId = typeof params['tabId'] === 'string' ? params['tabId'] : typeof params['id'] === 'string' ? params['id'] : null;
    if (tabId && !KNOWN.has(tabId)) return { ok: false, error: `unknown tab: ${tabId}` };
    switch (command) {
      case 'list-windows':
        return { ok: true, windows: [{ windowId: WIN_A, focused: true }, { windowId: WIN_B, focused: false }] };
      case 'list-tabs':
        if (params['windowId'] === WIN_A) {
          return {
            ok: true,
            activeId: TAB_1,
            tabs: [
              { id: TAB_1, title: 'Login', url: 'https://accounts.example.com/signin', loaded: true, kind: 'web' },
              { id: TAB_2, title: 'Asleep', url: 'https://sleepy.example.com/', loaded: false, kind: 'web' },
              { id: 'settings', title: 'Settings', url: '', loaded: true, kind: 'settings' },
            ],
          };
        }
        if (params['windowId'] === WIN_B) {
          return { ok: true, activeId: TAB_3, tabs: [{ id: TAB_3, title: 'Docs', url: 'https://docs.example.com/x', loaded: true, kind: 'web' }] };
        }
        return { ok: false, error: `unknown window: ${String(params['windowId'])}` };
      case 'exec-js': {
        const code = String(params['code']);
        if (code.startsWith('({w: window.innerWidth')) {
          return { ok: true, result: { w: 1280, h: 720, url: 'https://accounts.example.com/signin?next=/home', title: 'Sign in' } };
        }
        return { ok: true, result: 'ok' };
      }
      case 'screenshot': {
        const path = String(params['path']);
        writeFileSync(path, TINY_PNG);
        return { ok: true, path, width: 2560, height: 1440, bytes: TINY_PNG.length };
      }
      case 'click':
        return { ok: true, x: params['x'], y: params['y'], target: 'BUTTON' };
      case 'press-key':
        return { ok: true, result: { key: params['key'] } };
      case 'navigate':
        return { ok: true, url: params['url'] };
      case 'reload':
      case 'activate-tab':
        return { ok: true };
      default:
        return { ok: false, error: `unknown command: ${command}` };
    }
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((sock) => {
        sock.setEncoding('utf8');
        let buf = '';
        sock.on('data', (chunk: string) => {
          buf += chunk;
          const nl = buf.indexOf('\n');
          if (nl < 0) return;
          const msg = JSON.parse(buf.slice(0, nl)) as { command: string; params?: Record<string, unknown> };
          const params = msg.params ?? {};
          this.received.push({ command: msg.command, params });
          sock.end(`${JSON.stringify(this.answer(msg.command, params))}\n`);
        });
        sock.on('error', () => undefined);
      });
      this.server.listen(this.path, () => resolve());
    });
  }

  stop(): void {
    this.server?.close();
  }
}

const fake = new FakeMira();
let app: FastifyInstance;
const DEVICE = 'iphone-test';

before(async () => {
  await fake.start();
  process.env['MIRA_SOCKET'] = fake.path;
  app = Fastify();
  app.addHook('onRequest', (req, _reply, done) => {
    req.deviceId = DEVICE;
    done();
  });
  registerMiraRoutes(app, { rate: new RateLimiter() } as unknown as Services);
  await app.ready();
});
after(async () => {
  await app.close();
  fake.stop();
});
afterEach(() => {
  process.env['MIRA_SOCKET'] = fake.path;
  fake.received.length = 0;
});

function auditLines(): { action: string; result: string; detail?: string }[] {
  const day = new Date().toISOString().slice(0, 10);
  let raw = '';
  try {
    raw = readFileSync(join(HOME, 'audit', `${day}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { action: string; result: string; detail?: string });
}

describe('client de la socket', () => {
  it('socket absente : MiraUnavailable, jamais une erreur reseau anonyme', async () => {
    await assert.rejects(() => miraCall('list-windows', {}, join(fake.dir, 'absent.sock')), (e: unknown) => e instanceof MiraUnavailable);
  });

  it('une commande refusee relaie le message de Mira mot pour mot', async () => {
    await assert.rejects(() => miraCall('exec-js', { code: '1', tabId: 'nope' }, fake.path), /unknown tab: nope/);
  });
});

describe('GET /v1/mira/tabs', () => {
  it('liste les onglets web de toutes les fenetres, actif et endormi marques', async () => {
    const res = await app.inject({ method: 'GET', url: ROUTES.miraTabs });
    assert.equal(res.statusCode, 200);
    const body = res.json() as MiraTabsResponse;
    assert.equal(body.available, true);
    assert.deepEqual(
      body.tabs.map((t) => [t.id, t.windowId, t.active, t.asleep]),
      [
        [TAB_1, WIN_A, true, false],
        [TAB_2, WIN_A, false, true],
        [TAB_3, WIN_B, true, false],
      ],
    );
    assert.equal(body.tabs[0]?.title, 'Login');
    assert.equal(body.tabs[0]?.url, 'https://accounts.example.com/signin');
    // Une seule enumeration des fenetres, puis un `list-tabs` par fenetre.
    assert.deepEqual(fake.received.map((r) => r.command), ['list-windows', 'list-tabs', 'list-tabs']);
  });

  it('Mira absent : 200 avec available:false, pas une erreur', async () => {
    process.env['MIRA_SOCKET'] = join(fake.dir, 'absent.sock');
    const res = await app.inject({ method: 'GET', url: ROUTES.miraTabs });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { available: false, tabs: [] });
  });
});

describe('GET /v1/mira/tabs/:tabId/frame', () => {
  it('une image en base64 avec la taille ecran, le viewport CSS, l url et le titre', async () => {
    const res = await app.inject({ method: 'GET', url: ROUTES.miraFrame(TAB_1) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    const body = res.json() as MiraFrameResponse;
    assert.equal(body.mime, 'image/png');
    assert.equal(Buffer.from(body.image, 'base64').equals(TINY_PNG), true);
    assert.deepEqual([body.width, body.height, body.cssWidth, body.cssHeight], [2560, 1440, 1280, 720]);
    assert.equal(body.url, 'https://accounts.example.com/signin?next=/home');
    assert.equal(body.title, 'Sign in');
    // Un aller-retour pour le viewport, un pour la capture, dans un dossier du daemon.
    assert.deepEqual(fake.received.map((r) => r.command), ['exec-js', 'screenshot']);
    const shotPath = String(fake.received[1]?.params['path']);
    assert.match(shotPath, /kovalink-mira\/[0-9a-f]{16}\.png$/);
    assert.throws(() => readFileSync(shotPath), 'le fichier temporaire est efface apres lecture');
  });

  it('onglet inconnu : 404 MIRA_TAB_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: ROUTES.miraFrame('ferme') });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().code, 'MIRA_TAB_NOT_FOUND');
  });

  it('Mira absent : 503 MIRA_UNAVAILABLE, retryable', async () => {
    process.env['MIRA_SOCKET'] = join(fake.dir, 'absent.sock');
    const res = await app.inject({ method: 'GET', url: ROUTES.miraFrame(TAB_1) });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { code: 'MIRA_UNAVAILABLE', message: 'Mira is not running on the Mac', retryable: true });
  });
});

describe('POST /v1/mira/tabs/:tabId/act', () => {
  const act = (tabId: string, body: unknown) => app.inject({ method: 'POST', url: ROUTES.miraAct(tabId), payload: body as Record<string, unknown> });

  it('click : un vrai clic CDP aux coordonnees CSS, arrondies', async () => {
    const res = await act(TAB_1, { kind: 'click', x: 100.4, y: 200.6 });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
    assert.deepEqual(fake.received, [{ command: 'click', params: { tabId: TAB_1, x: 100, y: 201 } }]);
  });

  it('type : insertText dans la page, le texte ne quitte pas la commande exec-js', async () => {
    const res = await act(TAB_1, { kind: 'type', text: 'hunter2' });
    assert.equal(res.statusCode, 200);
    assert.equal(fake.received[0]?.command, 'exec-js');
    assert.match(String(fake.received[0]?.params['code']), /insertText/);
    assert.match(String(fake.received[0]?.params['code']), /"hunter2"/);
  });

  it('key : press-key avec la touche et les modificateurs, Space devient un espace', async () => {
    await act(TAB_1, { kind: 'key', key: 'Enter' });
    await act(TAB_1, { kind: 'key', key: 'Tab', modifiers: ['shift'] });
    await act(TAB_1, { kind: 'key', key: 'Space' });
    await act(TAB_1, { kind: 'key', key: 'a' });
    assert.deepEqual(
      fake.received.map((r) => [r.command, r.params['key'], r.params['modifiers']]),
      [
        ['press-key', 'Enter', undefined],
        ['press-key', 'Tab', ['shift']],
        ['press-key', ' ', undefined],
        ['press-key', 'a', undefined],
      ],
    );
  });

  it('scroll, nav, back, forward, reload, activate : la commande attendue avec l onglet', async () => {
    await act(TAB_1, { kind: 'scroll', dy: 9000 });
    await act(TAB_1, { kind: 'nav', url: 'example.com/path' });
    await act(TAB_1, { kind: 'back' });
    await act(TAB_1, { kind: 'forward' });
    await act(TAB_1, { kind: 'reload' });
    await act(TAB_1, { kind: 'activate' });
    assert.deepEqual(fake.received, [
      { command: 'exec-js', params: { tabId: TAB_1, code: 'window.scrollBy(0, 4000)' } },
      { command: 'navigate', params: { tabId: TAB_1, url: 'https://example.com/path' } },
      { command: 'exec-js', params: { tabId: TAB_1, code: 'history.back()' } },
      { command: 'exec-js', params: { tabId: TAB_1, code: 'history.forward()' } },
      { command: 'reload', params: { tabId: TAB_1 } },
      { command: 'activate-tab', params: { id: TAB_1 } },
    ]);
  });

  it('refuse en 400, sans parler a Mira : touche hors liste, texte trop long, file://', async () => {
    const cases: [unknown, RegExp][] = [
      [{ kind: 'key', key: 'F12' }, /key not allowed/],
      [{ kind: 'key', key: 'Enter', modifiers: ['fn'] }, /modifiers/],
      [{ kind: 'type', text: 'x'.repeat(MIRA_TEXT_MAX + 1) }, /too long/],
      [{ kind: 'type', text: '' }, /needs a text/],
      [{ kind: 'nav', url: 'file:///etc/passwd' }, /http or https/],
      [{ kind: 'nav', url: 'javascript:alert(1)' }, /http or https/],
      [{ kind: 'click', x: 'a', y: 2 }, /x and y/],
      [{ kind: 'scroll' }, /dy/],
      [{ kind: 'focus-app' }, /unknown action kind/],
      [{}, /unknown action kind/],
    ];
    for (const [body, re] of cases) {
      const res = await act(TAB_1, body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.json().code, 'BAD_REQUEST');
      assert.match(res.json().message, re);
    }
    assert.deepEqual(fake.received, [], 'rien n atteint la socket');
  });

  it('onglet inconnu : 404, socket absente : 503', async () => {
    const gone = await act('ferme', { kind: 'click', x: 1, y: 1 });
    assert.equal(gone.statusCode, 404);
    assert.equal(gone.json().code, 'MIRA_TAB_NOT_FOUND');
    process.env['MIRA_SOCKET'] = join(fake.dir, 'absent.sock');
    const down = await act(TAB_1, { kind: 'reload' });
    assert.equal(down.statusCode, 503);
    assert.equal(down.json().code, 'MIRA_UNAVAILABLE');
  });

  it('audit : un `mira.<kind>` par geste, la longueur du texte et l hote seulement', async () => {
    const secret = 'my-very-secret-password';
    await act(TAB_1, { kind: 'type', text: secret });
    await act(TAB_1, { kind: 'nav', url: 'https://bank.example.com/login?token=abc123' });
    await act(TAB_1, { kind: 'key', key: 'z' });
    await act(TAB_1, { kind: 'click', x: 10, y: 20 });
    const lines = auditLines();
    const typed = lines.filter((l) => l.action === 'mira.type').at(-1);
    assert.equal(typed?.result, 'ok');
    assert.equal(typed?.detail, `len=${secret.length}`);
    const nav = lines.filter((l) => l.action === 'mira.nav').at(-1);
    assert.equal(nav?.detail, 'host=bank.example.com');
    const key = lines.filter((l) => l.action === 'mira.key').at(-1);
    assert.equal(key?.detail, 'key=char');
    assert.equal(lines.filter((l) => l.action === 'mira.click').at(-1)?.detail, 'x=10 y=20');
    const raw = JSON.stringify(lines);
    assert.equal(raw.includes(secret), false, 'le texte tape n apparait jamais dans le journal');
    assert.equal(raw.includes('token=abc123'), false, 'l URL entiere n apparait jamais dans le journal');
  });
});

describe('validation pure', () => {
  it('isAllowedKey : la liste, plus un caractere imprimable seul', () => {
    for (const k of ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'a', 'Z', '1', '@', ' ']) {
      assert.equal(isAllowedKey(k), true, k);
    }
    for (const k of ['F12', 'Meta', 'Control', 'ab', '', '\x7f', '\n', 12, null]) {
      assert.equal(isAllowedKey(k), false, String(k));
    }
  });

  it('normalizeNavUrl : http(s) seulement, schema ajoute, le reste refuse', () => {
    assert.equal(normalizeNavUrl('example.com'), 'https://example.com/');
    assert.equal(normalizeNavUrl('  http://a.b/c?d=1 '), 'http://a.b/c?d=1');
    assert.equal(normalizeNavUrl('file:///etc/hosts'), null);
    assert.equal(normalizeNavUrl('chrome://settings'), null);
    assert.equal(normalizeNavUrl('javascript:alert(1)'), null);
    assert.equal(normalizeNavUrl(''), null);
    assert.equal(normalizeNavUrl('https://'), null);
    assert.equal(normalizeNavUrl(42), null);
  });

  it('parseMiraAction borne le defilement et arrondit le clic', () => {
    assert.deepEqual(parseMiraAction({ kind: 'scroll', dy: -12345 }), { action: { kind: 'scroll', dy: -4000 } });
    assert.deepEqual(parseMiraAction({ kind: 'scroll', dy: 12.6 }), { action: { kind: 'scroll', dy: 13 } });
    assert.deepEqual(parseMiraAction({ kind: 'click', x: 1.2, y: 3.7 }), { action: { kind: 'click', x: 1, y: 4 } });
    assert.deepEqual(parseMiraAction({ kind: 'key', key: 'Enter', modifiers: [] }), { action: { kind: 'key', key: 'Enter' } });
    assert.deepEqual(parseMiraAction(null), { error: 'unknown action kind' });
  });

  it('auditDetail ne porte jamais le contenu', () => {
    assert.equal(auditDetail({ kind: 'type', text: 'secret' }), 'len=6');
    assert.equal(auditDetail({ kind: 'nav', url: 'https://x.example.com/a?b=c' }), 'host=x.example.com');
    assert.equal(auditDetail({ kind: 'key', key: 'q', modifiers: ['meta'] }), 'key=char mods=meta');
    assert.equal(auditDetail({ kind: 'key', key: 'Enter' }), 'key=Enter');
    assert.equal(auditDetail({ kind: 'back' }), '');
  });
});
