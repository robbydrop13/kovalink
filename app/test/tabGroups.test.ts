// La liste des sessions reproduit la structure de Kova. Données calquées sur `list-tabs`
// et `list-panes` de la machine de Robin le 12 septembre : six onglets colorés, un pane
// chacun sauf « Link » qui en a deux.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pane, Tab } from '@/protocol';
import {
  collapsedSummary,
  filterGroups,
  groupByTab,
  isBareShell,
  isStaleSession,
  paletteEntries,
  summaryLine,
  windowCount,
} from '@/features/sessions/tabGroups';

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
    tabId: null,
    launching: false,
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
  it('compte ce qui attend et ce qui travaille, en anglais, ou rien', () => {
    assert.equal(summaryLine(PANES), '1 waiting · 2 working');
    assert.equal(summaryLine([pane({ id: 1, tab: 1, working: true })]), '1 working');
    assert.equal(summaryLine([pane({ id: 1, tab: 1, working: true, awaiting: true })]), '1 waiting');
    assert.equal(summaryLine([pane({ id: 1, tab: 1 })]), null);
  });
});

describe('paletteEntries (Cmd+P)', () => {
  const groups = groupByTab(PANES, TABS);

  it('tous les panes à plat, dans l’ordre des onglets puis des panes', () => {
    const entries = paletteEntries(groups, '');
    assert.deepEqual(
      entries.map((e) => [e.group.title, e.pane.id]),
      [
        ['Courses', 13],
        ['Link', 4],
        ['Link', 3],
        ['QR appairage', 20],
        ['TrailCoach', 11],
        ['Dollary', 9],
      ],
    );
  });

  it('filtre au fil de la frappe sur onglet, projet et titre, sans accents ni casse', () => {
    assert.deepEqual(paletteEntries(groups, 'TRAIL').map((e) => e.pane.id), [11]);
    assert.deepEqual(paletteEntries(groups, 'link').map((e) => e.pane.id), [4, 3, 20]);
    assert.deepEqual(paletteEntries(groups, 'appairage tools').map((e) => e.pane.id), [20]);
    assert.deepEqual(paletteEntries(groups, 'inexistant'), []);
  });
});

it('la jointure suit l identifiant de l onglet, pas son index, apres un reordonnancement sur le Mac', () => {
  // Avant : Link en index 1. Apres deplacement : Perso (id 27) prend l index 1, Link (id 3) passe en 7.
  const tabs = [
    tab({ id: 26, tab_index: 0, title: 'Claap' }),
    tab({ id: 27, tab_index: 1, title: 'Perso' }),
    tab({ id: 3, tab_index: 7, title: 'Link' }),
  ];
  // Le daemon a estampille les panes avec l identifiant de leur onglet.
  const panes = [
    pane({ id: 66, tab: 7, tabId: 3, cwd: '/x/link' }),
    pane({ id: 70, tab: 1, tabId: 27, cwd: '/x/perso' }),
  ];
  const groups = groupByTab(panes, tabs);
  assert.deepEqual(
    groups.map((g) => [g.title, g.panes.map((p) => p.id)]),
    [['Perso', [70]], ['Link', [66]]],
  );
  // Un pane recu par evenement sans identifiant (tabId null) retombe sur l index.
  const stale = groupByTab([pane({ id: 71, tab: 1, tabId: null })], tabs);
  assert.equal(stale[0]?.title, 'Perso');
  assert.equal(stale[0]?.key, 't27');
});

describe('isStaleSession et demarrage', () => {
  it('un claude que le daemon vient de lancer n est pas perime', () => {
    const p = pane({ id: 80, tab: 0, agent: null, child_processes: [{ name: 'claude', pid: 1, version: null }] });
    assert.equal(isStaleSession(p), true);
    assert.equal(isStaleSession({ ...p, launching: true }), false);
  });
});

describe('isBareShell', () => {
  it('un shell nu : aucun agent, aucun processus, rien en cours de demarrage', () => {
    const bare = pane({ id: 81, tab: 0, agent: null, agent_session_id: null, chatCapable: false });
    assert.equal(isBareShell(bare), true);
    assert.equal(isBareShell({ ...bare, launching: true }), false, 'claude demarre deja');
    assert.equal(isBareShell({ ...bare, agent: 'claude' }), false, 'un agent vivant');
    assert.equal(isBareShell({ ...bare, child_processes: [{ name: 'vim', pid: 3, version: null }] }), false, 'un processus en cours');
    assert.equal(isBareShell({ ...bare, child_processes: [{ name: 'claude', pid: 1, version: null }] }), false, 'une session perimee');
  });
});

describe('collapsedSummary', () => {
  it('compte les panes et signale un pane qui attend ou qui travaille', () => {
    const tabs = [tab({ id: 3, tab_index: 0, title: 'Link' })];
    const quiet = groupByTab([pane({ id: 1, tab: 0, tabId: 3 }), pane({ id: 2, tab: 0, tabId: 3 })], tabs)[0]!;
    assert.deepEqual(collapsedSummary(quiet), { count: 2, awaiting: false, working: false });

    const busy = groupByTab(
      [
        pane({ id: 1, tab: 0, tabId: 3, awaiting: true, working: true }),
        pane({ id: 2, tab: 0, tabId: 3, working: true }),
        pane({ id: 3, tab: 0, tabId: 3 }),
      ],
      tabs,
    )[0]!;
    assert.deepEqual(collapsedSummary(busy), { count: 3, awaiting: true, working: true });

    const waitingOnly = groupByTab([pane({ id: 1, tab: 0, tabId: 3, awaiting: true, working: true })], tabs)[0]!;
    assert.deepEqual(collapsedSummary(waitingOnly), { count: 1, awaiting: true, working: false }, 'awaiting l emporte sur working');
  });
});
