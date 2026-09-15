// La liste des sessions reproduit la STRUCTURE de Kova, pas un tri par état : un groupe
// par onglet, dans l'ordre de la barre d'onglets du Mac, et sous chaque onglet ses panes.
// Robin retrouve ainsi une session comme il la retrouve sur son Mac, par la couleur et le
// nom de l'onglet. Les états restent visibles en badge, à leur place. Module pur, testé
// sous Node.
import type { Pane, Tab } from '@/protocol';
import { fold } from '@/utils/search';
import { t } from '@/i18n/en';

export interface TabGroup {
  /** `t<id>` quand l'onglet est identifié, sinon `w<window>-i<tab_index>` en repli. */
  key: string;
  window: number;
  /** Index de l'onglet dans sa fenêtre : c'est ce que `pane.tab` porte. */
  tabIndex: number;
  /** Identifiant Kova de l'onglet, `null` tant que `list-tabs` ne l'a pas donné. */
  tabId: number | null;
  /** Nom d'onglet tel que `list-tabs` le rend en direct (`custom_title` sinon le défaut). */
  title: string;
  color: number | null;
  /** Onglet au premier plan sur le Mac. */
  active: boolean;
  panes: Pane[];
}

/** Nom d'un onglet dont `list-tabs` n'est pas encore arrivé : celui de son premier pane. */
function fallbackTitle(panes: Pane[], tabIndex: number): string {
  const first = panes[0];
  return first?.title || first?.projectName || t.tabFallbackTitle(tabIndex + 1);
}

const keyOfIndex = (window: number, tabIndex: number): string => `w${window}-i${tabIndex}`;
const keyOfId = (tabId: number): string => `t${tabId}`;

/**
 * Groupes par onglet, ordonnés comme la barre d'onglets : fenêtre, puis `tab_index`.
 *
 * LA JOINTURE : par `pane.tabId`, l'identifiant Kova de l'onglet, résolu par le daemon
 * en lisant `list-tabs` et `list-panes` au même instant. `pane.tab` n'est qu'un INDEX
 * qui change à chaque déplacement d'onglet sur le Mac : joindre sur cet index deux
 * listes reçues à des moments différents nommait l'onglet « Link » « Notes » après un
 * réordonnancement. `(window, tab)` ne sert plus que de repli quand `tabId` vaut
 * `null` (pane reçu par événement avant tout `list-tabs`).
 *
 * L'ordre des panes dans un onglet est celui de `list-panes`, tel que l'instantané du
 * daemon le porte (`PaneStore.all()`, depuis le 14 septembre 2026 ; trié par état avant,
 * ce qui faussait le rang envoyé par un glisser-déposer). Un pane dont l'onglet
 * n'est pas (encore) connu forme son propre groupe à son index. RIEN n'est filtré :
 * tous les onglets, tous les panes, agent ou pas, comme le sélecteur Cmd+P de Kova.
 */
export function groupByTab(panes: Pane[], tabs: Tab[]): TabGroup[] {
  const byKey = new Map<string, TabGroup>();
  const keyAtIndex = new Map<string, string>();

  for (const tab of tabs) {
    const key = keyOfId(tab.id);
    keyAtIndex.set(keyOfIndex(tab.window, tab.tab_index), key);
    byKey.set(key, {
      key,
      window: tab.window,
      tabIndex: tab.tab_index,
      tabId: tab.id,
      title: tab.title ?? '',
      color: tab.color,
      active: tab.active,
      panes: [],
    });
  }
  for (const pane of panes) {
    const indexKey = keyOfIndex(pane.window, pane.tab);
    const key =
      pane.tabId !== null && byKey.has(keyOfId(pane.tabId))
        ? keyOfId(pane.tabId)
        : (keyAtIndex.get(indexKey) ?? indexKey);
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        window: pane.window,
        tabIndex: pane.tab,
        tabId: null,
        title: '',
        color: pane.color ?? null,
        active: false,
        panes: [],
      };
      byKey.set(key, group);
    }
    group.panes.push(pane);
  }

  const groups = [...byKey.values()].filter((g) => g.panes.length > 0);
  for (const g of groups) {
    if (g.title === '') g.title = fallbackTitle(g.panes, g.tabIndex);
  }
  return groups.sort((a, b) => a.window - b.window || a.tabIndex - b.tabIndex);
}

/**
 * Pane sans agent reconnu par Kova mais avec un `claude` encore en processus enfant :
 * une session périmée, que Kova marque de même. Elle s'affiche, avec son badge, et
 * propose de relancer Claude dans ce dossier.
 */
export function isStaleSession(pane: Pane): boolean {
  // Un `claude` que le daemon vient de lancer n'est pas périmé : il démarre.
  return !pane.launching && pane.agent === null && pane.child_processes.some((c) => c.name === 'claude');
}

/**
 * Un shell nu : aucun agent, aucun processus, rien en cours de démarrage (un pane que
 * Kova a restauré au redémarrage sans Claude, par exemple). Le seul pane où l'app
 * propose « Start Claude here » ; le daemon refuse les autres (409).
 */
export function isBareShell(pane: Pane): boolean {
  return !pane.launching && pane.agent === null && pane.child_processes.length === 0;
}

/** Ce sur quoi la recherche porte pour un pane : titre, projet, dossier, agent, session. */
function paneHaystack(p: Pane): string {
  return fold(
    [p.title, p.projectName, p.cwd, p.agent, p.agent_session_name, p.claude_session_name]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join(' '),
  );
}

/**
 * Filtre par mots (tous requis), sur le nom de l'onglet ET sur ses panes, SANS casser le
 * regroupement : un onglet dont le nom correspond garde tous ses panes ; sinon il ne
 * garde que les panes qui correspondent, et disparaît s'il n'en reste aucun.
 */
export function filterGroups(groups: TabGroup[], query: string): TabGroup[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return groups;
  const matches = (hay: string): boolean => words.every((w) => hay.includes(w));
  const out: TabGroup[] = [];
  for (const g of groups) {
    if (matches(fold(g.title))) {
      out.push(g);
      continue;
    }
    const panes = g.panes.filter((p) => matches(paneHaystack(p)));
    if (panes.length > 0) out.push({ ...g, panes });
  }
  return out;
}

/**
 * Résumé d'un coup d'œil, tout en haut : « 1 waiting · 2 working ». Vide sinon. Les non
 * lus n'y figurent pas : le bouton Next de la barre basse porte déjà leur compteur.
 */
export function summaryLine(panes: Pane[]): string | null {
  const awaiting = panes.filter((p) => p.awaiting).length;
  const working = panes.filter((p) => !p.awaiting && p.working).length;
  const parts: string[] = [];
  if (awaiting > 0) parts.push(t.summaryWaiting(awaiting));
  if (working > 0) parts.push(t.summaryWorking(working));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Ce qu'un onglet replié montre encore : combien de panes, et s'il en attend ou en travaille. */
export interface CollapsedSummary {
  count: number;
  awaiting: boolean;
  working: boolean;
}

/**
 * Résumé d'un onglet replié : rien d'important ne se cache. `awaiting` l'emporte sur
 * `working` (états exclusifs par pane), mais l'onglet peut porter les deux.
 */
export function collapsedSummary(group: TabGroup): CollapsedSummary {
  return {
    count: group.panes.length,
    awaiting: group.panes.some((p) => p.awaiting),
    working: group.panes.some((p) => !p.awaiting && p.working),
  };
}

/** `kova` : l'ordre de la barre d'onglets du Mac. `activity` : ce qui bouge d'abord. */
export type TabSortMode = 'kova' | 'activity';

/** Rang d'un onglet par activité : 0 s'il travaille, 1 s'il attend, 2 sinon. */
function activityRank(group: TabGroup): number {
  const s = collapsedSummary(group);
  return s.working ? 0 : s.awaiting ? 1 : 2;
}

/**
 * La liste dans l'ordre demandé. `kova` la rend telle quelle. `activity` met d'abord les
 * onglets où un pane travaille, puis ceux où un pane attend, puis les autres, chaque
 * paquet gardant l'ordre de Kova (tri stable), toutes fenêtres confondues.
 */
export function sortGroups(groups: TabGroup[], mode: TabSortMode): TabGroup[] {
  if (mode === 'kova') return groups;
  return groups
    .map((group, index) => ({ group, index, rank: activityRank(group) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.group);
}

/** Vrai quand la liste s'étend sur plusieurs fenêtres Kova : un séparateur par fenêtre. */
export function windowCount(groups: TabGroup[]): number {
  return new Set(groups.map((g) => g.window)).size;
}

// --- Réordonnancement (glisser-déposer) ---------------------------------------------

/** Ordre en attente d'un déplacement d'onglet : les identifiants Kova d'une fenêtre. */
export interface PendingTabs {
  window: number;
  order: number[];
  since: number;
}

/** Ordre en attente d'un déplacement de pane : les identifiants de panes d'un onglet. */
export interface PendingPanes {
  tabId: number;
  order: number[];
  since: number;
}

/** Copie de `list` où l'élément `from` est déplacé au rang `to` (borné). */
export function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1) as [T];
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}

/**
 * `items` dans l'ordre de `order` (par identifiant) : un identifiant absent de `items`
 * est ignoré, un élément inconnu de `order` vient à la fin, dans son ordre d'origine.
 */
function orderBy<T>(items: T[], idOf: (item: T) => number | null, order: number[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const known: T[] = [];
  const unknown: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (id !== null && rank.has(id)) known.push(item);
    else unknown.push(item);
  }
  known.sort((a, b) => (rank.get(idOf(a) as number) ?? 0) - (rank.get(idOf(b) as number) ?? 0));
  return [...known, ...unknown];
}

/** Identifiants Kova des onglets d'une fenêtre, dans l'ordre affiché. */
export function tabOrderOf(groups: TabGroup[], window: number): number[] {
  return groups.filter((g) => g.window === window && g.tabId !== null).map((g) => g.tabId as number);
}

/**
 * La liste telle que le Mac la montrera une fois le déplacement confirmé : les ordres en
 * attente s'appliquent par dessus l'instantané. Seule la liste Sessions s'en sert ;
 * `groupByTab` reste l'ordre du Mac. Le `tabIndex` est renuméroté dans la fenêtre touchée.
 */
export function applyPendingOrder(
  groups: TabGroup[],
  tabs: PendingTabs | null,
  panes: Record<number, PendingPanes>,
): TabGroup[] {
  let out = groups.map((g) => {
    const pending = g.tabId !== null ? panes[g.tabId] : undefined;
    return pending ? { ...g, panes: orderBy(g.panes, (p) => p.id, pending.order) } : g;
  });
  if (tabs) {
    const inWindow = orderBy(
      out.filter((g) => g.window === tabs.window),
      (g) => g.tabId,
      tabs.order,
    ).map((g, i) => ({ ...g, tabIndex: i }));
    out = [...out.filter((g) => g.window !== tabs.window), ...inWindow].sort(
      (a, b) => a.window - b.window || a.tabIndex - b.tabIndex,
    );
  }
  return out;
}

/** Un pane de la palette Cmd+P, avec son onglet : l'ordre est celui des onglets puis des panes. */
export interface PaletteEntry {
  pane: Pane;
  group: TabGroup;
}

/**
 * Tous les panes de tous les onglets, à plat, dans l'ordre du sélecteur de Kova
 * (`open-pane-switcher`) : fenêtre, onglet, pane. Filtré par mots sur le nom de
 * l'onglet, le titre du pane, le projet, le dossier et l'agent.
 */
export function paletteEntries(groups: TabGroup[], query: string): PaletteEntry[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 0);
  const out: PaletteEntry[] = [];
  for (const group of groups) {
    for (const pane of group.panes) {
      if (words.length > 0) {
        const hay = `${fold(group.title)} ${paneHaystack(pane)}`;
        if (!words.every((w) => hay.includes(w))) continue;
      }
      out.push({ pane, group });
    }
  }
  return out;
}
