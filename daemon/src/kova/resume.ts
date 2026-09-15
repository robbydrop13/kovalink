// Lancer `claude` dans un onglet neuf : nouvelle session sur un projet recent (Cmd+O),
// ou reprise d'une session fermee (`claude --resume <id>`, PRD 3.4). La commande est
// TOUJOURS construite ici : le client ne fournit qu'un index ou un identifiant, valides.
import { statSync } from 'node:fs';
import {
  isPaneContentError,
  type ErrorCode,
  type KovaResumeResponse,
  type PaneContent,
  type PaneStartClaudeResponse,
  type PaneStartMode,
} from '@kovalink/protocol';
import { audit } from '../audit.js';
import { logger } from '../logger.js';
import type { Services } from '../server/services.js';
import { IpcError, type KovaResponse } from './ipc.js';
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
  return (await pressLaunch(services, paneId, deviceId, false)).launched;
}

/**
 * `Start Claude here` depuis l'app, sur un pane qui n'est qu'un shell (par exemple un
 * pane que Kova a restaure au redemarrage, sans Claude). Personne n'a tape la commande :
 * KeyGate la tape avec l'Entree, puis le meme suivi que `new-tab`. Le refus d'un pane
 * occupe est decide ICI, avant toute touche : un agent, un processus enfant (un `vim`,
 * un serveur) ou un lancement deja en cours rendent 409, rien n'est envoye.
 */
/**
 * Lancements en cours, par pane. Mesure du 15 septembre 2026 : l'app a envoye DEUX
 * `start-claude` sur le pane 28 a la meme milliseconde. Le second recoit la reponse du
 * premier : `claude` n'est jamais tape deux fois.
 */
const inflightStarts = new Map<number, Promise<StartClaudeOutcome>>();

export function startClaudeInPane(
  services: LaunchServices,
  paneId: number,
  deviceId: string,
  mode: PaneStartMode = 'new',
): Promise<StartClaudeOutcome> {
  const running = inflightStarts.get(paneId);
  if (running) {
    audit({ deviceId, action: auditAction(mode), paneId, result: 'denied', detail: 'duplicate' });
    logger.info('start-claude deja en cours sur ce pane, requete fusionnee', { paneId, mode });
    return running;
  }
  const run = startClaudeOnce(services, paneId, deviceId, mode).finally(() => inflightStarts.delete(paneId));
  inflightStarts.set(paneId, run);
  return run;
}

/**
 * Relit le pane chez Kova avant de decider. Mesure du 15 septembre 2026 sur un onglet de
 * test : apres avoir quitte Claude, le store du daemon gardait `child_processes: [claude]`
 * alors que Kova n'en listait plus aucun. `start-claude` rendait 409 `PANE_BUSY` sur un
 * shell nu. Un echec de lecture laisse le store tel quel.
 */
async function refreshPane(services: LaunchServices, paneId: number): Promise<void> {
  const ipc = services.ipc as { listPanes?: () => Promise<Record<string, unknown>[]> };
  if (typeof ipc.listPanes !== 'function' || typeof services.panes.upsertRaw !== 'function') return;
  try {
    const raw = (await ipc.listPanes()).find((p) => p['id'] === paneId);
    if (raw && services.panes.get(paneId)) services.panes.upsertRaw(raw);
  } catch (e) {
    logger.warn('relecture du pane avant start-claude en echec', { paneId, err: (e as Error).message });
  }
}

function auditAction(mode: PaneStartMode): string {
  return mode === 'resume' ? 'pane.resume-pending' : 'pane.start-claude';
}

async function startClaudeOnce(
  services: LaunchServices,
  paneId: number,
  deviceId: string,
  mode: PaneStartMode,
): Promise<StartClaudeOutcome> {
  const action = auditAction(mode);
  await refreshPane(services, paneId);
  const pane = services.panes.get(paneId);
  if (!pane) {
    audit({ deviceId, action, paneId, result: 'denied', detail: 'pane_gone' });
    return { ok: false, status: 404, code: 'PANE_NOT_FOUND', message: 'unknown pane' };
  }
  const busy = pane.agent !== null ? 'agent' : pane.launching ? 'launching' : pane.child_processes.length > 0 ? 'child' : null;
  if (busy !== null) {
    audit({ deviceId, action, paneId, result: 'denied', detail: busy });
    const why =
      busy === 'agent'
        ? 'Claude is already running in this pane'
        : busy === 'launching'
          ? 'Claude is already starting in this pane'
          : `a program is running in this pane (${pane.child_processes.map((c) => c.name).join(', ')}), quit it first`;
    return { ok: false, status: 409, code: 'PANE_BUSY', message: why };
  }
  if (mode === 'resume') {
    // Kova porte la ligne de reprise et la valide : le daemon ne fait que nommer le pane.
    if (pane.resume_command === null) {
      audit({ deviceId, action, paneId, result: 'denied', detail: 'nothing_to_resume' });
      return { ok: false, status: 409, code: 'PANE_BUSY', message: 'there is no session to resume in this pane' };
    }
    const out = await resumeInKova(services, paneId);
    audit({
      deviceId,
      action,
      paneId,
      path: pane.cwd,
      result: out.launched ? 'ok' : 'error',
      detail: out.launched ? `session=${pane.resume_session_id ?? '?'}` : out.reason,
    });
    logger.info('session reprise dans son pane depuis l app', { deviceId, paneId, cwd: pane.cwd, launched: out.launched, reason: out.reason });
    return { ok: true, response: out };
  }
  const out = await pressLaunch(services, paneId, deviceId, true);
  audit({ deviceId, action: 'pane.start-claude', paneId, path: pane.cwd, result: out.launched ? 'ok' : 'error', detail: out.reason });
  logger.info('claude lance dans un pane nu depuis l app', { deviceId, paneId, cwd: pane.cwd, launched: out.launched, reason: out.reason });
  return { ok: true, response: out };
}

export type StartClaudeOutcome =
  | { ok: true; response: PaneStartClaudeResponse }
  | { ok: false; status: number; code: ErrorCode; message: string };

type Press = { applied: true } | { applied: false; reason: string };

const PANE_GONE_REASON = 'the pane is gone on the Mac';

function hasClaude(pane: { agent: string | null; child_processes: { name: string }[] }): boolean {
  return pane.agent !== null || pane.child_processes.some((c) => c.name === NEW_TAB_COMMAND);
}

function lastLine(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines[lines.length - 1] ?? '';
}

/**
 * Premiere frappe. Sur une coupure IPC (reveil du Mac), on attend la reconnexion, on
 * RELIT le pane et son ecran, et on ne rejoue qu'une fois, seulement si rien n'a atteint
 * le shell : un agent present, la banniere de Claude Code ou la commande deja tapee
 * valent lancement. Un ecran illisible ne rejoue rien : jamais `claude` deux fois.
 */
async function firstPress(services: LaunchServices, paneId: number, deviceId: string, typeCommand: boolean): Promise<Press> {
  const attempt = async (): Promise<Press> => {
    const r = await services.keygate.emitLaunch(paneId, deviceId, typeCommand);
    return r.applied ? { applied: true } : { applied: false, reason: r.reason === 'pane_gone' ? PANE_GONE_REASON : `refused (${r.reason ?? 'unknown'})` };
  };
  try {
    return await attempt();
  } catch (e) {
    const err = (e as Error).message;
    logger.warn('lancement de claude refuse', { paneId, err });
    if (!(e instanceof IpcError) || e.code !== 'KOVA_DOWN') return { applied: false, reason: err };
  }
  const ipc = services.ipc as { whenUp?: (ms?: number) => Promise<boolean> };
  const up = typeof ipc.whenUp === 'function' ? await ipc.whenUp() : false;
  if (!up) return { applied: false, reason: 'Kova is unreachable, the Mac may be waking up. Try again in a moment.' };
  const pane = services.panes.get(paneId);
  if (!pane) return { applied: false, reason: PANE_GONE_REASON };
  if (hasClaude(pane)) return { applied: true };
  const screen = await screenOf(services, paneId);
  if (screen === null) return { applied: false, reason: 'the pane screen is unreadable after a Kova reconnection, nothing was typed again' };
  if (screen.includes('Claude Code') || (typeCommand && lastLine(screen).includes(NEW_TAB_COMMAND))) {
    logger.info('lancement deja parti avant la coupure IPC, rien n est rejoue', { paneId });
    return { applied: true };
  }
  logger.info('lancement rejoue apres la reconnexion IPC', { paneId });
  try {
    return await attempt();
  } catch (e) {
    return { applied: false, reason: (e as Error).message };
  }
}

/**
 * L'Entree qui execute `claude` (tapee aussi par le daemon si `typeCommand`), le pane
 * marque « en demarrage », puis une seconde Entree si la commande est encore a l'ecran.
 */
async function pressLaunch(services: LaunchServices, paneId: number, deviceId: string, typeCommand: boolean): Promise<PaneStartClaudeResponse> {
  const first = await firstPress(services, paneId, deviceId, typeCommand);
  if (!first.applied) return { launched: false, reason: first.reason };
  // Des l'Entree partie, le pane est « en demarrage » pour l'app, pas « sans agent ».
  if (typeof services.panes.markLaunching === 'function') services.panes.markLaunching(paneId);
  if (await commandStillTyped(services, paneId)) {
    logger.info('commande toujours tapee apres l Entree, seconde Entree', { paneId });
    try {
      const again = await services.keygate.emitLaunch(paneId, deviceId);
      return again.applied ? { launched: true } : { launched: false, reason: 'claude is typed in the shell but Enter was refused' };
    } catch (e) {
      return { launched: false, reason: `claude is typed in the shell but Enter failed: ${(e as Error).message}` };
    }
  }
  return { launched: true };
}

/**
 * `resume-pane` chez Kova : exactement le bouton `Resume` de sa barre laterale (Ctrl+U, la
 * ligne rebatie par Kova, Entree). Sur une coupure IPC (reveil du Mac), on attend la
 * reconnexion, on relit le pane et on ne rejoue qu'une fois, seulement si aucun agent n'y
 * est apparu. Kova refuse de toute facon un pane qui n'est plus un shell nu.
 */
async function resumeInKova(services: LaunchServices, paneId: number): Promise<PaneStartClaudeResponse> {
  const send = (): Promise<KovaResponse> => services.ipc.request({ cmd: 'resume-pane', pane_id: paneId });
  let res: KovaResponse;
  try {
    res = await send();
  } catch (e) {
    const err = (e as Error).message;
    logger.warn('resume-pane refuse', { paneId, err });
    if (!(e instanceof IpcError) || e.code !== 'KOVA_DOWN') return { launched: false, reason: err };
    const ipc = services.ipc as { whenUp?: (ms?: number) => Promise<boolean> };
    const up = typeof ipc.whenUp === 'function' ? await ipc.whenUp() : false;
    if (!up) return { launched: false, reason: 'Kova is unreachable, the Mac may be waking up. Try again in a moment.' };
    await refreshPane(services, paneId);
    const pane = services.panes.get(paneId);
    if (!pane) return { launched: false, reason: PANE_GONE_REASON };
    if (hasClaude(pane)) {
      markLaunched(services, paneId);
      return { launched: true };
    }
    try {
      res = await send();
    } catch (e2) {
      return { launched: false, reason: (e2 as Error).message };
    }
  }
  if (!res.ok) {
    const err = res.error ?? 'unknown error';
    if (/^unknown command/i.test(err)) return { launched: false, reason: 'update Kova on the Mac to resume sessions from the phone' };
    if (/not found/i.test(err)) return { launched: false, reason: PANE_GONE_REASON };
    return { launched: false, reason: err };
  }
  markLaunched(services, paneId);
  return { launched: true };
}

function markLaunched(services: LaunchServices, paneId: number): void {
  if (typeof services.panes.markLaunching === 'function') services.panes.markLaunching(paneId);
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
  return lastLine(text).includes(NEW_TAB_COMMAND);
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
