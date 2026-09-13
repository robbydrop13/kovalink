// Client de la socket de Mira, le navigateur de Robin.
//
// Protocole : une requete JSON par ligne `{"command", "params"}`, une reponse JSON par
// ligne `{"ok":true,...}` ou `{"ok":false,"error"}`. Une connexion par commande, huit
// secondes au plus. On parle a la socket directement, jamais par la CLI `mira` : le
// daemon tourne sous launchd, sans le PATH d'un shell.
//
// Deux erreurs seulement. `MiraUnavailable` : la socket est absente ou refuse la
// connexion, Mira ne tourne pas ; l'app affiche « Mira is not running on the Mac » et
// rien d'autre. `MiraError` : Mira a repondu non, son message est relaye mot pour mot.
//
// `focus-app` n'apparait nulle part dans ce fichier, a dessein : aucune commande venue
// de l'iPhone ne doit mettre Mira devant ce que Robin fait sur le Mac.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MiraAction, MiraFrameResponse, MiraTab } from '@kovalink/protocol';

export const MIRA_SOCKET_DEFAULT = '/tmp/mira.sock';
const TIMEOUT_MS = 8000;

export class MiraUnavailable extends Error {
  constructor(message = 'Mira is not running') {
    super(message);
    this.name = 'MiraUnavailable';
  }
}

export class MiraError extends Error {
  readonly command: string;
  constructor(command: string, message: string) {
    super(message);
    this.name = 'MiraError';
    this.command = command;
  }
  /** `unknown tab: <id>` : l'onglet a ete ferme entre deux appels. */
  get unknownTab(): boolean {
    return /^unknown tab\b/.test(this.message);
  }
}

type MiraResponse = { ok: true; [k: string]: unknown } | { ok: false; error?: string };

export function miraSocketPath(): string {
  return process.env['MIRA_SOCKET'] || MIRA_SOCKET_DEFAULT;
}

/** Une commande, une connexion, une ligne dans chaque sens. */
export function miraCall(command: string, params: Record<string, unknown> = {}, socketPath = miraSocketPath()): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    let buf = '';
    let done = false;
    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new MiraError(command, `Mira did not answer within ${TIMEOUT_MS / 1000}s`))), TIMEOUT_MS);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(`${JSON.stringify({ command, params })}\n`));
    sock.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') finish(() => reject(new MiraUnavailable()));
      else finish(() => reject(new MiraError(command, e.message)));
    });
    sock.on('data', (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      finish(() => {
        let res: MiraResponse;
        try {
          res = JSON.parse(line) as MiraResponse;
        } catch {
          reject(new MiraError(command, `unreadable answer: ${line.slice(0, 120)}`));
          return;
        }
        if (res.ok) resolve(res);
        else reject(new MiraError(command, res.error ?? 'refused'));
      });
    });
    sock.on('close', () => finish(() => reject(new MiraError(command, 'Mira closed the connection without answering'))));
  });
}

interface RawWindow {
  windowId: string;
}
interface RawTab {
  id: string;
  title?: string;
  url?: string;
  loaded?: boolean;
  kind?: string;
}

/** Tous les onglets web de toutes les fenetres, dans l'ordre des fenetres puis de la barre. */
export async function listMiraTabs(socketPath = miraSocketPath()): Promise<MiraTab[]> {
  const win = await miraCall('list-windows', {}, socketPath);
  const windows = (win['windows'] as RawWindow[] | undefined) ?? [];
  const out: MiraTab[] = [];
  for (const w of windows) {
    const res = await miraCall('list-tabs', { windowId: w.windowId }, socketPath);
    const tabs = (res['tabs'] as RawTab[] | undefined) ?? [];
    const activeId = res['activeId'] as string | null | undefined;
    for (const tab of tabs) {
      // L'onglet Reglages n'est pas une page : ni capture ni clic possibles.
      if (tab.kind && tab.kind !== 'web') continue;
      out.push({
        id: tab.id,
        windowId: w.windowId,
        title: tab.title ?? '',
        url: tab.url ?? '',
        active: tab.id === activeId,
        asleep: tab.loaded === false,
      });
    }
  }
  return out;
}

/** Ce que `exec-js` rend pour la taille du viewport, en pixels CSS. */
interface Viewport {
  w: number;
  h: number;
  url: string;
  title: string;
}

const VIEWPORT_JS = '({w: window.innerWidth, h: window.innerHeight, url: location.href, title: document.title})';

/**
 * Une image de l'onglet : le viewport en CSS d'abord, puis la capture. Mira ecrit un PNG
 * dans un dossier du daemon, on le lit et on l'efface aussitot. Pas de JPEG : aucune
 * dependance pure JS ne le fait ici, et une dependance native est exclue.
 */
export async function captureMiraFrame(tabId: string, socketPath = miraSocketPath()): Promise<MiraFrameResponse> {
  const vp = await miraCall('exec-js', { code: VIEWPORT_JS, tabId }, socketPath);
  const view = (vp['result'] ?? {}) as Partial<Viewport>;
  const dir = join(tmpdir(), 'kovalink-mira');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${randomBytes(8).toString('hex')}.png`);
  const shot = await miraCall('screenshot', { tabId, path }, socketPath);
  let bytes: Buffer;
  try {
    bytes = readFileSync(String(shot['path'] ?? path));
  } finally {
    try {
      unlinkSync(String(shot['path'] ?? path));
    } catch {
      /* deja absent */
    }
  }
  const width = Number(shot['width']) || 0;
  const height = Number(shot['height']) || 0;
  return {
    image: bytes.toString('base64'),
    mime: 'image/png',
    width,
    height,
    cssWidth: Number(view.w) || width,
    cssHeight: Number(view.h) || height,
    url: typeof view.url === 'string' ? view.url : '',
    title: typeof view.title === 'string' ? view.title : '',
  };
}

/**
 * Taper du texte : `insertText` sur l'element focalise, le chemin que les champs de
 * connexion et les editeurs ecoutent. Quand la commande est refusee (un champ sans
 * `contenteditable` sur une page qui l'interdit), repli sur `.value` plus un `input`.
 */
function typeJs(text: string): string {
  return `(() => {
  const t = ${JSON.stringify(text)};
  const el = document.activeElement;
  if (!el || el === document.body) return 'no-focus';
  if (document.execCommand('insertText', false, t)) return 'ok';
  if ('value' in el) {
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
    el.value = el.value.slice(0, s) + t + el.value.slice(e);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'fallback';
  }
  return 'no-input';
})()`;
}

/**
 * Un geste sur un onglet. `click` et `press-key` rendent l'onglet visible dans sa fenetre
 * (Chromium ne livre une entree qu'a un onglet visible), sans jamais activer l'app.
 * `back` et `forward` passent par `history` dans la page : la commande de Mira du meme nom
 * ne vise que l'onglet actif de la fenetre focalisee, ce qui n'est pas forcement celui-ci.
 */
export async function actOnMiraTab(tabId: string, action: MiraAction, socketPath = miraSocketPath()): Promise<void> {
  switch (action.kind) {
    case 'click':
      await miraCall('click', { tabId, x: action.x, y: action.y }, socketPath);
      return;
    case 'type':
      await miraCall('exec-js', { tabId, code: typeJs(action.text) }, socketPath);
      return;
    case 'key':
      await miraCall(
        'press-key',
        { tabId, key: action.key === 'Space' ? ' ' : action.key, ...(action.modifiers?.length ? { modifiers: action.modifiers } : {}) },
        socketPath,
      );
      return;
    case 'scroll':
      await miraCall('exec-js', { tabId, code: `window.scrollBy(0, ${action.dy})` }, socketPath);
      return;
    case 'nav':
      await miraCall('navigate', { tabId, url: action.url }, socketPath);
      return;
    case 'back':
      await miraCall('exec-js', { tabId, code: 'history.back()' }, socketPath);
      return;
    case 'forward':
      await miraCall('exec-js', { tabId, code: 'history.forward()' }, socketPath);
      return;
    case 'reload':
      await miraCall('reload', { tabId }, socketPath);
      return;
    case 'activate':
      await miraCall('activate-tab', { id: tabId }, socketPath);
      return;
  }
}
