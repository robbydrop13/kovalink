import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  PROTOCOL_VERSION,
  PUBLIC_ROUTE_PATHS,
  ROUTE_PATTERNS,
  TERMINAL_MAX_KEYS,
  isKeyName,
  TURNS_INITIAL_LOAD,
  TURNS_PAGE_SIZE,
  TURNS_QUERY,
  TURN_END_SUMMARY_MAX,
  WS_CLOSE_CODE,
  type ErrorCode,
  type ErrorPayload,
  type KovaLaunchResponse,
  type KovaNewTabRequest,
  type KovaNewTabResponse,
  type KovaSplitRequest,
  type KovaSplitResponse,
  type KovaRecentProjectsResponse,
  type KovaResumeRequest,
  type KovaBookmarkRequest,
  type KovaBookmarkResponse,
  type PaneReadResponse,
  type PaneTitleRequest,
  type PaneTitleResponse,
  type ReorderRequest,
  type PaneSessionNameRequest,
  type PaneSessionNameResponse,
  type PaneCommandsResponse,
  TRANSCRIBE_MAX_BYTES,
  TRANSCRIBE_MIME_TYPES,
  type TranscribeResponse,
  type KovaSessionsResponse,
  type Prompt,
  type Turn,
} from '@kovalink/protocol';
import { audit } from '../audit.js';
import { consumePairing, readPairing } from '../pairing.js';
import { ForbiddenError } from '../kova/keygate.js';
import { IpcError } from '../kova/ipc.js';
import { logger } from '../logger.js';
import { transcriptPath } from '../paths.js';
import { formatTurnEndSubtitle } from '../turnEnd.js';
import { buildTurns, sortAssistantBlocks } from '../transcript/jsonl.js';
import { readTailLines } from '../transcript/session.js';
import {
  loadDevices,
  mintToken,
  saveDevices,
  timingSafeEqualStr,
  verifyBearer,
} from '../security/token.js';
import type { TlsMaterial } from '../security/tls.js';
import type { UploadStore } from '../fs/uploads.js';
import { listRecentProjects, resolveRecentProject } from '../fs/quickdests.js';
import { listCommands } from '../claude/commands.js';
import { findSession, listSessions } from '../kova/sessions.js';
import { NEW_TAB_COMMAND, launchInFreshPane, resumeSession, startClaudeInPane } from '../kova/resume.js';
import { ManageError, closePane, renameCommand, renameTab, sanitizeSessionName, setBookmark } from '../kova/manage.js';
import { reorderPane, reorderTab } from '../kova/reorder.js';
import { markPaneRead } from '../kova/read.js';
import { TranscriptionError, transcribe } from '../voice/whisper.js';
import { registerFsRoutes } from './fsRoutes.js';
import { registerMiraRoutes } from './miraRoutes.js';
import { Hub, type Socket } from './hub.js';
import type { Services } from './services.js';

/** Fenetre de lecture d'une page d'historique, doublee jusqu'au plafond si elle est vide. */
const TURNS_PAGE_BYTES = 256 * 1024;
const TURNS_PAGE_BYTES_MAX = 4 * 1024 * 1024;

declare module 'fastify' {
  interface FastifyRequest {
    deviceId?: string;
  }
}

const PUBLIC_ROUTES = new Set<string>(PUBLIC_ROUTE_PATHS);

function fail(reply: FastifyReply, status: number, code: ErrorCode, message: string): void {
  const payload: ErrorPayload = {
    code,
    message,
    retryable: code === 'KOVA_DOWN' || code === 'IPC_TIMEOUT',
  };
  void reply.code(status).send(payload);
}

/**
 * Serveur HTTPS et WebSocket.
 *
 * Une instance par adresse d'ecoute : loopback et interface Tailscale, exclusivement
 * (`resolveBinds`). `0.0.0.0` et `::` n'apparaissent nulle part.
 */
export async function createHttpServer(
  services: Services,
  hub: Hub,
  tls: TlsMaterial,
  uploads: UploadStore,
): Promise<FastifyInstance> {
  const app = Fastify({
    https: { key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' },
    logger: {
      level: 'warn',
      // Redaction non negociable (C8) : le jeton n'apparait dans AUCUN log.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.query.ticket',
          '*.token',
          '*.pairingCode',
          '*.expoPushToken',
        ],
        remove: true,
      },
    },
    trustProxy: false,
    bodyLimit: 256 * 1024,
  });

  // Un `POST` sans corps mais avec `content-type: application/json` faisait rendre a
  // Fastify un 500 « Body cannot be empty ». Aucune de nos routes n'exige un corps :
  // un corps vide vaut un objet vide, et toutes lisent deja `req.body ?? {}`.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string | Buffer, done) => {
      const text = typeof body === 'string' ? body.trim() : body.toString('utf8').trim();
      if (text.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(text) as unknown);
      } catch (e) {
        const err = e as Error & { statusCode?: number; code?: string };
        err.statusCode = 400;
        err.code = 'BAD_REQUEST';
        done(err, undefined);
      }
    },
  );

  const websocket = (await import('@fastify/websocket')).default;
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  // Toute reponse d'erreur porte un `ErrorPayload`, y compris celles que Fastify produit
  // lui meme. Sans ces deux gestionnaires, un 404 rend `{message,error,statusCode}` sans
  // champ `code` : l'app lisait alors `INTERNAL` et affichait « Mac injoignable » pour une
  // route qui n'existait simplement pas. Une divergence de contrat doit se DIRE.
  app.setNotFoundHandler((req, reply) => {
    fail(reply, 404, 'BAD_REQUEST', `route inconnue: ${req.method} ${req.url.split('?')[0] ?? ''}`);
  });
  app.setErrorHandler((err: unknown, req, reply) => {
    const e = err as { code?: unknown; message?: unknown };
    const code = (typeof e.code === 'string' ? e.code : 'INTERNAL') as ErrorCode;
    const message = typeof e.message === 'string' ? e.message : String(err);
    const known = code === 'BAD_REQUEST' || code === 'FORBIDDEN_ACTION';
    logger.warn('route en echec', { url: req.url.split('?')[0], err: message });
    // Le message reel remonte : un 500 muet coute des heures de diagnostic.
    fail(reply, known ? 400 : 500, known ? code : 'INTERNAL', message);
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0] ?? '';
    if (PUBLIC_ROUTES.has(url)) return;

    const bearer = req.headers.authorization;
    const verdict = verifyBearer(bearer, services.master, loadDevices());
    if (!verdict.ok) {
      const deviceId = (bearer ?? '').split('.')[0] ?? 'inconnu';
      services.authFailures.record(deviceId);
      audit({ action: 'auth', result: 'denied', detail: verdict.code });
      return fail(reply, 401, verdict.code, 'authentication refused');
    }
    if (services.authFailures.blocked(verdict.deviceId)) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many authentication failures');
    }
    services.authFailures.clear(verdict.deviceId);
    req.deviceId = verdict.deviceId;
  });

  // --- Routes ------------------------------------------------------------

  /** Sans auth. `ok` et le numero de protocole, RIEN d'autre : ni version ni hostname. */
  app.get(ROUTE_PATTERNS.health, async () => ({ ok: true, protocol: PROTOCOL_VERSION }));

  /**
   * Appairage. Le code est a usage unique, TTL `PAIRING_TTL_MS` (5 min), affiche hors bande par
   * `kovalinkd pair` (QR dans le terminal).
   */
  app.post(ROUTE_PATTERNS.pairClaim, async (req, reply) => {
    const body = (req.body ?? {}) as { pairingCode?: string; deviceName?: string };
    const pairing = readPairing();
    if (!pairing) {
      audit({ action: 'pair.claim', result: 'denied', detail: 'no_active_code' });
      return fail(reply, 403, 'UNAUTHORIZED', 'no pairing in progress');
    }
    // Usage unique : consomme immediatement, quoi qu'il arrive ensuite.
    consumePairing();
    if (typeof body.pairingCode !== 'string' || body.pairingCode.length !== pairing.code.length) {
      audit({ action: 'pair.claim', result: 'denied', detail: 'bad_code' });
      return fail(reply, 403, 'UNAUTHORIZED', 'invalid pairing code');
    }
    if (!timingSafeEqualStr(body.pairingCode, pairing.code)) {
      audit({ action: 'pair.claim', result: 'denied', detail: 'bad_code' });
      return fail(reply, 403, 'UNAUTHORIZED', 'invalid pairing code');
    }

    const { deviceId, exp, bearer } = mintToken(services.master);
    const devices = loadDevices();
    devices[deviceId] = {
      deviceId,
      name: typeof body.deviceName === 'string' ? body.deviceName.slice(0, 64) : 'iPhone',
      pairedAt: new Date().toISOString(),
      exp,
      revoked: false,
    };
    saveDevices(devices);
    audit({ deviceId, action: 'pair.claim', result: 'ok' });
    return {
      deviceId,
      token: bearer,
      tsDns: services.cfg().tsDns,
      port: services.cfg().port,
      protocol: PROTOCOL_VERSION,
    };
  });

  /** Revocation immediate : le jeton ne vaut plus rien et les WS sont coupes. */
  app.delete<{ Params: { deviceId: string } }>(ROUTE_PATTERNS.pairDevice, async (req) => {
    const devices = loadDevices();
    const target = devices[req.params.deviceId];
    if (target) {
      target.revoked = true;
      delete target.expoPushToken;
      saveDevices(devices);
      hub.dropDevice(req.params.deviceId);
    }
    audit({ deviceId: req.deviceId, action: 'pair.revoke', result: 'ok', detail: req.params.deviceId });
    return { revoked: !!target };
  });

  app.get(ROUTE_PATTERNS.panes, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'panes')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many reads');
    }
    return {
      panes: services.panes.all(),
      tabs: services.panes.allTabs(),
      etag: services.panes.etag,
    };
  });

  /**
   * Route de la Notification Service Extension. La reference est opaque : elle ne
   * revele ni le `paneId`, ni le `cwd`, ni le nom du projet, et elle vaut jusqu'a
   * resolution du prompt ou 10 minutes (R3), pas un seul usage.
   */
  app.get<{ Params: { promptRef: string } }>(ROUTE_PATTERNS.prompt, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'prompt')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many prompt reads');
    }
    const entry = services.refs.resolve(req.params.promptRef);
    if (!entry) {
      // Compte dans `nse_failed` : c'est exactement le cas ou la NSE retombe sur la
      // banniere aveugle. Le compteur de l'onglet Diagnostic mesure ce chemin, pas une
      // estimation.
      audit({ deviceId: req.deviceId, action: 'prompt.fetch', result: 'denied', detail: 'ref_expiree' });
      return fail(reply, 404, 'SESSION_NOT_FOUND', 'unknown or expired reference');
    }

    const pane = services.panes.get(entry.paneId);
    if (!pane) {
      audit({ deviceId: req.deviceId, action: 'prompt.fetch', result: 'denied', detail: 'pane_ferme' });
      return fail(reply, 404, 'PANE_NOT_FOUND', 'pane closed');
    }
    audit({ deviceId: req.deviceId, action: 'prompt.fetch', paneId: pane.id, result: 'ok' });

    // Une question attend (detectee par `PromptDetector`) : c'est elle que la NSE doit
    // afficher, `parsed` ou `unparsable`, jamais une fin de tour reconstruite. Sinon, on
    // sert l'etat de fin de tour depuis le JSONL.
    if (pane.awaiting && pane.awaiting_since) {
      const current = await services.prompts.current(pane.id, pane.awaiting_since);
      if (current.state === 'parsed' || current.state === 'unparsable') {
        return { ...current, promptRef: req.params.promptRef };
      }
    }
    if (entry.sessionId) {
      const lines = readTailLines(transcriptPath(pane.cwd, entry.sessionId));
      const turns = buildTurns(sortAssistantBlocks(lines));
      const last = [...turns].reverse().find((t) => t.kind === 'assistant');
      const text = last?.blocks.find((b) => b.type === 'text');
      const toolCount = last?.blocks.filter((b) => b.type === 'tool_use').length ?? 0;
      const prompt: Prompt = {
        state: 'turn_end',
        paneId: pane.id,
        sessionId: entry.sessionId,
        endedAt: last?.ts ?? new Date().toISOString(),
        summary: text && text.type === 'text' ? text.text.slice(0, TURN_END_SUMMARY_MAX) : '',
        subtitle: formatTurnEndSubtitle(null, toolCount),
        toolCount,
        durationMs: null,
        promptRef: req.params.promptRef,
      };
      return prompt;
    }
    return services.prompts.current(pane.id, pane.awaiting_since);
  });

  app.post<{ Params: { paneId: string }; Body: { nonce?: string } }>(
    ROUTE_PATTERNS.paneInterrupt,
    async (req, reply) => {
      const deviceId = req.deviceId ?? '';
      if (!services.rate.allow(deviceId, 'interrupt')) {
        return fail(reply, 429, 'RATE_LIMITED', 'too many interrupts');
      }
      const nonce = req.body?.nonce;
      if (typeof nonce !== 'string' || nonce.length === 0) {
        return fail(reply, 400, 'BAD_REQUEST', 'nonce required');
      }
      if (!services.nonces.reserve(nonce)) return { applied: false, reason: 'duplicate' };
      try {
        const res = await services.keygate.emitInterrupt(Number(req.params.paneId), deviceId);
        if (!res.applied) services.nonces.release(nonce);
        return res;
      } catch (e) {
        services.nonces.release(nonce);
        throw e;
      }
    },
  );

  /**
   * Fermer un pane (le seul geste destructeur de l'app, confirme cote app avec l'etat
   * reel du pane). `close-tab` si le pane est seul dans son onglet, `close-pane` sinon.
   * Nonce : un double tap ne ferme pas deux panes. Aucune touche n'est emise.
   */
  app.post<{ Params: { paneId: string }; Body: { nonce?: string } }>(ROUTE_PATTERNS.paneClose, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'interrupt')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many close requests');
    }
    const nonce = req.body?.nonce;
    if (typeof nonce !== 'string' || nonce.length === 0) return fail(reply, 400, 'BAD_REQUEST', 'nonce required');
    if (!services.nonces.reserve(nonce)) return { applied: false, reason: 'duplicate' };
    try {
      const res = await closePane(services, Number(req.params.paneId), deviceId);
      if (!res.applied) services.nonces.release(nonce);
      return res;
    } catch (e) {
      services.nonces.release(nonce);
      if (e instanceof ManageError) return fail(reply, e.code === 'PANE_NOT_FOUND' ? 404 : 400, e.code, e.message);
      throw e;
    }
  });

  /** Renommer l'onglet du pane (`set-tab-title`), titre assaini ici, `null` pour le titre automatique. */
  app.post<{ Params: { paneId: string }; Body: Partial<PaneTitleRequest> }>(ROUTE_PATTERNS.paneTitle, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'text')) return fail(reply, 429, 'RATE_LIMITED', 'too many renames');
    try {
      const res: PaneTitleResponse = await renameTab(services, Number(req.params.paneId), req.body?.title ?? null, deviceId);
      return res;
    } catch (e) {
      if (e instanceof ManageError) return fail(reply, e.code === 'PANE_NOT_FOUND' ? 404 : 400, e.code, e.message);
      throw e;
    }
  });

  /**
   * « Lu » : le pendant en ECRITURE du bit `unread` de Kova. Le pane que Robin vient de
   * lire sur le telephone cesse de tirer la pastille Next du MAC (`set-pane-unread`, qui
   * ne focalise rien et ne leve aucune fenetre). Meme seau que les lectures de panes :
   * c'est un echo d'affichage, pas un lancement.
   *
   * Cette route ne rend JAMAIS d'erreur a l'app : pane ferme, Kova trop ancien ou
   * injoignable valent 200 avec `applied:false` et leur raison. L'app a deja marque le
   * pane lu chez elle, et un toast pour ca serait du bruit.
   */
  app.post<{ Params: { paneId: string } }>(ROUTE_PATTERNS.paneRead, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'panes')) return fail(reply, 429, 'RATE_LIMITED', 'too many read marks');
    const paneId = Number(req.params.paneId);
    if (!Number.isInteger(paneId) || paneId < 0) {
      return fail(reply, 400, 'BAD_REQUEST', 'paneId must be a non-negative integer');
    }
    const res: PaneReadResponse = await markPaneRead(services, paneId, deviceId);
    return res;
  });

  /**
   * Reordonner un onglet parmi ceux de sa fenetre (`move-tab`). Meme seau que le
   * renommage : c'est une retouche de mise en page, pas un lancement. Un Kova sans la
   * commande rend 501 `KOVA_TOO_OLD` ; la relecture immediate de la mise en page suit.
   */
  app.post<{ Params: { tabId: string }; Body: Partial<ReorderRequest> }>(ROUTE_PATTERNS.tabReorder, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'text')) return fail(reply, 429, 'RATE_LIMITED', 'too many reorders');
    const out = await reorderTab(services, Number(req.params.tabId), req.body?.index, deviceId);
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    return out.response;
  });

  /**
   * Reordonner un pane parmi ceux de son onglet : une chaine de `swap-pane` voisins, dans
   * l'ordre de `list-panes`. Le pane ne change jamais d'onglet. Une chaine interrompue
   * rend 502 avec le nombre d'echanges appliques.
   */
  app.post<{ Params: { paneId: string }; Body: Partial<ReorderRequest> }>(ROUTE_PATTERNS.paneReorder, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'text')) return fail(reply, 429, 'RATE_LIMITED', 'too many reorders');
    const out = await reorderPane(services, Number(req.params.paneId), req.body?.index, deviceId);
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    return out.response;
  });

  /**
   * Renommage au sens Claude : `/rename <name>` dans le pane, via KeyGate comme un texte
   * avec Entree. Seulement sur un pane `claude` sans prompt parse en attente (KeyGate
   * refuse `became_awaiting` sinon). Le nom apparait dans `agent_session_name` de Kova.
   */
  app.post<{ Params: { paneId: string }; Body: Partial<PaneSessionNameRequest> }>(
    ROUTE_PATTERNS.paneSessionName,
    async (req, reply) => {
      const deviceId = req.deviceId ?? '';
      if (!services.rate.allow(deviceId, 'text')) return fail(reply, 429, 'RATE_LIMITED', 'too many renames');
      const paneId = Number(req.params.paneId);
      const pane = services.panes.get(paneId);
      if (!pane) return fail(reply, 404, 'PANE_NOT_FOUND', 'unknown pane');
      if (pane.agent !== 'claude') return fail(reply, 400, 'FORBIDDEN_ACTION', 'session names exist only for a claude pane');
      let name: string;
      try {
        name = sanitizeSessionName(req.body?.name);
      } catch (e) {
        if (e instanceof ManageError) return fail(reply, 400, e.code, e.message);
        throw e;
      }
      try {
        const res = await services.keygate.emitText(paneId, renameCommand(name), deviceId);
        audit({ deviceId, action: 'pane.sessionName', paneId, result: res.applied ? 'ok' : 'denied', detail: res.applied ? `len=${name.length}` : (res.reason ?? 'refused') });
        const out: PaneSessionNameResponse = { ...res, name };
        return out;
      } catch (e) {
        if (e instanceof ForbiddenError) return fail(reply, 403, e.code, e.message);
        throw e;
      }
    },
  );

  /** Favori : ajout ou retrait dans `bookmarks.json` de Kova, identifiant resolu par l'index. */
  app.post<{ Body: Partial<KovaBookmarkRequest> }>(ROUTE_PATTERNS.kovaBookmark, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'text')) return fail(reply, 429, 'RATE_LIMITED', 'too many bookmark changes');
    const op = req.body?.op;
    if (op !== 'add' && op !== 'remove') return fail(reply, 400, 'BAD_REQUEST', 'op must be add or remove');
    const session = findSession(req.body?.sessionId, services.panes.all(), services.panes.allTabs());
    if (!session) return fail(reply, 404, 'SESSION_NOT_FOUND', 'unknown session');
    try {
      const res: KovaBookmarkResponse = setBookmark(op, { sessionId: session.sessionId, cwd: session.cwd, label: session.title }, deviceId);
      return res;
    } catch (e) {
      if (e instanceof ManageError) return fail(reply, 400, e.code, e.message);
      throw e;
    }
  });

  app.post<{ Params: { paneId: string }; Body: { text?: string; nonce?: string } }>(
    ROUTE_PATTERNS.paneText,
    async (req, reply) => {
      const deviceId = req.deviceId ?? '';
      if (!services.rate.allow(deviceId, 'text')) {
        return fail(reply, 429, 'RATE_LIMITED', 'too many sends');
      }
      const { text, nonce } = req.body ?? {};
      if (typeof text !== 'string' || typeof nonce !== 'string') {
        return fail(reply, 400, 'BAD_REQUEST', 'text and nonce required');
      }
      if (!services.nonces.reserve(nonce)) return { applied: false, reason: 'duplicate' };
      try {
        const res = await services.keygate.emitText(Number(req.params.paneId), text, deviceId);
        if (!res.applied) services.nonces.release(nonce);
        return res;
      } catch (e) {
        services.nonces.release(nonce);
        if (e instanceof ForbiddenError) return fail(reply, 403, e.code, e.message);
        throw e;
      }
    },
  );

  /**
   * Repondre a un prompt parse (C1, C20).
   *
   * `answerPrompt` relit le pane, recompare le `promptHash` a temps constant et
   * l'`awaitingSince`, verifie que l'`optionIndex` existe, puis emet UN SEUL `send-keys`
   * atomique. Si l'ecran a change : 409 `PROMPT_CHANGED`, rien n'est envoye. Les autres
   * refus (`duplicate`, `not_awaiting`, `pane_gone`) rendent `applied: false` avec leur
   * raison, comme `interrupt` et `text`.
   */
  app.post<{
    Params: { paneId: string };
    Body: { optionIndex?: number; promptHash?: string; awaitingSince?: string; nonce?: string };
  }>(ROUTE_PATTERNS.paneAnswer, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'answer')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many answers');
    }
    const { optionIndex, promptHash, awaitingSince, nonce } = req.body ?? {};
    if (
      typeof optionIndex !== 'number' ||
      !Number.isInteger(optionIndex) ||
      typeof promptHash !== 'string' ||
      typeof awaitingSince !== 'string' ||
      typeof nonce !== 'string' ||
      nonce.length === 0
    ) {
      return fail(reply, 400, 'BAD_REQUEST', 'optionIndex, promptHash, awaitingSince and nonce required');
    }
    try {
      const res = await services.answer(
        { paneId: Number(req.params.paneId), optionIndex, promptHash, awaitingSince, nonce },
        deviceId,
      );
      if (!res.applied && res.reason === 'prompt_changed') {
        return fail(
          reply,
          409,
          'PROMPT_CHANGED',
          'la question affichee n est plus celle du pane, aucun octet n a ete envoye',
        );
      }
      return res;
    } catch (e) {
      if (e instanceof ForbiddenError) return fail(reply, 403, e.code, e.message);
      throw e;
    }
  });

  /** Les commandes `/` de Claude Code visibles depuis le `cwd` du pane, pour l'autocompletion. */
  app.get<{ Params: { paneId: string } }>(ROUTE_PATTERNS.paneCommands, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'panes')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many reads');
    }
    const pane = services.panes.get(Number(req.params.paneId));
    if (!pane) return fail(reply, 404, 'PANE_NOT_FOUND', 'unknown pane');
    const res: PaneCommandsResponse = { commands: listCommands(pane.cwd) };
    return res;
  });

  /**
   * `Start Claude here` sur un pane qui n'est qu'un shell. Meme seau que `new-tab` et
   * `split` : c'est un lancement. Le refus d'un pane occupe (409 `PANE_BUSY`) est decide
   * dans `startClaudeInPane`, avant toute touche.
   */
  app.post<{ Params: { paneId: string }; Body: { mode?: unknown } | undefined }>(ROUTE_PATTERNS.paneStartClaude, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    // `mode: 'resume'` : Kova relance la session du pane (`resume-pane`), rien n'est tape par le daemon.
    const mode = req.body?.mode ?? 'new';
    if (mode !== 'new' && mode !== 'resume') {
      return fail(reply, 400, 'BAD_REQUEST', 'mode must be "new" or "resume"');
    }
    if (!services.rate.allow(deviceId, 'launch')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many launches');
    }
    const out = await startClaudeInPane(services, Number(req.params.paneId), deviceId, mode);
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    return out.response;
  });

  /**
   * Saisie dans le terminal depuis l'app : `{text}` (une ligne puis l'Entree) ou `{keys}`
   * (table fermee). Shell nu comme pane Claude (ecran de confiance : fleches et Entree).
   * Tout passe par `KeyGate`, garde du prompt parse comprise.
   */
  app.post<{ Params: { paneId: string }; Body: { text?: unknown; keys?: unknown } }>(
    ROUTE_PATTERNS.paneTerminal,
    async (req, reply) => {
      const deviceId = req.deviceId ?? '';
      if (!services.rate.allow(deviceId, 'terminal')) {
        return fail(reply, 429, 'RATE_LIMITED', 'too many terminal inputs');
      }
      const paneId = Number(req.params.paneId);
      const { text, keys } = req.body ?? {};
      try {
        if (typeof text === 'string' && keys === undefined) {
          return await services.keygate.emitTerminalInput(paneId, text, deviceId);
        }
        if (
          text === undefined &&
          Array.isArray(keys) &&
          keys.length > 0 &&
          keys.length <= TERMINAL_MAX_KEYS &&
          keys.every(isKeyName)
        ) {
          return await services.keygate.emitKeys(paneId, keys, deviceId);
        }
        return fail(reply, 400, 'BAD_REQUEST', `send either text or 1 to ${TERMINAL_MAX_KEYS} keys from the key table`);
      } catch (e) {
        if (e instanceof ForbiddenError) return fail(reply, 403, e.code, e.message);
        if (e instanceof IpcError) return fail(reply, 503, e.code, e.message);
        throw e;
      }
    },
  );

  /** Repli monospace (~30 lignes), lot 1. Pas de xterm.js, pas de flux d'octets. */
  app.get<{ Params: { paneId: string } }>(ROUTE_PATTERNS.paneScreen, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'screen')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many screen reads');
    }
    const screen = await services.prompts.screen(Number(req.params.paneId));
    if (!screen) return fail(reply, 404, 'PANE_NOT_FOUND', 'unknown pane');
    return screen;
  });

  /**
   * Pagination REELLE. Les trois parametres etaient construits par l'app et purement
   * ignores ici : `limit` ne limitait rien et `hasMoreBefore` valait `true` en dur, donc
   * un « charger plus » ne pouvait jamais se terminer. Leurs noms vivent desormais dans
   * `TURNS_QUERY`, cote protocole.
   */
  app.get<{ Params: { sessionId: string }; Querystring: Record<string, string | undefined> }>(
    ROUTE_PATTERNS.sessionTurns,
    async (req, reply) => {
      if (!services.rate.allow(req.deviceId ?? '', 'turns')) {
        return fail(reply, 429, 'RATE_LIMITED', 'too many reads');
      }
      // Une session fermee se lit aussi (design 4.11, lecture seule) : son `cwd` vient
      // de l'index des transcripts, pas d'un pane.
      const pane = services.panes.findBySession(req.params.sessionId);
      const closed = pane ? null : findSession(req.params.sessionId, services.panes.all(), services.panes.allTabs());
      const cwd = pane?.cwd ?? closed?.cwd;
      if (!cwd) return fail(reply, 404, 'SESSION_NOT_FOUND', 'unknown session');

      const num = (raw: string | undefined): number | null => {
        if (raw === undefined || raw === '') return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };
      const rawLimit = num(req.query[TURNS_QUERY.limit]);
      const limit = Math.min(Math.max(rawLimit ?? TURNS_PAGE_SIZE, 1), TURNS_INITIAL_LOAD);
      const beforeSeq = num(req.query[TURNS_QUERY.beforeSeq]);
      const afterSeq = num(req.query[TURNS_QUERY.afterSeq]);

      // `seq` est l'offset d'octet du tour dans le JSONL : `beforeSeq` borne donc la
      // LECTURE elle meme, pas seulement le filtre. Sans cela, la page « plus ancien »
      // relisait toujours la meme fin de fichier et l'historique s'arretait la.
      const path = transcriptPath(cwd, req.params.sessionId);
      const end = beforeSeq === null ? undefined : beforeSeq;
      // Fenetre doublee tant qu'elle ne contient aucun tour : une seule ligne de
      // `tool_result` mesure parfois plus de 256 Ko, et une page vide arreterait
      // l'historique avant son vrai debut.
      let bytes = TURNS_PAGE_BYTES;
      let lines = readTailLines(path, bytes, end);
      let all: Turn[] = buildTurns(sortAssistantBlocks(lines));
      let windowStart = lines.find((l) => typeof l.offset === 'number')?.offset ?? 0;
      while (all.length === 0 && windowStart > 0 && bytes < TURNS_PAGE_BYTES_MAX) {
        bytes *= 2;
        lines = readTailLines(path, bytes, end);
        all = buildTurns(sortAssistantBlocks(lines));
        windowStart = lines.find((l) => typeof l.offset === 'number')?.offset ?? 0;
      }
      const filtered = all.filter(
        (t) => (beforeSeq === null || t.seq < beforeSeq) && (afterSeq === null || t.seq > afterSeq),
      );
      // On garde la FIN de la fenetre : c'est le dernier echange que Robin vient lire.
      const page = filtered.slice(-limit);
      return {
        sessionId: req.params.sessionId,
        turns: page,
        hasMoreBefore: page.length < filtered.length || windowStart > 0,
      };
    },
  );

  /**
   * `Lancer Kova` (PRD 5.4, CA-123). `open -a Kova` : macOS lance l'application ou la
   * met au premier plan. Rien n'atteint un pane, donc pas de `KeyGate` ; mais c'est un
   * geste sur le Mac, donc audite et limite en debit.
   */
  app.post(ROUTE_PATTERNS.kovaLaunch, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'launch')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many launches');
    }
    const alreadyUp = services.ipc.state === 'up';
    try {
      await new Promise<void>((resolve, rejectLaunch) => {
        execFile('/usr/bin/open', ['-a', 'Kova'], (err) => (err ? rejectLaunch(err) : resolve()));
      });
    } catch (e) {
      audit({ deviceId, action: 'kova.launch', result: 'error', detail: (e as Error).message });
      return fail(reply, 500, 'INTERNAL', `open -a Kova failed: ${(e as Error).message}`);
    }
    audit({ deviceId, action: 'kova.launch', result: 'ok', detail: alreadyUp ? 'deja lance' : 'lance' });
    logger.info('kova lance depuis l app', { deviceId, alreadyUp });
    const res: KovaLaunchResponse = { launched: true, alreadyUp };
    return res;
  });

  /**
   * Cmd+O de Kova depuis l'app (PRD A9). La liste vient du fichier de Kova, l'index
   * designe une entree de cette liste, et la commande lancee est TOUJOURS `claude` : ni
   * le dossier ni la commande ne sont des chaines libres du client. `new-tab` n'ecrit
   * rien dans un pane existant, donc pas `KeyGate` ; mais c'est un processus lance sur
   * le Mac, donc audite et limite en debit comme `Lancer Kova`.
   */
  app.get(ROUTE_PATTERNS.kovaRecentProjects, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'panes')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many reads');
    }
    const res: KovaRecentProjectsResponse = { projects: listRecentProjects() };
    return res;
  });

  app.post<{ Body: Partial<KovaNewTabRequest> }>(ROUTE_PATTERNS.kovaNewTab, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'launch')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many launches');
    }
    const body = req.body ?? {};
    const index = typeof body.recentProjectIndex === 'number' ? body.recentProjectIndex : -1;
    const cwd = typeof body.path === 'string' ? resolveRecentProject(index, body.path) : null;
    if (cwd === null) {
      audit({ deviceId, action: 'kova.newTab', result: 'denied', detail: `index=${index}` });
      return fail(reply, 400, 'BAD_REQUEST', 'unknown recent project, the list may have changed');
    }
    let data: { tab_id?: unknown; pane_id?: unknown };
    try {
      const res = await services.ipc.request({ cmd: 'new-tab', cwd, command: NEW_TAB_COMMAND });
      if (!res.ok) throw new Error(res.error ?? 'erreur IPC');
      data = (res.data ?? {}) as { tab_id?: unknown; pane_id?: unknown };
    } catch (e) {
      audit({ deviceId, action: 'kova.newTab', path: cwd, result: 'error', detail: (e as Error).message });
      const code: ErrorCode = e instanceof IpcError ? e.code : 'KOVA_DOWN';
      return fail(reply, 502, code, `new-tab failed: ${(e as Error).message}`);
    }
    const tabId = typeof data.tab_id === 'number' ? data.tab_id : -1;
    const paneId = typeof data.pane_id === 'number' ? data.pane_id : -1;
    audit({ deviceId, action: 'kova.newTab', paneId, path: cwd, result: 'ok', detail: `tab=${tabId}` });
    logger.info('nouvel onglet kova depuis l app', { deviceId, cwd, tabId, paneId });
    // Sans titre, Kova nomme l'onglet d'apres la commande (« claude ») : un onglet de plus
    // nomme « claude » ne dit rien. Le nom du dossier, comme Robin nomme ses onglets.
    if (paneId >= 0) {
      try {
        await services.ipc.request({ cmd: 'set-tab-title', pane_id: paneId, title: basename(cwd) || cwd });
      } catch (e) {
        logger.warn('titre du nouvel onglet non applique', { paneId, err: (e as Error).message });
      }
    }
    const launched = await launchInFreshPane(services, paneId, deviceId);
    const res: KovaNewTabResponse = { tabId, paneId, cwd, launched };
    return res;
  });

  /**
   * Un pane de plus DANS un onglet existant. Kova ne coupe que le pane focalise : le
   * daemon focalise d'abord le pane au premier plan de l'onglet (ou son premier pane),
   * puis `split` avec `claude`. Le dossier vient d'un projet recent (index valide comme
   * `new-tab`) ou du pane focalise ; jamais une chaine libre du client.
   */
  app.post<{ Body: Partial<KovaSplitRequest> }>(ROUTE_PATTERNS.kovaSplit, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'launch')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many launches');
    }
    const body = req.body ?? {};
    const tabId = typeof body.tabId === 'number' ? body.tabId : -1;
    const tab = services.panes.allTabs().find((t) => t.id === tabId);
    if (!tab) {
      audit({ deviceId, action: 'kova.split', result: 'denied', detail: `tab=${tabId} inconnu` });
      return fail(reply, 404, 'PANE_NOT_FOUND', 'unknown tab');
    }
    const members = services.panes.all().filter((p) => p.tabId === tab.id);
    const anchor = members.find((p) => p.id === tab.focused_pane_id) ?? members[0];
    if (!anchor) {
      audit({ deviceId, action: 'kova.split', result: 'denied', detail: `tab=${tabId} sans pane` });
      return fail(reply, 404, 'PANE_NOT_FOUND', 'tab has no pane');
    }
    let cwd: string | null = anchor.cwd;
    if (typeof body.recentProjectIndex === 'number') {
      cwd = typeof body.path === 'string' ? resolveRecentProject(body.recentProjectIndex, body.path) : null;
      if (cwd === null) {
        audit({ deviceId, action: 'kova.split', result: 'denied', detail: `index=${body.recentProjectIndex}` });
        return fail(reply, 400, 'BAD_REQUEST', 'unknown recent project, the list may have changed');
      }
    }
    let data: { pane_id?: unknown };
    try {
      const focus = await services.ipc.request({ cmd: 'focus-pane', pane_id: anchor.id });
      if (!focus.ok) throw new Error(focus.error ?? 'focus-pane refuse');
      const res = await services.ipc.request({ cmd: 'split', cwd, command: NEW_TAB_COMMAND });
      if (!res.ok) throw new Error(res.error ?? 'erreur IPC');
      data = (res.data ?? {}) as { pane_id?: unknown };
    } catch (e) {
      audit({ deviceId, action: 'kova.split', path: cwd, result: 'error', detail: (e as Error).message });
      const code: ErrorCode = e instanceof IpcError ? e.code : 'KOVA_DOWN';
      return fail(reply, 502, code, `split failed: ${(e as Error).message}`);
    }
    const paneId = typeof data.pane_id === 'number' ? data.pane_id : -1;
    audit({ deviceId, action: 'kova.split', paneId, path: cwd, result: 'ok', detail: `tab=${tab.id} anchor=${anchor.id}` });
    logger.info('pane ajoute dans un onglet depuis l app', { deviceId, cwd, tabId: tab.id, paneId });
    const launched = await launchInFreshPane(services, paneId, deviceId);
    const out: KovaSplitResponse = { tabId: tab.id, paneId, cwd, launched };
    return out;
  });

  /**
   * Sessions ouvertes et fermees (PRD 3.4, design 4.11) : ce que les palettes de Kova
   * listent. Lecture seule, cache par fichier sur `mtime`.
   */
  app.get(ROUTE_PATTERNS.kovaSessions, async (req, reply) => {
    if (!services.rate.allow(req.deviceId ?? '', 'panes')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many reads');
    }
    const res: KovaSessionsResponse = { sessions: listSessions(services.panes.all(), services.panes.allTabs()) };
    return res;
  });

  /**
   * Reprise d'une session fermee : `new-tab` dans son `cwd` avec `claude --resume <id>`.
   * L'identifiant est valide par forme (UUID) ET contre l'index ; la commande est
   * construite ici, jamais recue du client ; l'Entree part par `KeyGate.emitLaunch`.
   */
  app.post<{ Body: Partial<KovaResumeRequest> }>(ROUTE_PATTERNS.kovaResume, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'launch')) {
      return fail(reply, 429, 'RATE_LIMITED', 'too many launches');
    }
    const out = await resumeSession(services, req.body?.sessionId, deviceId);
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    return out.response;
  });

  // --- Mode vocal ------------------------------------------------------------
  // Corps audio brut, borne a 10 Mo AVANT lecture complete : un type non audio ou une
  // taille annoncee trop grande sont refuses sans lire le flux.
  for (const mime of TRANSCRIBE_MIME_TYPES) {
    app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: TRANSCRIBE_MAX_BYTES }, (_req, body, done) => {
      done(null, body);
    });
  }
  app.post(ROUTE_PATTERNS.transcribe, async (req, reply) => {
    const deviceId = req.deviceId ?? '';
    if (!services.rate.allow(deviceId, 'text')) return fail(reply, 429, 'RATE_LIMITED', 'too many transcriptions');
    const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!TRANSCRIBE_MIME_TYPES.includes(mime)) {
      audit({ deviceId, action: 'voice.transcribe', result: 'denied', detail: `mime=${mime || 'none'}` });
      return fail(reply, 415, 'BAD_REQUEST', `unsupported audio type: ${mime || 'none'}`);
    }
    const audio = req.body;
    if (!Buffer.isBuffer(audio) || audio.length === 0) return fail(reply, 400, 'BAD_REQUEST', 'empty audio body');
    if (audio.length > TRANSCRIBE_MAX_BYTES) {
      audit({ deviceId, action: 'voice.transcribe', bytes: audio.length, result: 'denied', detail: 'too large' });
      return fail(reply, 413, 'BAD_REQUEST', `audio over ${TRANSCRIBE_MAX_BYTES} bytes`);
    }
    const started = Date.now();
    try {
      const res: TranscribeResponse = await transcribe(audio, mime, `voice.${mime.endsWith('wav') ? 'wav' : 'm4a'}`);
      // Jamais le texte dans le journal : c'est la voix de Robin.
      audit({ deviceId, action: 'voice.transcribe', bytes: audio.length, result: 'ok', detail: `ms=${Date.now() - started} chars=${res.text.length}` });
      return res;
    } catch (e) {
      if (e instanceof TranscriptionError) {
        audit({ deviceId, action: 'voice.transcribe', bytes: audio.length, result: e.code === 'TRANSCRIPTION_UNAVAILABLE' ? 'denied' : 'error', detail: e.code });
        return fail(reply, e.code === 'TRANSCRIPTION_UNAVAILABLE' ? 503 : 502, e.code, e.message);
      }
      audit({ deviceId, action: 'voice.transcribe', bytes: audio.length, result: 'error', detail: (e as Error).message });
      return fail(reply, 502, 'TRANSCRIPTION_FAILED', (e as Error).message);
    }
  });

  // --- Bloc C, les fichiers ----------------------------------------------
  // Sept routes, servies par `fsRoutes.ts`. Elles ne dependent pas de Kova : l'onglet
  // Fichiers reste utilisable quand Kova est quitte (CA-123).
  registerFsRoutes(app, services, uploads);

  // --- Navigateur, le miroir de Mira ---------------------------------------
  // Trois routes, servies par `miraRoutes.ts`. Elles parlent a la socket de Mira, jamais
  // a Kova, et n'appellent jamais `focus-app`.
  registerMiraRoutes(app, services);

  // --- WebSocket ---------------------------------------------------------

  app.get(ROUTE_PATTERNS.ws, { websocket: true }, (socket, req) => {
    const verdict = verifyBearer(req.headers.authorization, services.master, loadDevices());
    if (!verdict.ok) {
      // Le jeton ne transite JAMAIS par `Sec-WebSocket-Protocol` : ce champ est
      // renvoye tel quel dans la reponse de handshake et atterrit dans tous les
      // journaux d'acces. On exige l'en-tete Authorization.
      socket.close(WS_CLOSE_CODE.UNAUTHORIZED, 'unauthorized');
      audit({ action: 'ws.auth', result: 'denied', detail: verdict.code });
      return;
    }
    // L'adresse distante est l'adresse Tailscale du telephone : elle sert a savoir si
    // SA liaison passe en direct ou par un relais DERP (A11). L'instantane des panes
    // n'est pas envoye ici : le client l'obtient par `panes.subscribe`, ce qui laisse
    // `hello.resume` faire son office.
    const remoteAddress = req.socket?.remoteAddress;
    hub.add(socket as unknown as Socket, verdict.deviceId, remoteAddress);
    logger.info('client WS connecte', { deviceId: verdict.deviceId });
  });

  return app;
}
