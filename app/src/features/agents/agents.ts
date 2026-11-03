// Comptes et filtres de l'onglet Agents (P06). Module pur : les panes, les onglets, le
// trombinoscope et les debuts de travail arrivent en argument, rien n'est lu d'un magasin
// ni d'une horloge implicite. C'est ce qui rend les tests fixes.
//
// Un pane compte dans UNE colonne : une erreur l'emporte (le tour est mort), puis un shell
// nu (aucun agent, aucun processus : il est au repos), puis une question en attente, puis
// le travail, puis le repos. Le total de la tuile « Need you » vient du daemon
// (`waitsOnYou`), qui voit aussi les permissions : les panes en attente ne servent qu'aux
// colonnes de « By tab ».
import type { Pane, RosterEntry, Tab } from '@/protocol';
import { groupByTab, isBareShell } from '@/features/sessions/tabGroups';
import { t } from '@/i18n/en';

/** La tuile selectionnee sous les comptes, et donc la liste affichee dessous. */
export type AgentFilter = 'working' | 'needYou' | 'idle' | 'error';

/** Les quatre colonnes, dans l'ordre des tuiles et de la legende de « By tab ». */
export interface AgentCounts {
  needYou: number;
  working: number;
  error: number;
  idle: number;
}

/** Les panes ranges par compte. */
export interface PaneSplit {
  working: Pane[];
  needYou: Pane[];
  idle: Pane[];
  error: Pane[];
}

export function paneCategory(pane: Pane): AgentFilter {
  if (pane.error) return 'error';
  if (isBareShell(pane)) return 'idle';
  if (pane.awaiting) return 'needYou';
  if (pane.working) return 'working';
  return 'idle';
}

export function splitPanes(panes: readonly Pane[]): PaneSplit {
  const split: PaneSplit = { working: [], needYou: [], idle: [], error: [] };
  for (const pane of panes) split[paneCategory(pane)].push(pane);
  return split;
}

export function countsOf(panes: readonly Pane[]): AgentCounts {
  const counts: AgentCounts = { needYou: 0, working: 0, error: 0, idle: 0 };
  for (const pane of panes) counts[paneCategory(pane)] += 1;
  return counts;
}

/**
 * Les panes qui travaillent, le plus ancien debut d'abord : le travail le plus long en
 * tete. Un pane dont l'app ne connait pas le debut passe en dernier, a egalite trie par
 * identifiant pour que deux instantanes identiques donnent le meme ordre.
 */
export function workingFirst(
  panes: readonly Pane[],
  since: Readonly<Record<number, number>>,
): Pane[] {
  return [...panes].sort((a, b) => {
    const da = since[a.id] ?? Number.POSITIVE_INFINITY;
    const db = since[b.id] ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da < db ? -1 : 1;
    return a.id - b.id;
  });
}

/** Une ligne de « By tab » : l'onglet de Kova et ses quatre comptes. */
export interface TabCounts {
  key: string;
  title: string;
  color: number | null;
  counts: AgentCounts;
}

/**
 * Une ligne par onglet de Kova, dans l'ordre de la barre d'onglets : un onglet sans pane
 * garde sa ligne a zero, et un pane recu avant `list-tabs` garde la sienne en repli.
 */
export function tabCounts(panes: Pane[], tabs: Tab[]): TabCounts[] {
  const groups = groupByTab(panes, tabs);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const rows: TabCounts[] = [];
  const seen = new Set<string>();
  for (const tab of [...tabs].sort((a, b) => a.window - b.window || a.tab_index - b.tab_index)) {
    const key = `t${tab.id}`;
    const group = byKey.get(key);
    seen.add(key);
    rows.push({
      key,
      title: group?.title ?? tab.title ?? t.tabFallbackTitle(tab.tab_index + 1),
      color: group?.color ?? tab.color,
      counts: countsOf(group?.panes ?? []),
    });
  }
  for (const group of groups) {
    if (seen.has(group.key)) continue;
    rows.push({ key: group.key, title: group.title, color: group.color, counts: countsOf(group.panes) });
  }
  return rows;
}

/** Nom de l'onglet d'un pane : son identifiant Kova d'abord, son index en repli. */
export function tabNameFor(pane: Pane, tabs: readonly Tab[]): string {
  const found =
    (pane.tabId !== null ? tabs.find((x) => x.id === pane.tabId) : undefined) ??
    tabs.find((x) => x.window === pane.window && x.tab_index === pane.tab);
  return found?.title ?? t.tabFallbackTitle(pane.tab + 1);
}

export interface RosterRow {
  entry: RosterEntry;
  /** Le pane de cette session dans l'instantane, `null` quand elle n'y est pas. */
  pane: Pane | null;
  /** Ce que `team` en dit : une session fermee porte le bouton Open. */
  open: boolean;
}

/**
 * Le pane d'une session de l'equipe : son nom de session Claude d'abord (c'est celui que
 * `team spawn` fixe), le titre du pane en repli. La comparaison ignore la casse et les
 * espaces, le nom garde son tiret.
 */
export function findAgentPane(panes: readonly Pane[], name: string): Pane | null {
  const target = name.trim().toLowerCase();
  const named = panes.find(
    (p) =>
      (typeof p.agent_session_name === 'string' && p.agent_session_name.trim().toLowerCase() === target) ||
      (typeof p.claude_session_name === 'string' && p.claude_session_name.trim().toLowerCase() === target),
  );
  if (named) return named;
  return (
    panes.find((p) => typeof p.title === 'string' && p.title.trim().toLowerCase() === target) ?? null
  );
}

export function rosterRows(entries: readonly RosterEntry[], panes: readonly Pane[]): RosterRow[] {
  return entries.map((entry) => ({
    entry,
    pane: findAgentPane(panes, entry.name),
    open: entry.state !== 'closed',
  }));
}
