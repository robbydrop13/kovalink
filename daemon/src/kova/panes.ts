import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import type { Pane, Tab } from '@kovalink/protocol';
import { hasTranscript, sessionMeta } from '../transcript/session.js';
import { liveSessionOf } from './liveSession.js';
import { colorOf } from './tabColors.js';

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}
function bool(v: unknown): boolean {
  return v === true;
}

/** Mappe un pane brut de Kova vers le type partage, champs calcules compris. */
export function toPane(raw: Record<string, unknown>): Pane {
  const cwd = str(raw['cwd']);
  const children = Array.isArray(raw['child_processes'])
    ? (raw['child_processes'] as Record<string, unknown>[]).map((c) => ({
        name: str(c['name']),
        pid: num(c['pid']),
        version: strOrNull(c['version']),
      }))
    : [];
  // Repli : Kova rend `agent: null` sur une session Claude dont `startedAt` est trop
  // loin du demarrage du processus (voir `liveSession.ts`). Un enfant `claude` avec un
  // fichier de session vivant EST une session Claude.
  const live =
    strOrNull(raw['agent']) === null && children.some((c) => c.name === 'claude')
      ? liveSessionOf(children.filter((c) => c.name === 'claude').map((c) => c.pid))
      : null;
  const sessionId = strOrNull(raw['agent_session_id']) ?? strOrNull(raw['claude_session_id']) ?? live?.id ?? null;
  const agent = strOrNull(raw['agent']) ?? (live ? 'claude' : null);
  const transcript = hasTranscript(cwd, sessionId);
  const meta = sessionId ? sessionMeta(cwd, sessionId) : { permissionMode: null, title: null };
  const awaiting = bool(raw['awaiting']);
  const working = bool(raw['working']);
  const window = num(raw['window']);
  // `pane.tab` est l'INDEX de l'onglet, pas son identifiant : verifie sur la machine,
  // le pane 66 porte `tab: 1` et l'onglet d'identifiant 32 porte `tab_index: 1`.
  const tabIndex = num(raw['tab']);
  return {
    id: num(raw['id'], -1),
    window,
    tab: tabIndex,
    cwd,
    title: strOrNull(raw['title']),
    focused: bool(raw['focused']),
    pid: num(raw['pid']),
    child_processes: children,
    is_idle: bool(raw['is_idle']),
    working,
    awaiting,
    awaiting_since: strOrNull(raw['awaiting_since']),
    awaiting_seen: bool(raw['awaiting_seen']),
    minimized: bool(raw['minimized']),
    agent,
    agent_session_id: strOrNull(raw['agent_session_id']) ?? live?.id ?? null,
    agent_session_name: strOrNull(raw['agent_session_name']) ?? live?.name ?? null,
    claude_session_id: strOrNull(raw['claude_session_id']) ?? live?.id ?? null,
    claude_session_name: strOrNull(raw['claude_session_name']) ?? live?.name ?? null,
    projectName: basename(cwd) || cwd,
    hasTranscript: transcript,
    // Une session claude fraiche a un identifiant mais pas encore de JSONL (cree au
    // premier message) : c'est une conversation vide, le chat s'ouvre quand meme.
    chatCapable: agent === 'claude' && sessionId !== null,
    permissionMode: meta.permissionMode,
    color: colorOf(window, tabIndex),
    // Resolu par le `PaneStore` a partir de `list-tabs`, jamais par Kova.
    tabId: null,
    // Pose par le `PaneStore` (`markLaunching`), jamais par Kova.
    launching: false,
    // 3 etats exclusifs : `awaiting` l'emporte sur `working` (PRD A2).
    liveState: awaiting ? 'awaiting' : working ? 'working' : 'idle',
  };
}

export function toTab(raw: Record<string, unknown>): Tab {
  const window = num(raw['window']);
  const tabIndex = num(raw['tab_index']);
  return {
    id: num(raw['id'], -1),
    window,
    tab_index: tabIndex,
    title: strOrNull(raw['title']),
    pane_count: num(raw['pane_count']),
    focused_pane_id: num(raw['focused_pane_id'], -1),
    active: bool(raw['active']),
    has_bell: bool(raw['has_bell']),
    has_completion: bool(raw['has_completion']),
    has_running: bool(raw['has_running']),
    color: colorOf(window, tabIndex),
  };
}

export interface WorkingTransition {
  paneId: number;
  working: boolean;
  /** Duree du travail qui vient de se terminer, en ms. Null sur un front montant. */
  workedMs: number | null;
}

/**
 * Etat des panes, alimente par `subscribe` et par `list-panes`.
 *
 * Emet `working` sur CHAQUE transition de `pane-working`, avec la duree du travail.
 * Le front DESCENDANT est le declencheur de fin de tour du lot 1 (D1) : sur cette
 * machine `pane-status` ne se declenche jamais et `awaiting` reste `false` partout,
 * il n'est donc jamais utilise comme declencheur.
 */
/**
 * Fenetre pendant laquelle un pane ou le daemon vient de lancer `claude` est « en
 * demarrage » plutot que « sans agent ». Mesure du 13 septembre 2026 : Claude Code met
 * 3 a 10 s a ecrire sa session, et l'ecran de confiance d'un dossier neuf attend Robin.
 */
export const LAUNCH_GRACE_MS = 90_000;

export class PaneStore extends EventEmitter {
  private readonly panes = new Map<number, Pane>();
  private tabs: Tab[] = [];
  /** Panes ou le daemon a lance `claude`, et quand. Vide des que l'agent apparait. */
  private readonly launchedAt = new Map<number, number>();
  private readonly launchTimers = new Map<number, NodeJS.Timeout>();
  private readonly workingSince = new Map<number, number>();
  /**
   * Panes dont `awaiting` est SYNTHETISE par le daemon (`PromptDetector`), pas par Kova.
   * Mesure du 11 septembre 2026, Kova 1.11, Claude Code 2.1.268 en mode de permission par
   * defaut : un vrai prompt de permission a l'ecran ne leve JAMAIS `pane-status.awaiting`,
   * seul `pane-working` bascule. Les instantanes de Kova disent donc `awaiting: false`
   * pendant qu'une question attend : on preserve notre etat au lieu de le laisser ecraser.
   */
  private readonly syntheticAwaiting = new Set<number>();
  appActive = false;
  focusPaneId: number | null = null;
  /**
   * L'etag porte l'identifiant de cette instance de daemon. Sans lui, un daemon
   * redemarre repartirait de `0` et un etag garde par l'app pourrait coincider avec un
   * etat different : la reprise servirait alors une liste perimee.
   */
  private readonly instanceId = randomBytes(4).toString('base64url');
  private revision = 0;
  etag = '';
  /** Horloge injectable : le seuil de 60 s se teste a sa vraie valeur, sans attendre. */
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    super();
    this.now = now;
    this.bumpEtag();
  }

  get(paneId: number): Pane | undefined {
    return this.panes.get(paneId);
  }

  /**
   * Tous les panes dans l'ORDRE DE KOVA (celui de `list-panes`), le meme que `inTab` : c'est
   * l'ordre que l'app affiche sous chaque onglet et sur lequel elle calcule le rang d'un
   * pane deplace (`POST /v1/panes/:id/reorder`). Jusqu'au 14 septembre 2026 la liste etait
   * triee par etat (attend, travaille, inactif ; PRD A2/S2, d'avant le regroupement par
   * onglet) : l'app montrait un pane qui travaille AVANT ses voisins, et le rang qu'elle
   * envoyait ne voulait rien dire pour la chaine de `swap-pane` (`from=0 to=0 swaps=0`).
   * Les etats sont des badges, pas un tri.
   */
  all(): Pane[] {
    return [...this.panes.values()];
  }

  allTabs(): Tab[] {
    return this.tabs;
  }

  /**
   * Les panes d'un onglet dans l'ORDRE DE KOVA (celui de `list-panes`, ses feuilles de
   * gauche a droite puis de haut en bas), pas dans l'ordre d'affichage de `all()`. C'est
   * l'ordre que `swap-pane` manipule : un deplacement de pane se calcule dessus.
   */
  inTab(window: number, tab: number): Pane[] {
    return [...this.panes.values()].filter((p) => p.window === window && p.tab === tab);
  }

  setTabs(raw: Record<string, unknown>[]): void {
    this.tabs = raw.map(toTab);
    // Les onglets ont pu etre deplaces : chaque pane reprend l'identifiant de l'onglet
    // qui se trouve MAINTENANT a son index.
    for (const [id, pane] of this.panes) {
      const tabId = this.tabIdOf(pane.window, pane.tab);
      if (tabId !== pane.tabId) this.panes.set(id, { ...pane, tabId });
    }
    this.bumpEtag();
  }

  /** Identifiant de l'onglet a cet index, `null` tant que `list-tabs` ne l'a pas donne. */
  private tabIdOf(window: number, tabIndex: number): number | null {
    return this.tabs.find((t) => t.window === window && t.tab_index === tabIndex)?.id ?? null;
  }

  /** Remplacement complet. Le client REMPLACE aussi, il ne fusionne pas. */
  replaceAll(raw: Record<string, unknown>[]): void {
    const seen = new Set<number>();
    for (const r of raw) {
      const pane = toPane(r);
      seen.add(pane.id);
      this.applyPane(pane);
    }
    for (const id of [...this.panes.keys()]) {
      if (!seen.has(id)) this.remove(id, null, null);
    }
    // Un `Map` garde le rang de la premiere insertion : apres un `swap-pane` sur le Mac,
    // Kova liste les panes dans un autre ordre et le notre restait fige. On realigne le
    // rang d'iteration sur celui de `list-panes`, dont `inTab` depend.
    const order = [...seen];
    const keys = [...this.panes.keys()];
    if (order.some((id, i) => keys[i] !== id)) {
      const current = new Map(this.panes);
      this.panes.clear();
      for (const id of order) {
        const pane = current.get(id);
        if (pane) this.panes.set(id, pane);
      }
    }
    this.bumpEtag();
  }

  upsertRaw(raw: Record<string, unknown>): Pane {
    const pane = toPane(raw);
    this.applyPane(pane);
    this.bumpEtag();
    return pane;
  }

  /**
   * Le daemon vient d'envoyer l'Entree qui lance `claude` dans ce pane : il est « en
   * demarrage » jusqu'a ce que Kova voie l'agent, ou pendant `LAUNCH_GRACE_MS` au plus.
   */
  markLaunching(paneId: number): void {
    this.launchedAt.set(paneId, this.now());
    const old = this.launchTimers.get(paneId);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this.launchTimers.delete(paneId);
      this.refreshLaunching(paneId);
    }, LAUNCH_GRACE_MS);
    timer.unref();
    this.launchTimers.set(paneId, timer);
    this.refreshLaunching(paneId);
  }

  private launchingOf(pane: Pane): boolean {
    const at = this.launchedAt.get(pane.id);
    if (at === undefined) return false;
    if (pane.agent !== null || this.now() - at >= LAUNCH_GRACE_MS) {
      this.launchedAt.delete(pane.id);
      return false;
    }
    return true;
  }

  private refreshLaunching(paneId: number): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    const launching = this.launchingOf(pane);
    if (launching === pane.launching) return;
    this.panes.set(paneId, { ...pane, launching });
    this.bumpEtag();
    this.emit('launching', paneId, launching);
  }

  private applyPane(incoming: Pane): void {
    const previous = this.panes.get(incoming.id);
    let pane: Pane = { ...incoming, tabId: this.tabIdOf(incoming.window, incoming.tab) };
    pane = { ...pane, launching: this.launchingOf(pane) };
    // Kova sait : son etat reel prend le pas sur notre synthese.
    if (incoming.awaiting) this.syntheticAwaiting.delete(incoming.id);
    if (previous && !incoming.awaiting && this.syntheticAwaiting.has(incoming.id)) {
      pane = {
        ...pane,
        awaiting: true,
        awaiting_since: previous.awaiting_since,
        liveState: 'awaiting',
      };
    }
    this.panes.set(pane.id, pane);
    if (pane.working && !this.workingSince.has(pane.id)) {
      this.workingSince.set(pane.id, this.now());
    }
    if (!pane.working) this.workingSince.delete(pane.id);
    if (!previous) this.emit('open', pane);
  }

  remove(paneId: number, window: number | null, tab: number | null): void {
    const pane = this.panes.get(paneId);
    this.panes.delete(paneId);
    this.workingSince.delete(paneId);
    this.syntheticAwaiting.delete(paneId);
    this.launchedAt.delete(paneId);
    const timer = this.launchTimers.get(paneId);
    if (timer) clearTimeout(timer);
    this.launchTimers.delete(paneId);
    this.bumpEtag();
    if (pane) this.emit('close', paneId, window ?? pane.window, tab ?? pane.tab);
  }

  setWorking(paneId: number, working: boolean): WorkingTransition | null {
    const pane = this.panes.get(paneId);
    if (!pane) return null;
    if (pane.working === working) return null;
    const startedAt = this.workingSince.get(paneId);
    const workedMs = !working && startedAt ? this.now() - startedAt : null;
    const next: Pane = {
      ...pane,
      working,
      liveState: pane.awaiting ? 'awaiting' : working ? 'working' : 'idle',
    };
    this.panes.set(paneId, next);
    if (working) this.workingSince.set(paneId, this.now());
    else this.workingSince.delete(paneId);
    this.bumpEtag();
    const transition: WorkingTransition = { paneId, working, workedMs };
    this.emit('working', transition, next);
    return transition;
  }

  /**
   * `source: 'daemon'` marque un `awaiting` synthetise a partir de l'ecran. Un
   * `awaiting: false` venant de Kova ne l'efface pas, seul le daemon peut le lever.
   */
  setAwaiting(
    paneId: number,
    awaiting: boolean,
    awaitingSince: string | null,
    source: 'kova' | 'daemon' = 'kova',
  ): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    if (source === 'kova' && !awaiting && this.syntheticAwaiting.has(paneId)) return;
    if (source === 'daemon' && awaiting) this.syntheticAwaiting.add(paneId);
    else this.syntheticAwaiting.delete(paneId);
    const next: Pane = {
      ...pane,
      awaiting,
      awaiting_since: awaitingSince,
      liveState: awaiting ? 'awaiting' : pane.working ? 'working' : 'idle',
    };
    this.panes.set(paneId, next);
    this.bumpEtag();
    this.emit('awaiting', next);
  }

  isSyntheticAwaiting(paneId: number): boolean {
    return this.syntheticAwaiting.has(paneId);
  }

  workingDurationMs(paneId: number): number | null {
    const since = this.workingSince.get(paneId);
    return since ? this.now() - since : null;
  }

  anyWorking(): boolean {
    return [...this.panes.values()].some((p) => p.working);
  }

  findBySession(sessionId: string): Pane | undefined {
    return [...this.panes.values()].find(
      (p) => p.agent_session_id === sessionId || p.claude_session_id === sessionId,
    );
  }

  private bumpEtag(): void {
    this.revision += 1;
    this.etag = `${this.instanceId}-${this.revision}`;
  }
}
