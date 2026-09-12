// La liste des sessions reproduit la STRUCTURE de Kova, pas un tri par état : un groupe
// par onglet, dans l'ordre de la barre d'onglets du Mac, et sous chaque onglet ses panes.
// Robin retrouve ainsi une session comme il la retrouve sur son Mac, par la couleur et le
// nom de l'onglet. Les états restent visibles en badge, à leur place. Module pur, testé
// sous Node.
import type { Pane, Tab } from '@/protocol';

export interface TabGroup {
  /** `w<window>-t<tab>` : stable d'un instantané à l'autre, sert de clé React. */
  key: string;
  window: number;
  tabId: number;
  /** Nom d'onglet tel que Kova l'affiche (`custom_title` sinon le titre par défaut). */
  title: string;
  color: number | null;
  /** Onglet au premier plan sur le Mac. */
  active: boolean;
  panes: Pane[];
}

/** Nom d'un onglet sans titre : celui de son premier pane, comme Kova le fait. */
function fallbackTitle(panes: Pane[], tabId: number): string {
  const first = panes[0];
  return first?.projectName || first?.title || `Onglet ${tabId}`;
}

/**
 * Groupes par onglet, ordonnés comme la barre d'onglets : fenêtre, puis `tab_index`.
 * L'ordre des panes dans un onglet est celui de `list-panes`. Un pane dont l'onglet n'est
 * pas (encore) connu forme son propre groupe, à la fin de sa fenêtre : la liste des
 * panes et celle des onglets arrivent par deux chemins, et un `pane-open` précède
 * parfois l'instantané des onglets.
 */
export function groupByTab(panes: Pane[], tabs: Tab[]): TabGroup[] {
  const byTab = new Map<string, TabGroup>();
  const keyOf = (window: number, tabId: number): string => `w${window}-t${tabId}`;

  for (const tab of tabs) {
    byTab.set(keyOf(tab.window, tab.id), {
      key: keyOf(tab.window, tab.id),
      window: tab.window,
      tabId: tab.id,
      title: tab.title ?? '',
      color: tab.color,
      active: tab.active,
      panes: [],
    });
  }
  for (const pane of panes) {
    const key = keyOf(pane.window, pane.tab);
    let group = byTab.get(key);
    if (!group) {
      group = {
        key,
        window: pane.window,
        tabId: pane.tab,
        title: '',
        color: pane.color ?? null,
        active: false,
        panes: [],
      };
      byTab.set(key, group);
    }
    group.panes.push(pane);
  }

  const order = new Map<string, number>();
  tabs.forEach((t) => order.set(keyOf(t.window, t.id), t.tab_index));
  const groups = [...byTab.values()].filter((g) => g.panes.length > 0);
  for (const g of groups) {
    if (g.title === '') g.title = fallbackTitle(g.panes, g.tabId);
  }
  return groups.sort((a, b) => {
    if (a.window !== b.window) return a.window - b.window;
    const ia = order.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const ib = order.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.tabId - b.tabId;
  });
}

/** Comparaison sans accents ni casse : « trail » trouve « TrailCoach », « lien » ne trouve rien. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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

/** Résumé d'un coup d'œil, tout en haut : « 1 en attente · 2 travaillent ». Vide sinon. */
export function summaryLine(panes: Pane[]): string | null {
  const awaiting = panes.filter((p) => p.awaiting).length;
  const working = panes.filter((p) => !p.awaiting && p.working).length;
  const parts: string[] = [];
  if (awaiting > 0) parts.push(`${awaiting} en attente`);
  if (working > 0) parts.push(working === 1 ? '1 travaille' : `${working} travaillent`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Vrai quand la liste s'étend sur plusieurs fenêtres Kova : un séparateur par fenêtre. */
export function windowCount(groups: TabGroup[]): number {
  return new Set(groups.map((g) => g.window)).size;
}
