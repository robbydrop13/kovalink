import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ROUTE_PATTERNS,
  type AttentionActRequest,
  type AttentionGestureRequest,
  type AttentionResponse,
  type AttentionSnoozeRequest,
  type ErrorCode,
  type ErrorPayload,
} from '@kovalink/protocol';
import { audit } from '../audit.js';
import { AttentionError, type AttentionBoard } from '../attention.js';
import { logger } from '../logger.js';
import type { Services } from './services.js';

function fail(reply: FastifyReply, status: number, code: ErrorCode, message: string): void {
  const payload: ErrorPayload = { code, message, retryable: false };
  void reply.code(status).send(payload);
}

/**
 * Refus sur les routes de la file : 400 pour une requete hors format (rien n'a ete
 * lance), 404 pour une entree qui n'est plus ouverte, 409 pour un geste deja en cours,
 * 502 quand `attn` echoue. La sortie de `attn` ne part JAMAIS vers l'app : elle reste
 * dans le journal local. Seule exception, le refus d'un geste du Cockpit (code 4).
 */
function failAttention(reply: FastifyReply, e: AttentionError, id: string): void {
  if (e.reason === 'bad_request') return fail(reply, 400, 'BAD_REQUEST', e.message);
  if (e.reason === 'not_found') return fail(reply, 404, 'ATTENTION_NOT_FOUND', e.message);
  if (e.reason === 'busy') return fail(reply, 409, 'ATTENTION_BUSY', e.message);
  if (e.reason === 'already_sent') return fail(reply, 409, 'ATTENTION_ALREADY_SENT', e.message);
  if (e.reason === 'not_offered') return fail(reply, 409, 'ATTENTION_GESTURE_NOT_OFFERED', e.message);
  // La seule sortie d'`attn` qui part vers l'app : sa ligne de refus, ecrite pour Robin
  // (« Non transmis : <ligne> »), deja nettoyee et bornee par `gestureOutcome`.
  if (e.reason === 'refused') return fail(reply, 409, 'ATTENTION_REFUSED', e.message);
  if (e.reason === 'card_changed') return fail(reply, 409, 'ATTENTION_CARD_CHANGED', e.message);
  logger.warn('attn en echec', { id, err: e.message });
  return fail(reply, 502, 'ATTENTION_ERROR', 'attn failed');
}

/**
 * File d'attention, pilotee par le CLI `attn` : la lecture des entrees ouvertes et un
 * geste sur une entree. L'argv est construit par le daemon depuis une liste fermee de
 * boutons ; l'app ne fournit qu'un identifiant valide et, pour `Envoyer`, un texte borne.
 *
 * `board` est passe a part de `services` pour que les tests montent ces routes seules.
 */
export function registerAttentionRoutes(
  app: FastifyInstance,
  services: Pick<Services, 'rate' | 'nonces' | 'refreshAttention'>,
  board: AttentionBoard,
): void {
  app.get(ROUTE_PATTERNS.attention, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'attention')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many attention reads');
    }
    try {
      const body: AttentionResponse = { entries: await board.list() };
      return body;
    } catch (e) {
      if (!(e instanceof AttentionError)) throw e;
      audit({ deviceId, action: 'attention.list', result: 'error', detail: e.reason });
      return failAttention(reply, e, 'list');
    }
  });

  /** `Envoyer` -> `attn act`, `Fait` et `Ignorer` -> `attn close`. `Ouvrir` est refuse. */
  app.post<{ Params: { id: string }; Body: Partial<AttentionActRequest> }>(
    ROUTE_PATTERNS.attentionAct,
    async (req, reply) => {
      const deviceId = req.deviceId ?? '';
      if (!services.rate.allow(deviceId, 'attention')) {
        return fail(reply, 429, 'RATE_LIMITED', 'too many attention actions');
      }
      const id = req.params.id;
      const { button, text, nonce } = req.body ?? {};
      if (typeof nonce === 'string' && nonce.length > 0 && !services.nonces.reserve(nonce)) {
        audit({ deviceId, action: 'attention.act', result: 'denied', detail: `id=${id.slice(0, 16)} duplicate` });
        return fail(reply, 409, 'BAD_REQUEST', 'duplicate nonce');
      }
      try {
        const res = await board.act(id, button, text);
        audit({
          deviceId,
          action: `attention.${res.op}`,
          result: 'ok',
          // Le texte ne va PAS au journal, seulement sa longueur : c'est du contenu.
          detail: `id=${id} button=${String(button)} len=${typeof text === 'string' ? text.length : 0}`,
        });
        // La pastille et le message `asks` comptent les entrees `now` : relues tout de suite,
        // sans faire attendre la reponse (le telephone coupe a 25 s).
        void services.refreshAttention?.('act');
        return res;
      } catch (e) {
        if (typeof nonce === 'string') services.nonces.release(nonce);
        if (!(e instanceof AttentionError)) throw e;
        const denied = e.reason !== 'attn_failed';
        // L'identifiant n'est journalise que tronque : un refus porte peut-etre n'importe quoi.
        audit({
          deviceId,
          action: 'attention.act',
          result: denied ? 'denied' : 'error',
          detail: `id=${id.slice(0, 16)} ${e.reason}`,
        });
        return failAttention(reply, e, id.slice(0, 16));
      }
    },
  );

  /**
   * Un nonce rejoue est refuse sans rien lancer, comme `act`. Rend `false` quand la
   * requete s'arrete la.
   */
  function reserveNonce(reply: FastifyReply, deviceId: string, action: string, id: string, nonce: unknown): boolean {
    if (typeof nonce !== 'string' || nonce.length === 0 || services.nonces.reserve(nonce)) return true;
    audit({ deviceId, action, result: 'denied', detail: `id=${id.slice(0, 16)} duplicate` });
    fail(reply, 409, 'BAD_REQUEST', 'duplicate nonce');
    return false;
  }

  /** Un refus ou un echec d'un geste du Cockpit ou d'un report : nonce rendu, journal, reponse. */
  function failGesture(
    reply: FastifyReply,
    e: unknown,
    deviceId: string,
    action: string,
    id: string,
    nonce: unknown,
  ): void {
    if (typeof nonce === 'string') services.nonces.release(nonce);
    if (!(e instanceof AttentionError)) throw e;
    audit({
      deviceId,
      action,
      result: e.reason === 'attn_failed' ? 'error' : 'denied',
      detail: `id=${id.slice(0, 16)} ${e.reason}`,
    });
    return failAttention(reply, e, id.slice(0, 16));
  }

  /** Un des sept gestes du Cockpit, s'il est offert par la carte -> `attn act`, forme de Kova. */
  app.post<{ Params: { id: string }; Body: Partial<AttentionGestureRequest> }>(
    ROUTE_PATTERNS.attentionGesture,
    async (req, reply) => {
      const deviceId = req.deviceId ?? '';
      if (!services.rate.allow(deviceId, 'attention')) {
        return fail(reply, 429, 'RATE_LIMITED', 'too many attention actions');
      }
      const id = req.params.id;
      const { gesture, text, seen, draft, cardSeen, clientId, nonce } = req.body ?? {};
      if (!reserveNonce(reply, deviceId, 'attention.gesture', id, nonce)) return;
      try {
        const res = await board.gesture(id, { gesture, text, seen, draft, cardSeen, clientId });
        audit({
          deviceId,
          action: 'attention.gesture',
          result: 'ok',
          // Ni le texte ni le brouillon ne vont au journal, seulement leur longueur.
          detail:
            `id=${id} gesture=${String(gesture)} outcome=${res.outcome}` +
            ` len=${typeof text === 'string' ? text.length : 0} draft=${typeof draft === 'string' ? draft.length : 0}`,
        });
        void services.refreshAttention?.('gesture');
        return res;
      } catch (e) {
        // Un refus ou une carte changee a peut-etre fait bouger la file : relue aussi.
        if (e instanceof AttentionError && (e.reason === 'refused' || e.reason === 'card_changed')) {
          void services.refreshAttention?.('gesture');
        }
        return failGesture(reply, e, deviceId, 'attention.gesture', id, nonce);
      }
    },
  );

  /** Reporter une carte ouverte a une date -> `attn snooze --until`. */
  app.post<{ Params: { id: string }; Body: Partial<AttentionSnoozeRequest> }>(
    ROUTE_PATTERNS.attentionSnooze,
    async (req, reply) => {
      const deviceId = req.deviceId ?? '';
      if (!services.rate.allow(deviceId, 'attention')) {
        return fail(reply, 429, 'RATE_LIMITED', 'too many attention actions');
      }
      const id = req.params.id;
      const { until, nonce } = req.body ?? {};
      if (!reserveNonce(reply, deviceId, 'attention.snooze', id, nonce)) return;
      try {
        const res = await board.snooze(id, until);
        audit({ deviceId, action: 'attention.snooze', result: 'ok', detail: `id=${id} until=${String(until)}` });
        void services.refreshAttention?.('snooze');
        return res;
      } catch (e) {
        return failGesture(reply, e, deviceId, 'attention.snooze', id, nonce);
      }
    },
  );
}
