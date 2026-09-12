// La liste des sessions reproduit la structure de Kova. Données calquées sur `list-tabs`
// et `list-panes` de la machine de Robin le 12 septembre : six onglets colorés, un pane
// chacun sauf « Link » qui en a deux.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pane, Tab } from '@/protocol';
import { filterGroups, groupByTab, isStaleSession, summaryLine, windowCount } from '@/features/sessions/tabGroups';

function pane(partial: Partial<Pane> & { id: number; tab: number }): Pane {
  return {
    window: 0,
    cwd: '/Users/robin/dev/x',
    title: 'claude',
    focused: false,
    pid: 1,
    child_processes: [],
    is_idle: false,
    working: false,
    awaiting: false,
    awaiting_since: null,
    awaiting_seen: false,
    minimized: false,
    agent: 'claude',
    agent_session_id: null,
    agent_session_name: null,
    claude_session_id: null,
    claude_session_name: null,
    projectName: 'x',
    hasTranscript: false,
    chatCapable: true,
    permissionMode: null,
    color: null,
    liveState: 'idle',
    ...partial,
  };
}

function tab(partial: Partial<Tab> & { id: number; tab_index: number }): Tab {
  return {
    window: 0,
    title: null,
    pane_count: 1,
    focused_pane_id: 0,
    active: false,
    has_bell: false,
    has_completion: false,
    has_running: false,
    color: null,
    ...partial,
  };
}

// État réel de Kova le 12 septembre à 17:29 (`list-tabs` et `list-panes`, lecture seule).
// `pane.tab` est un INDEX : le pane 11 porte `tab: 3`, et l'onglet d'index 3 est
// « TrailCoach » (id 10). L'onglet d'ID 3 est « Link ». Une jointure sur l'id mettait
// trail-coach sous « Link » et nommait les autres onglets par leur projet.
const TABS: Tab[] = [
  tab({ id: 11, tab_index: 0, title: 'Courses', color: 2 }),
  tab({ id: 3, tab_index: 1, title: 'Link', color: 3, pane_count: 2, active: true }),
  tab({ id: 18, tab_index: 2, title: 'QR appairage', color: 3 }),
  tab({ id: 10, tab_index: 3, title: 'TrailCoach', color: 4 }),
  tab({ id: 8, tab_index: 4, title: 'Dollary', color: 5 }),
];

// Volontairement dans le désordre : l'ordre affiché vient de `tab_index`, pas de la liste.
const PANES: Pane[] = [
  pane({ id: 9, tab: 4, cwd: '/Users/robin/AI directory/Perso/Investissements', projectName: 'Investissements', agent: null, title: 'claude', child_processes: [{ name: 'claude', pid: 28232, version: null }] }),
  pane({ id: 13, tab: 0, cwd: '/Users/robin/AI directory/Perso', projectName: 'Perso', working: true }),
  pane({ id: 4, tab: 1, cwd: '/Users/robin/dev/link', projectName: 'link', agent: null, title: '..al-tools/link' }),
  pane({ id: 3, tab: 1, cwd: '/Users/robin/dev/link', projectName: 'link', awaiting: true, awaiting_since: '2026-09-12T13:11:43.000Z' }),
  pane({ id: 20, tab: 2, cwd: '/Users/robin/dev/link', projectName: 'link', agent: null, title: '..al-tools/link' }),
  pane({ id: 11, tab: 3, cwd: '/Users/robin/AI directory/Perso/Sport/trail-coach', projectName: 'trail-coach', working: true }),
];

describe('groupByTab', () => {
  it('joint pane.tab à tab.tab_index, jamais à tab.id : le pane 11 (tab 3) tombe sous TrailCoach', () => {
    const groups = groupByTab(PANES, TABS);
    assert.deepEqual(
      groups.map((g) => [g.title, g.tabId, g.color, g.panes.map((p) => p.id)]),
      [
        ['Courses', 11, 2, [13]],
        ['Link', 3, 3, [4, 3]],
        ['QR appairage', 18, 3, [20]],
        ['TrailCoach', 10, 4, [11]],
        ['Dollary', 8, 5, [9]],
      ],
    );
    const trail = groups.find((g) => g.panes.some((p) => p.id === 11));
    assert.equal(trail?.title, 'TrailCoach');
    assert.notEqual(trail?.title, 'Link');
  });

  it('tous les onglets et tous les panes, agent ou pas : rien n’est filtré (Cmd+P)', () => {
    const groups = groupByTab(PANES, TABS);
    assert.equal(groups.length, TABS.length);
    assert.equal(groups.flatMap((g) => g.panes).length, PANES.length);
    assert.deepEqual(groups.map((g) => g.title), ['Courses', 'Link', 'QR appairage', 'TrailCoach', 'Dollary']);
  });

  it('marque l’onglet actif sur le Mac', () => {
    const active = groupByTab(PANES, TABS).filter((g) => g.active);
    assert.deepEqual(active.map((g) => g.title), ['Link']);
  });

  it('un pane dont l’onglet n’est pas encore connu forme son propre groupe, à son index', () => {
    const orphan = pane({ id: 21, tab: 5, cwd: '/private/tmp', projectName: 'tmp', agent: null, title: '/private/tmp', color: null });
    const groups = groupByTab([...PANES, orphan], TABS);
    const last = groups[groups.length - 1];
    assert.equal(last?.tabIndex, 5);
    assert.equal(last?.tabId, null);
    assert.equal(last?.title, '/private/tmp', 'le titre Kova du premier pane sert de nom');
    assert.deepEqual(last?.panes.map((p) => p.id), [21]);
  });

  it('un onglet sans pane n’apparaît pas ; une seconde fenêtre vient après la première', () => {
    const tabs = [...TABS, tab({ id: 30, tab_index: 0, window: 1, title: 'Autre fenêtre' }), tab({ id: 31, tab_index: 7, title: 'Vide' })];
    const panes = [...PANES, pane({ id: 40, tab: 0, window: 1, projectName: 'autre' })];
    const groups = groupByTab(panes, tabs);
    assert.equal(groups.some((g) => g.title === 'Vide'), false);
    assert.equal(groups[groups.length - 1]?.title, 'Autre fenêtre');
    assert.equal(groups[0]?.title, 'Courses', 'la fenêtre 1 ne se mélange pas à la fenêtre 0');
    assert.equal(windowCount(groups), 2);
    assert.equal(windowCount(groupByTab(PANES, TABS)), 1);
  });

  it('une session périmée : agent perdu par Kova mais claude encore en processus enfant', () => {
    assert.equal(isStaleSession(PANES[0] as Pane), true, 'pane 9');
    assert.equal(isStaleSession(PANES[2] as Pane), false, 'un shell sans processus');
    assert.equal(isStaleSession(PANES[1] as Pane), false, 'un agent vivant');
  });
});

describe('filterGroups', () => {
  const groups = groupByTab(PANES, TABS);

  it('sans requête, rend la même référence', () => {
    assert.equal(filterGroups(groups, '  '), groups);
  });

  it('un nom d’onglet qui correspond garde TOUS ses panes, accents et casse ignorés', () => {
    const out = filterGroups(groups, 'LINK');
    assert.deepEqual(out.map((g) => [g.title, g.panes.length]), [['Link', 2], ['QR appairage', 1]]);
    assert.deepEqual(filterGroups(groups, 'trail').map((g) => g.title), ['TrailCoach']);
    assert.deepEqual(filterGroups(groups, 'Dollary').map((g) => g.title), ['Dollary']);
  });

  it('sinon ne garde que les panes qui correspondent, et retire l’onglet vidé', () => {
    const out = filterGroups(groups, 'investissements');
    assert.deepEqual(out.map((g) => [g.title, g.panes.map((p) => p.id)]), [['Dollary', [9]]]);
    assert.deepEqual(filterGroups(groups, 'perso').map((g) => g.title), ['Courses', 'TrailCoach', 'Dollary']);
  });

  it('plusieurs mots : tous requis', () => {
    assert.deepEqual(filterGroups(groups, 'link tools').map((g) => g.title), ['Link', 'QR appairage']);
    assert.deepEqual(filterGroups(groups, 'link courses'), []);
  });
});

describe('summaryLine', () => {
  it('compte ce qui attend et ce qui travaille, en français, ou rien', () => {
    assert.equal(summaryLine(PANES), '1 en attente · 2 travaillent');
    assert.equal(summaryLine([pane({ id: 1, tab: 1, working: true })]), '1 travaille');
    assert.equal(summaryLine([pane({ id: 1, tab: 1, working: true, awaiting: true })]), '1 en attente');
    assert.equal(summaryLine([pane({ id: 1, tab: 1 })]), null);
  });
});
