// Lancer `claude` dans un onglet neuf : nouvelle session sur un projet recent (Cmd+O),
// ou reprise d'une session fermee (`claude --resume <id>`, PRD 3.4). La commande est
// TOUJOURS construite ici : le client ne fournit qu'un index ou un identifiant, valides.
import { statSync } from 'node:fs';
import { isPaneContentError, type ErrorCode, type KovaResumeResponse, type PaneContent, type PaneStartClaudeResponse } from '@kovalink/protocol';
import { audit } from '../audit.js';
import { logger } from '../logger.js';
import type { Services } from '../server/services.js';
import { IpcError } from './ipc.js';
import { findSession, isSessionId } from './sessions.js';

/**
 * La SEULE commande que `new-tab` lance. Constante, jamais une chaine du client. La meme
 * que `KeyGate.LAUNCH_COMMAND`, tapee par le daemon sur un pane nu (`start-claude`).
 */
export const NEW_TAB_COMMAND = 'claude';
/** Delai d'apparition du nouveau pane dans le store, par l'evenement `pane-open`. */
const NEW_TAB_PANE_WAIT_MS = 3_000;
/** Cadence de lecture de l'ecran en attendant la commande tapee. */
const TYPED_POLL_MS = 150;
/** Delai apres l'Entree avant de verifier que la commande a ete executee. */
const LAUNCH_SETTLE_MS = 1_200;

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
  // Mesure sur `split` (13 septembre 2026) : le pane existe avant que le shell n'ait lu la
  // commande tapee par Kova. Une Entree envoyee a ce moment la produit un prompt vide, et
  // `claude` reste tape sans etre execute. On attend donc de VOIR la commande a l'ecran,
  // puis on verifie qu'elle a bien ete consommee, avec une seconde Entree sinon.
  await waitForTypedCommand(services, paneId, deadline);
  return pressLaunch(services, paneId, deviceId, false);
}

/**
 * `Start Claude here` depuis l'app, sur un pane qui n'est qu'un shell (par exemple un
 * pane que Kova a restaure au redemarrage, sans Claude). Personne n'a tape la commande :
 * KeyGate la tape avec l'Entree, puis le meme suivi que `new-tab`. Le refus d'un pane
 * occupe est decide ICI, avant toute touche : un agent, un processus enfant (un `vim`,
 * un serveur) ou un lancement deja en cours rendent 409, rien n'est envoye.
 */
export async function startClaudeInPane(
  services: LaunchServices,
  paneId: number,
  deviceId: string,
): Promise<StartClaudeOutcome> {
  const pane = services.panes.get(paneId);
  if (!pane) {
    audit({ deviceId, action: 'pane.start-claude', paneId, result: 'denied', detail: 'pane_gone' });
    return { ok: false, status: 404, code: 'PANE_NOT_FOUND', message: 'unknown pane' };
  }
  const busy = pane.agent !== null ? 'agent' : pane.launching ? 'launching' : pane.child_processes.length > 0 ? 'child' : null;
  if (busy !== null) {
    audit({ deviceId, action: 'pane.start-claude', paneId, result: 'denied', detail: busy });
    return { ok: false, status: 409, code: 'PANE_BUSY', message: `this pane is not a bare shell (${busy})` };
  }
  const launched = await pressLaunch(services, paneId, deviceId, true);
  audit({ deviceId, action: 'pane.start-claude', paneId, path: pane.cwd, result: launched ? 'ok' : 'error' });
  logger.info('claude lance dans un pane nu depuis l app', { deviceId, paneId, cwd: pane.cwd, launched });
  return { ok: true, response: { launched } };
}

export type StartClaudeOutcome =
  | { ok: true; response: PaneStartClaudeResponse }
  | { ok: false; status: number; code: ErrorCode; message: string };

/**
 * L'Entree qui execute `claude` (tapee aussi par le daemon si `typeCommand`), le pane
 * marque « en demarrage », puis une seconde Entree si la commande est encore a l'ecran.
 */
async function pressLaunch(services: LaunchServices, paneId: number, deviceId: string, typeCommand: boolean): Promise<boolean> {
  try {
    const first = await services.keygate.emitLaunch(paneId, deviceId, typeCommand);
    if (!first.applied) return false;
    // Des l'Entree partie, le pane est « en demarrage » pour l'app, pas « sans agent ».
    if (typeof services.panes.markLaunching === 'function') services.panes.markLaunching(paneId);
  } catch (e) {
    logger.warn('lancement de claude refuse', { paneId, err: (e as Error).message });
    return false;
  }
  if (await commandStillTyped(services, paneId)) {
    logger.info('commande toujours tapee apres l Entree, seconde Entree', { paneId });
    try {
      return (await services.keygate.emitLaunch(paneId, deviceId)).applied;
    } catch {
      return false;
    }
  }
  return true;
}

/** Texte visible du pane, `null` si l'IPC ne le donne pas (ou n'est pas simule en test). */
async function screenOf(services: LaunchServices, paneId: number): Promise<string | null> {
  const ipc = services.ipc as { getPaneContent?: (ids: number[]) => Promise<PaneContent[]> };
  if (typeof ipc.getPaneContent !== 'function') return null;
  try {
    const [content] = await ipc.getPaneContent([paneId]);
    return content && !isPaneContentError(content) ? content.text : null;
  } catch {
    return null;
  }
}

/** La commande est visible a l'ecran : le shell l'a lue, l'Entree peut partir. */
async function waitForTypedCommand(services: LaunchServices, paneId: number, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const text = await screenOf(services, paneId);
    if (text === null || text.includes(NEW_TAB_COMMAND)) return;
    await new Promise((r) => setTimeout(r, TYPED_POLL_MS));
  }
}

/**
 * Apres l'Entree : la derniere ligne non vide porte encore la commande, sans banniere de
 * Claude Code au dessus. Le shell ne l'a donc pas executee.
 */
async function commandStillTyped(services: LaunchServices, paneId: number): Promise<boolean> {
  await new Promise((r) => setTimeout(r, LAUNCH_SETTLE_MS));
  const text = await screenOf(services, paneId);
  if (text === null || text.includes('Claude Code')) return false;
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1] ?? '';
  return last.includes(NEW_TAB_COMMAND);
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
    audit({ deviceId, action: 'kova.resume', result: 'denied', detail: 'unknown session' });
    return { ok: false, status: 404, code: 'SESSION_NOT_FOUND', message: 'session not in the index' };
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
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: `the session folder no longer exists: ${session.cwd}` };
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
    return { ok: false, status: 502, code, message: `new-tab failed: ${(e as Error).message}` };
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
