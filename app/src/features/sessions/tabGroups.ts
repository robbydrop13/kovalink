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
 * listes reçues à des moments différents nommait l'onglet « Link » « Perso » après un
 * réordonnancement. `(window, tab)` ne sert plus que de repli quand `tabId` vaut
 * `null` (pane reçu par événement avant tout `list-tabs`).
 *
 * L'ordre des panes dans un onglet est celui de `list-panes`. Un pane dont l'onglet
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

/** Vrai quand la liste s'étend sur plusieurs fenêtres Kova : un séparateur par fenêtre. */
export function windowCount(groups: TabGroup[]): number {
  return new Set(groups.map((g) => g.window)).size;
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
