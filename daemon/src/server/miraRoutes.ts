import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ROUTE_PATTERNS,
  type ErrorCode,
  type ErrorPayload,
  type MiraActResponse,
  type MiraTabsResponse,
} from '@kovalink/protocol';
import { audit } from '../audit.js';
import { auditDetail, parseMiraAction } from '../mira/actions.js';
import { MiraError, MiraUnavailable, actOnMiraTab, captureMiraFrame, listMiraTabs } from '../mira/client.js';
import type { Services } from './services.js';

function fail(reply: FastifyReply, status: number, code: ErrorCode, message: string): void {
  const payload: ErrorPayload = { code, message, retryable: code === 'MIRA_UNAVAILABLE' };
  void reply.code(status).send(payload);
}

/**
 * Erreur venue de la socket : 503 quand Mira ne tourne pas, 404 quand l'onglet a ete
 * ferme entre deux appels, 502 sinon avec le message de Mira mot pour mot.
 */
function sendMiraError(reply: FastifyReply, e: unknown): void {
  if (e instanceof MiraUnavailable) return fail(reply, 503, 'MIRA_UNAVAILABLE', 'Mira is not running on the Mac');
  if (e instanceof MiraError) {
    if (e.unknownTab) return fail(reply, 404, 'MIRA_TAB_NOT_FOUND', e.message);
    return fail(reply, 502, 'MIRA_ERROR', e.message);
  }
  return fail(reply, 500, 'INTERNAL', e instanceof Error ? e.message : String(e));
}

function resultOf(e: unknown): 'denied' | 'error' {
  return e instanceof MiraUnavailable || (e instanceof MiraError && e.unknownTab) ? 'denied' : 'error';
}

/**
 * Routes du navigateur : le miroir de Mira sur l'iPhone. Trois routes.
 *
 * Elles ne dependent pas de Kova. Et aucune n'appelle `focus-app` : un geste venu du
 * telephone ne met jamais Mira devant ce que Robin fait sur le Mac.
 */
export function registerMiraRoutes(app: FastifyInstance, services: Services): void {
  app.get(ROUTE_PATTERNS.miraTabs, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'panes')) return fail(reply, 429, 'RATE_LIMITED', 'too many tab listings');
    try {
      const body: MiraTabsResponse = { available: true, tabs: await listMiraTabs() };
      return body;
    } catch (e) {
      // Mira absent n'est pas une erreur : l'app affiche « Mira is not running ».
      if (e instanceof MiraUnavailable) {
        const body: MiraTabsResponse = { available: false, tabs: [] };
        return body;
      }
      return sendMiraError(reply, e);
    }
  });

  app.get<{ Params: { tabId: string } }>(ROUTE_PATTERNS.miraFrame, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'miraShot')) return fail(reply, 429, 'RATE_LIMITED', 'too many captures');
    try {
      const frame = await captureMiraFrame(req.params.tabId);
      reply.header('cache-control', 'no-store');
      return frame;
    } catch (e) {
      return sendMiraError(reply, e);
    }
  });

  app.post<{ Params: { tabId: string }; Body: unknown }>(ROUTE_PATTERNS.miraAct, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'miraAct')) return fail(reply, 429, 'RATE_LIMITED', 'too many actions');
    const parsed = parseMiraAction(req.body);
    if ('error' in parsed) {
      audit({ deviceId, action: 'mira.act', result: 'denied', detail: parsed.error });
      return fail(reply, 400, 'BAD_REQUEST', parsed.error);
    }
    const { action } = parsed;
    try {
      await actOnMiraTab(req.params.tabId, action);
      audit({ deviceId, action: `mira.${action.kind}`, result: 'ok', detail: auditDetail(action) });
      const body: MiraActResponse = { ok: true };
      return body;
    } catch (e) {
      audit({ deviceId, action: `mira.${action.kind}`, result: resultOf(e), detail: e instanceof Error ? e.message.slice(0, 160) : 'INTERNAL' });
      return sendMiraError(reply, e);
    }
  });
}
