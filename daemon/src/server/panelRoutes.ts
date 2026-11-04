import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ROUTE_PATTERNS,
  type AskSheetAnswerRequest,
  type AskSheetAnswerResponse,
  type AskSheetResponse,
  type ErrorCode,
  type ErrorPayload,
  type KovaPanelHistoryResponse,
} from '@kovalink/protocol';
import { audit } from '../audit.js';
import { AskError } from '../kova/asks.js';
import { IpcError } from '../kova/ipc.js';
import { readPanelHistory } from '../kova/panelHistory.js';
import type { Services } from './services.js';

function fail(reply: FastifyReply, status: number, code: ErrorCode, message: string): void {
  const payload: ErrorPayload = { code, message, retryable: code === 'KOVA_DOWN' || code === 'IPC_TIMEOUT' };
  void reply.code(status).send(payload);
}

/** Un refus de Kova ou du daemon, avec sa cause reelle : jamais un 500 muet. */
function sendAskError(reply: FastifyReply, e: unknown): void {
  if (e instanceof AskError) {
    const status = e.code === 'ASK_NOT_FOUND' ? 404 : e.code === 'KOVA_TOO_OLD' ? 501 : 400;
    return fail(reply, status, e.code, e.message);
  }
  if (e instanceof IpcError) return fail(reply, 502, e.code, e.message);
  return fail(reply, 500, 'INTERNAL', e instanceof Error ? e.message : String(e));
}

/**
 * Le panneau lateral sur le telephone : ce que Kova y a ouvert, et les fiches de
 * decisions natives. Trois routes. Aucune n'ecrit dans un pane ni dans un fichier de
 * Kova : la fiche est enregistree par Kova lui meme (`answer-sheet`).
 */
export function registerPanelRoutes(app: FastifyInstance, services: Services): void {
  /** L'historique du panneau de Kova, lu a chaque appel (50 lignes au plus). */
  app.get(ROUTE_PATTERNS.kovaPanelHistory, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'panes')) return fail(reply, 429, 'RATE_LIMITED', 'too many reads');
    const out: KovaPanelHistoryResponse = { entries: readPanelHistory() };
    return out;
  });

  /** Une fiche native et son brouillon. Meme seau que les lectures de questions. */
  app.get<{ Params: { askId: string } }>(ROUTE_PATTERNS.askSheet, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'panes')) return fail(reply, 429, 'RATE_LIMITED', 'too many sheet reads');
    try {
      const out: AskSheetResponse = await services.asks.sheet(req.params.askId);
      return out;
    } catch (e) {
      return sendAskError(reply, e);
    }
  });

  /**
   * Enregistrer (`done: false`) ou rendre (`done: true`) une fiche. Le brouillon part a
   * chaque modification, donc seul `done` est audite comme une reponse ; le contenu des
   * notes ne va jamais au journal (A14).
   */
  app.post<{ Params: { askId: string }; Body: Partial<AskSheetAnswerRequest> }>(
    ROUTE_PATTERNS.askSheet,
    async (req, reply) => {
      const deviceId = req.deviceId ?? '';
      const done = req.body?.done;
      if (!services.rate.allow(deviceId, done === true ? 'text' : 'panes')) {
        return fail(reply, 429, 'RATE_LIMITED', 'too many sheet answers');
      }
      const nonce = req.body?.nonce;
      if (done === true && typeof nonce === 'string' && nonce.length > 0 && !services.nonces.reserve(nonce)) {
        audit({ deviceId, action: 'ask.sheet', result: 'denied', detail: 'duplicate' });
        return fail(reply, 409, 'BAD_REQUEST', 'duplicate nonce');
      }
      const askId = req.params.askId;
      try {
        const out: AskSheetAnswerResponse = await services.asks.answerSheet(askId, req.body?.answers, done);
        if (out.done) {
          audit({
            deviceId,
            action: 'ask.sheet',
            result: 'ok',
            detail: `ask=${askId} answered=${out.answered}/${out.total}${out.followUp ? ` followUp=${out.followUp}` : ''}`,
          });
          await services.refreshAsks?.('sheet');
        }
        return out;
      } catch (e) {
        if (done === true) {
          if (typeof nonce === 'string') services.nonces.release(nonce);
          audit({ deviceId, action: 'ask.sheet', result: 'denied', detail: `ask=${askId} ${(e as Error).message}` });
        }
        return sendAskError(reply, e);
      }
    },
  );
}
