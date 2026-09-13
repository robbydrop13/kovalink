// Client HTTPS. `fetch` standard : le certificat vient de `tailscale cert` et il est validé
// par la chaîne de confiance système (A12). Aucun épinglage, aucun module natif.
//
// Ce module ne dépend d'aucun état React : il est appelé aussi bien par l'interface que par
// la tâche de fond qui traite une action de notification au démarrage à froid.
import {
  ROUTES,
  TURNS_PAGE_SIZE,
  TURNS_QUERY,
  type ActionResponse,
  type KovaLaunchResponse,
  type KovaNewTabRequest,
  type KovaNewTabResponse,
  type KovaSplitRequest,
  type KovaSplitResponse,
  type KovaRecentProjectsResponse,
  type KovaBookmarkRequest,
  type KovaBookmarkResponse,
  type KovaResumeRequest,
  type KovaResumeResponse,
  type KovaSessionsResponse,
  type Pane,
  type PaneTitleRequest,
  type PaneTitleResponse,
  type PaneSessionNameRequest,
  type PaneSessionNameResponse,
  type PaneCommandsResponse,
  type PaneReorderResponse,
  type PaneStartClaudeResponse,
  type PairClaimRequest,
  type PairClaimResponse,
  type Prompt,
  type RecentProject,
  type ReorderRequest,
  type Tab,
  type TabReorderResponse,
  type Turn,
} from '@/protocol';
import { loadCredentials, type Credentials } from '@/store/credentials';
import { t } from '@/i18n/en';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function baseUrl(c: Pick<Credentials, 'tsDns' | 'port'>): string {
  return `https://${c.tsDns}:${c.port}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  /** Certaines routes (l'appairage) n'ont pas encore de jeton. */
  credentials?: Credentials | null;
  anonymous?: boolean;
}

async function request<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const creds = o.credentials !== undefined ? o.credentials : await loadCredentials();
  if (!creds) throw new HttpError(401, 'UNAUTHORIZED', t.httpNotPaired);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${baseUrl(creds)}${path}`, {
      method: o.method ?? 'GET',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        // Le jeton rendu par l'appairage est la valeur complète `<deviceId>.<exp>.<token>`.
        // Il ne transite jamais par une URL ni par Sec-WebSocket-Protocol (C8).
        ...(o.anonymous ? {} : { authorization: `Bearer ${creds.token}` }),
      },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // Corps illisible : on ne le remplace PAS par un message générique, on le montre.
      if (!res.ok) {
        throw new HttpError(res.status, 'INTERNAL', `HTTP ${res.status} ${text.slice(0, 200)}`);
      }
      throw new HttpError(res.status, 'INTERNAL', t.httpUnreadableBody(text.slice(0, 200)));
    }
    if (!res.ok) {
      const e = json as { code?: string; message?: string };
      // Un corps sans `code` vient d'un gestionnaire d'erreur qui n'est pas le nôtre : on
      // le dit, plutôt que de le maquiller en `INTERNAL` comme si le daemon l'avait émis.
      throw new HttpError(
        res.status,
        e.code ?? 'INTERNAL',
        e.message ?? t.httpStatusOn(res.status, path),
      );
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

// --- Appairage --------------------------------------------------------------

// Il existait ici une seconde déclaration de `PairPayload`, avec les clés `h`, `p`, `t`,
// `n` : précisément le format inventé côté app qui rendait le QR illisible. Elle n'était
// plus appelée mais restait une deuxième source de vérité, prête à resservir. Le format
// vit dans `@kovalink/protocol` (`PairPayload`, `decodePairPayload`), nulle part ailleurs.

export interface PairResult {
  deviceId: string;
  token: string;
  nseToken?: string;
  tsDns: string;
  port: number;
}

export async function health(target: { tsDns: string; port: number }): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${baseUrl(target)}${ROUTES.health}`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } finally {
    clearTimeout(timer);
  }
}

export async function pairClaim(
  target: { tsDns: string; port: number },
  pairingCode: string,
  deviceName: string,
): Promise<PairResult> {
  const partial: Credentials = {
    deviceId: '',
    token: '',
    nseToken: null,
    tsDns: target.tsDns,
    port: target.port,
  };
  const body = await request<PairClaimResponse>(
    ROUTES.pairClaim,
    {
      method: 'POST',
      body: { pairingCode, deviceName } satisfies PairClaimRequest,
      credentials: partial,
      anonymous: true,
      timeoutMs: 10_000,
    },
  );
  return {
    deviceId: body.deviceId,
    token: body.token,
    ...(body.nseToken ? { nseToken: body.nseToken } : {}),
    tsDns: body.tsDns ?? target.tsDns,
    port: body.port ?? target.port,
  };
}

export function revokeDevice(deviceId: string): Promise<{ ok: boolean }> {
  return request(ROUTES.pairDevice(deviceId), {
    method: 'DELETE',
    timeoutMs: 5000,
  });
}

// --- Lecture ----------------------------------------------------------------

export function fetchPanes(): Promise<{ panes: Pane[]; tabs: Tab[]; etag: string }> {
  return request(ROUTES.panes);
}

/**
 * Récupération d'un prompt par sa référence opaque.
 *
 * R3 : la référence reste valable jusqu'à résolution du prompt ou 10 minutes. Elle a trois
 * consommateurs légitimes (la NSE, une action rapide, un lien profond) et l'usage unique
 * cassait toutes les actions rapides dès la première notification.
 */
export function fetchPrompt(promptRef: string, timeoutMs = 6000): Promise<Prompt> {
  return request(ROUTES.prompt(promptRef), { timeoutMs });
}

export function fetchTurns(
  sessionId: string,
  params: { beforeSeq?: number; afterSeq?: number; limit?: number } = {},
): Promise<{ turns: Turn[]; hasMoreBefore: boolean }> {
  const q = new URLSearchParams();
  if (params.beforeSeq !== undefined) q.set(TURNS_QUERY.beforeSeq, String(params.beforeSeq));
  if (params.afterSeq !== undefined) q.set(TURNS_QUERY.afterSeq, String(params.afterSeq));
  q.set(TURNS_QUERY.limit, String(params.limit ?? TURNS_PAGE_SIZE));
  return request(`${ROUTES.sessionTurns(sessionId)}?${q.toString()}`);
}

// --- Écriture ---------------------------------------------------------------

/** Réponse à un prompt. On envoie toujours un `optionIndex`, jamais un libellé (C1). */
export function postAnswer(
  paneId: number,
  body: { optionIndex: number; promptHash: string; awaitingSince: string; nonce: string },
  timeoutMs = 3500,
): Promise<ActionResponse> {
  return request(ROUTES.paneAnswer(paneId), { method: 'POST', body, timeoutMs });
}

/** Interrompre. Aucune authentification, aucune confirmation, aucun hash (A2, A7). */
export function postInterrupt(
  paneId: number,
  nonce: string,
  timeoutMs = 3500,
): Promise<ActionResponse> {
  return request(ROUTES.paneInterrupt(paneId), {
    method: 'POST',
    body: { nonce },
    timeoutMs,
  });
}

export function postText(
  paneId: number,
  text: string,
  nonce: string,
  timeoutMs = 6000,
): Promise<ActionResponse> {
  return request(ROUTES.paneText(paneId), {
    method: 'POST',
    body: { text, nonce },
    timeoutMs,
  });
}

/**
 * `Lancer Kova` (CA-123). Le daemon exécute `open -a Kova` : l'application se lance, ou
 * passe au premier plan si elle tournait déjà. Aucun octet n'atteint un pane.
 */
export function postKovaLaunch(timeoutMs = 8000): Promise<KovaLaunchResponse> {
  return request(ROUTES.kovaLaunch, { method: 'POST', timeoutMs });
}

/** Les commandes `/` de Claude Code visibles depuis le pane, pour l'autocomplétion. */
export function fetchCommands(paneId: number, timeoutMs = 6000): Promise<PaneCommandsResponse> {
  return request(ROUTES.paneCommands(paneId), { timeoutMs });
}

/**
 * Lancer `claude` dans un pane qui n'est qu'un shell. Le daemon tape la commande, toujours
 * `claude`, et refuse (409 `PANE_BUSY`) un pane qui porte déjà un agent ou un processus.
 */
export function startClaude(paneId: number, timeoutMs = 10_000): Promise<PaneStartClaudeResponse> {
  return request(ROUTES.paneStartClaude(paneId), { method: 'POST', timeoutMs });
}

/** Projets récents de Kova, pour l'écran « Nouvelle session » (Cmd+O). */
export function fetchRecentProjects(): Promise<KovaRecentProjectsResponse> {
  return request(ROUTES.kovaRecentProjects);
}

/**
 * `new-tab` sur un projet récent, désigné par son index ET son chemin : le daemon relit sa
 * liste et refuse si elle a bougé. La commande lancée est toujours `claude`, côté daemon.
 */
/** Fermer un pane : le seul geste destructeur, confirmé côté app avec l'état du pane. */
export function postClose(paneId: number, nonce: string, timeoutMs = 5000): Promise<ActionResponse> {
  return request(ROUTES.paneClose(paneId), { method: 'POST', body: { nonce }, timeoutMs });
}

/** Renommer l'onglet du pane. `null` : titre automatique de Kova. */
export function postTitle(paneId: number, title: string | null, timeoutMs = 5000): Promise<PaneTitleResponse> {
  const body: PaneTitleRequest = { title };
  return request(ROUTES.paneTitle(paneId), { method: 'POST', body, timeoutMs });
}

/** Nom de session au sens Claude (`/rename`), tapé par le daemon via KeyGate. */
export function postSessionName(paneId: number, name: string, timeoutMs = 10_000): Promise<PaneSessionNameResponse> {
  const body: PaneSessionNameRequest = { name };
  return request(ROUTES.paneSessionName(paneId), { method: 'POST', body, timeoutMs });
}

/** Favori : ajout ou retrait dans `bookmarks.json` de Kova. */
export function postBookmark(op: 'add' | 'remove', sessionId: string, timeoutMs = 5000): Promise<KovaBookmarkResponse> {
  const body: KovaBookmarkRequest = { op, sessionId };
  return request(ROUTES.kovaBookmark, { method: 'POST', body, timeoutMs });
}

/** Sessions ouvertes et fermees, comme les palettes de Kova (PRD 3.4). */
export function fetchSessions(): Promise<KovaSessionsResponse> {
  return request(ROUTES.kovaSessions);
}

/** Reprise d'une session fermée : `new-tab` + `claude --resume`, construit côté daemon. */
export function postResume(sessionId: string, timeoutMs = 12_000): Promise<KovaResumeResponse> {
  const body: KovaResumeRequest = { sessionId };
  return request(ROUTES.kovaResume, { method: 'POST', body, timeoutMs });
}

export function postNewTab(project: RecentProject, timeoutMs = 10_000): Promise<KovaNewTabResponse> {
  const body: KovaNewTabRequest = { recentProjectIndex: project.index, path: project.path };
  return request(ROUTES.kovaNewTab, { method: 'POST', body, timeoutMs });
}

/** Un pane de plus dans un onglet : le dossier du projet choisi, sinon celui de l'onglet. */
export function postSplit(tabId: number, project: RecentProject | null, timeoutMs = 10_000): Promise<KovaSplitResponse> {
  const body: KovaSplitRequest = project ? { tabId, recentProjectIndex: project.index, path: project.path } : { tabId };
  return request(ROUTES.kovaSplit, { method: 'POST', body, timeoutMs });
}

/**
 * Rang d'un onglet dans sa fenêtre, appliqué sur le Mac par `move-tab`. 501 `KOVA_TOO_OLD`
 * quand le Kova du Mac ne connaît pas la commande : l'app le dit, elle ne réessaie pas.
 */
export function postTabReorder(tabId: number, index: number, timeoutMs = 8000): Promise<TabReorderResponse> {
  const body: ReorderRequest = { index };
  return request(ROUTES.tabReorder(tabId), { method: 'POST', body, timeoutMs });
}

/** Rang d'un pane dans son onglet : une chaîne de `swap-pane` côté daemon. */
export function postPaneReorder(paneId: number, index: number, timeoutMs = 8000): Promise<PaneReorderResponse> {
  const body: ReorderRequest = { index };
  return request(ROUTES.paneReorder(paneId), { method: 'POST', body, timeoutMs });
}
