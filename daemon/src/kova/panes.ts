import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import type { Pane, Tab } from '@kovalink/protocol';
import { hasTranscript, sessionMeta } from '../transcript/session.js';
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
  const sessionId = strOrNull(raw['agent_session_id']) ?? strOrNull(raw['claude_session_id']);
  const agent = strOrNull(raw['agent']);
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
    child_processes: Array.isArray(raw['child_processes'])
      ? (raw['child_processes'] as Record<string, unknown>[]).map((c) => ({
          name: str(c['name']),
          pid: num(c['pid']),
          version: strOrNull(c['version']),
        }))
      : [],
    is_idle: bool(raw['is_idle']),
    working,
    awaiting,
    awaiting_since: strOrNull(raw['awaiting_since']),
    awaiting_seen: bool(raw['awaiting_seen']),
    minimized: bool(raw['minimized']),
    agent,
    agent_session_id: strOrNull(raw['agent_session_id']),
    agent_session_name: strOrNull(raw['agent_session_name']),
    claude_session_id: strOrNull(raw['claude_session_id']),
    claude_session_name: strOrNull(raw['claude_session_name']),
    projectName: basename(cwd) || cwd,
    hasTranscript: transcript,
    chatCapable: agent === 'claude' && transcript,
    permissionMode: meta.permissionMode,
    color: colorOf(window, tabIndex),
    // Resolu par le `PaneStore` a partir de `list-tabs`, jamais par Kova.
    tabId: null,
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
export class PaneStore extends EventEmitter {
  private readonly panes = new Map<number, Pane>();
  private tabs: Tab[] = [];
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

  all(): Pane[] {
    // Tri de la liste : awaiting, puis working, puis idle (PRD A2/S2).
    const rank = { awaiting: 0, working: 1, idle: 2 } as const;
    return [...this.panes.values()].sort(
      (a, b) => rank[a.liveState] - rank[b.liveState] || a.id - b.id,
    );
  }

  allTabs(): Tab[] {
    return this.tabs;
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
    this.bumpEtag();
  }

  upsertRaw(raw: Record<string, unknown>): Pane {
    const pane = toPane(raw);
    this.applyPane(pane);
    this.bumpEtag();
    return pane;
  }

  private applyPane(incoming: Pane): void {
    const previous = this.panes.get(incoming.id);
    let pane: Pane = { ...incoming, tabId: this.tabIdOf(incoming.window, incoming.tab) };
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
