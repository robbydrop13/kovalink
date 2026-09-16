// « Lu sur le telephone » remonte au Mac : une seule commande, `set-pane-unread`, et aucune
// erreur rendue a l'app. Le cas qui compte est le Kova ANTERIEUR a la commande : il repond
// `unknown command` et cela doit valoir un non evenement, pas une panne.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { ROUTES } from '@kovalink/protocol';
import type { Pane } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-paneread-'));
process.env['KOVALINK_QUIET'] = '1';

const { markPaneRead, resetTooOldNotice } = await import('../src/kova/read.js');
const { IpcError } = await import('../src/kova/ipc.js');

type Answer = { ok: boolean; error?: string } | Error;

/** Faux Kova : rend la reponse (ou leve l'erreur) donnee, et garde les commandes recues. */
function deps(answer: Answer, panes: number[] = [7]) {
  const requests: Record<string, unknown>[] = [];
  return {
    requests,
    services: {
      ipc: {
        request: async (payload: Record<string, unknown>) => {
          requests.push(payload);
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
      panes: { get: (id: number) => (panes.includes(id) ? ({ id } as Pane) : undefined) },
    },
  } as unknown as { requests: Record<string, unknown>[]; services: Parameters<typeof markPaneRead>[0] };
}

describe('markPaneRead', () => {
  it('emet exactement set-pane-unread {unread:false}, jamais un focus ni une action', async () => {
    const h = deps({ ok: true });
    assert.deepEqual(await markPaneRead(h.services, 7, 'dev'), { applied: true });
    assert.deepEqual(h.requests, [{ cmd: 'set-pane-unread', pane_id: 7, unread: false }]);
    // Ni `focus-pane` ni `dispatch-action` : ce sont eux qui levaient la fenetre du Mac et
    // retournaient le bit a l'envers.
    const cmds = h.requests.map((r) => r['cmd']);
    assert.equal(cmds.includes('focus-pane'), false);
    assert.equal(cmds.includes('dispatch-action'), false);
  });

  it('un pane inconnu ne fait rien partir vers Kova', async () => {
    const h = deps({ ok: true }, []);
    assert.deepEqual(await markPaneRead(h.services, 7, 'dev'), { applied: false, reason: 'pane_gone' });
    assert.deepEqual(h.requests, []);
  });

  it('un Kova trop ancien (unknown command) est un non evenement, jamais une erreur', async () => {
    resetTooOldNotice();
    const h = deps({ ok: false, error: 'unknown command: set-pane-unread' });
    assert.deepEqual(await markPaneRead(h.services, 7, 'dev'), { applied: false, reason: 'kova_too_old' });
    // Rejoue : toujours pas d'exception, et la commande reste la meme.
    assert.deepEqual(await markPaneRead(h.services, 7, 'dev'), { applied: false, reason: 'kova_too_old' });
    assert.equal(h.requests.length, 2);
  });

  it('IPC_UNSUPPORTED leve par le client vaut la meme degradation', async () => {
    resetTooOldNotice();
    const h = deps(new IpcError('IPC_UNSUPPORTED', 'unknown command: set-pane-unread'));
    assert.deepEqual(await markPaneRead(h.services, 7, 'dev'), { applied: false, reason: 'kova_too_old' });
  });

  it('Kova injoignable ou refus quelconque : applied false, motive, sans exception', async () => {
    const down = deps(new IpcError('KOVA_DOWN', 'Kova is unreachable'));
    assert.deepEqual(await markPaneRead(down.services, 7, 'dev'), { applied: false, reason: 'kova_down' });
    const refused = deps({ ok: false, error: 'pane 7 not found' });
    assert.deepEqual(await markPaneRead(refused.services, 7, 'dev'), { applied: false, reason: 'kova_refused' });
  });
});

describe('route POST /v1/panes/:paneId/read', () => {
  // La route vit dans `createHttpServer` (TLS, jeton, hub). On la remonte ici a l'identique
  // sur un Fastify nu, avec la meme garde d'identifiant et le meme appel.
  async function server(answer: Answer, panes: number[] = [7]) {
    const h = deps(answer, panes);
    const app = Fastify();
    app.post<{ Params: { paneId: string } }>(ROUTES.paneRead(0).replace('/0/', '/:paneId/'), async (req, reply) => {
      const paneId = Number(req.params.paneId);
      if (!Number.isInteger(paneId) || paneId < 0) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'paneId must be a non-negative integer' });
      }
      return markPaneRead(h.services, paneId, 'dev');
    });
    await app.ready();
    return { app, requests: h.requests };
  }

  it('200 applied true sur un pane connu', async () => {
    const { app, requests } = await server({ ok: true });
    const res = await app.inject({ method: 'POST', url: ROUTES.paneRead(7) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { applied: true });
    assert.deepEqual(requests, [{ cmd: 'set-pane-unread', pane_id: 7, unread: false }]);
    await app.close();
  });

  it('200 meme avec un Kova trop ancien : l app ne voit jamais d erreur', async () => {
    resetTooOldNotice();
    const { app } = await server({ ok: false, error: 'unknown command: set-pane-unread' });
    const res = await app.inject({ method: 'POST', url: ROUTES.paneRead(7) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { applied: false, reason: 'kova_too_old' });
    await app.close();
  });

  it('400 sur un identifiant qui n en est pas un', async () => {
    const { app, requests } = await server({ ok: true });
    const res = await app.inject({ method: 'POST', url: '/v1/panes/nope/read' });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(requests, []);
    await app.close();
  });
});
