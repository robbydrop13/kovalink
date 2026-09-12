// La liste des sessions reproduit la structure de Kova. Données calquées sur `list-tabs`
// et `list-panes` de la machine de Robin le 12 septembre : six onglets colorés, un pane
// chacun sauf « Link » qui en a deux.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pane, Tab } from '@/protocol';
import { filterGroups, groupByTab, summaryLine, windowCount } from '@/features/sessions/tabGroups';

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

const TABS: Tab[] = [
  tab({ id: 11, tab_index: 0, title: 'Courses', color: 2 }),
  tab({ id: 3, tab_index: 2, title: 'Link', color: 3, pane_count: 2 }),
  tab({ id: 18, tab_index: 3, title: 'QR appairage', color: 3 }),
  tab({ id: 10, tab_index: 4, title: 'TrailCoach', color: 4, active: true }),
  tab({ id: 8, tab_index: 5, title: 'Dollary', color: 5 }),
];

// Volontairement dans le désordre : l'ordre affiché vient de `tab_index`, pas de la liste.
const PANES: Pane[] = [
  pane({ id: 9, tab: 8, cwd: '/Users/robin/AI directory/Perso/Investissements', projectName: 'Investissements', agent: null, title: 'zsh' }),
  pane({ id: 13, tab: 11, cwd: '/Users/robin/AI directory/Perso', projectName: 'Perso', working: true }),
  pane({ id: 4, tab: 3, cwd: '/Users/robin/dev/link', projectName: 'link', agent: null, title: '..al-tools/link' }),
  pane({ id: 3, tab: 3, cwd: '/Users/robin/dev/link', projectName: 'link', awaiting: true, awaiting_since: '2026-09-12T13:11:43.000Z' }),
  pane({ id: 20, tab: 18, cwd: '/Users/robin/dev/link', projectName: 'link', agent: null, title: '..al-tools/link' }),
  pane({ id: 11, tab: 10, cwd: '/Users/robin/AI directory/Perso/Sport/trail-coach', projectName: 'trail-coach', working: true }),
];

describe('groupByTab', () => {
  it('un groupe par onglet, dans l’ordre de la barre d’onglets du Mac, ses panes dessous', () => {
    const groups = groupByTab(PANES, TABS);
    assert.deepEqual(
      groups.map((g) => [g.title, g.color, g.panes.map((p) => p.id)]),
      [
        ['Courses', 2, [13]],
        ['Link', 3, [4, 3]],
        ['QR appairage', 3, [20]],
        ['TrailCoach', 4, [11]],
        ['Dollary', 5, [9]],
      ],
    );
  });

  it('marque l’onglet actif sur le Mac', () => {
    const active = groupByTab(PANES, TABS).filter((g) => g.active);
    assert.deepEqual(active.map((g) => g.title), ['TrailCoach']);
  });

  it('un pane dont l’onglet n’est pas encore connu forme son propre groupe, en fin de fenêtre', () => {
    const orphan = pane({ id: 21, tab: 19, cwd: '/private/tmp', projectName: 'tmp', agent: null, title: '/private/tmp', color: null });
    const groups = groupByTab([...PANES, orphan], TABS);
    const last = groups[groups.length - 1];
    assert.equal(last?.tabId, 19);
    assert.equal(last?.title, 'tmp', 'le projet du premier pane sert de nom');
    assert.deepEqual(last?.panes.map((p) => p.id), [21]);
  });

  it('un onglet sans pane n’apparaît pas ; une seconde fenêtre vient après la première', () => {
    const tabs = [...TABS, tab({ id: 30, tab_index: 0, window: 1, title: 'Autre fenêtre' }), tab({ id: 31, tab_index: 1, title: 'Vide' })];
    const panes = [...PANES, pane({ id: 40, tab: 30, window: 1, projectName: 'autre' })];
    const groups = groupByTab(panes, tabs);
    assert.equal(groups.some((g) => g.title === 'Vide'), false);
    assert.equal(groups[groups.length - 1]?.title, 'Autre fenêtre');
    assert.equal(windowCount(groups), 2);
    assert.equal(windowCount(groupByTab(PANES, TABS)), 1);
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
    const out = filterGroups(groups, 'zsh');
    assert.deepEqual(out.map((g) => [g.title, g.panes.map((p) => p.id)]), [['Dollary', [9]]]);
    assert.deepEqual(filterGroups(groups, 'investissements').map((g) => g.title), ['Dollary']);
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
