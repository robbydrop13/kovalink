// Lancer `claude` dans un onglet neuf : nouvelle session sur un projet recent (Cmd+O),
// ou reprise d'une session fermee (`claude --resume <id>`, PRD 3.4). La commande est
// TOUJOURS construite ici : le client ne fournit qu'un index ou un identifiant, valides.
import { statSync } from 'node:fs';
import type { ErrorCode, KovaResumeResponse } from '@kovalink/protocol';
import { audit } from '../audit.js';
import { logger } from '../logger.js';
import type { Services } from '../server/services.js';
import { IpcError } from './ipc.js';
import { findSession, isSessionId } from './sessions.js';

/** La SEULE commande que `new-tab` lance. Constante, jamais une chaine du client. */
export const NEW_TAB_COMMAND = 'claude';
/** Delai d'apparition du nouveau pane dans le store, par l'evenement `pane-open`. */
const NEW_TAB_PANE_WAIT_MS = 3_000;

/** Ce dont ces deux operations ont besoin : une vue etroite des services, facile a simuler. */
export type LaunchServices = Pick<Services, 'ipc' | 'panes' | 'keygate'>;

/**
 * Mesure : le champ `command` de `new-tab` est tape dans le shell, pas execute. On attend
 * que le pane apparaisse dans le store (evenement `pane-open`), puis KeyGate envoie
 * l'Entree. Rend `false` si le pane n'est pas apparu ou si KeyGate a refuse.
 */
export async function launchInFreshPane(
  services: LaunchServices,
  paneId: number,
  deviceId: string,
  waitMs = NEW_TAB_PANE_WAIT_MS,
): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (!services.panes.get(paneId) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return (await services.keygate.emitLaunch(paneId, deviceId)).applied;
  } catch (e) {
    logger.warn('lancement de claude dans le nouvel onglet refuse', { paneId, err: (e as Error).message });
    return false;
  }
}

export type ResumeOutcome =
  | { ok: true; response: KovaResumeResponse }
  | { ok: false; status: number; code: ErrorCode; message: string };

/**
 * Reprise d'une session fermee. L'identifiant est valide par forme (UUID) ET contre
 * l'index des transcripts ; le dossier doit exister ; un seul `new-tab`, puis l'Entree
 * par `KeyGate.emitLaunch`. Une session deja ouverte rend son pane sans rien lancer.
 */
export async function resumeSession(
  services: LaunchServices,
  sessionId: unknown,
  deviceId: string,
  waitMs?: number,
): Promise<ResumeOutcome> {
  const session = isSessionId(sessionId) ? findSession(sessionId, services.panes.all(), services.panes.allTabs()) : null;
  if (!session) {
    audit({ deviceId, action: 'kova.resume', result: 'denied', detail: 'session inconnue' });
    return { ok: false, status: 404, code: 'SESSION_NOT_FOUND', message: 'session inconnue de l index' };
  }
  if (session.state === 'open' && session.paneId !== null) {
    return {
      ok: true,
      response: { tabId: null, paneId: session.paneId, cwd: session.cwd, launched: false, alreadyOpen: true },
    };
  }
  let isDir = false;
  try {
    isDir = statSync(session.cwd).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    audit({ deviceId, action: 'kova.resume', path: session.cwd, result: 'denied', detail: 'dossier disparu' });
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: `le dossier de la session n existe plus : ${session.cwd}` };
  }
  // `sessionId` a la forme d'un UUID (verifiee) : la commande ne contient rien d'autre.
  const command = `${NEW_TAB_COMMAND} --resume ${session.sessionId}`;
  let data: { tab_id?: unknown; pane_id?: unknown };
  try {
    const res = await services.ipc.request({ cmd: 'new-tab', cwd: session.cwd, command });
    if (!res.ok) throw new Error(res.error ?? 'erreur IPC');
    data = (res.data ?? {}) as { tab_id?: unknown; pane_id?: unknown };
  } catch (e) {
    audit({ deviceId, action: 'kova.resume', path: session.cwd, result: 'error', detail: (e as Error).message });
    const code: ErrorCode = e instanceof IpcError ? e.code : 'KOVA_DOWN';
    return { ok: false, status: 502, code, message: `new-tab a echoue : ${(e as Error).message}` };
  }
  const tabId = typeof data.tab_id === 'number' ? data.tab_id : -1;
  const paneId = typeof data.pane_id === 'number' ? data.pane_id : -1;
  audit({
    deviceId,
    action: 'kova.resume',
    paneId,
    path: session.cwd,
    result: 'ok',
    detail: `tab=${tabId} session=${session.sessionId}`,
  });
  logger.info('reprise de session depuis l app', { deviceId, cwd: session.cwd, sessionId: session.sessionId, tabId, paneId });
  const launched = await launchInFreshPane(services, paneId, deviceId, waitMs);
  return { ok: true, response: { tabId, paneId, cwd: session.cwd, launched, alreadyOpen: false } };
}
