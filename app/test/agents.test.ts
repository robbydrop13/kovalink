// Les comptes de l'onglet Agents. Noms inventes, aucune donnee de la machine de Robin :
// ce module est pur, les tests le prouvent sur des panes construits a la main.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pane, RosterEntry, Tab } from '@/protocol';
import {
  countsOf,
  findAgentPane,
  paneCategory,
  rosterRows,
  splitPanes,
  tabCounts,
  tabNameFor,
  workingFirst,
} from '@/features/agents/agents';

function pane(partial: Partial<Pane> & { id: number; tab: number }): Pane {
  return {
    window: 0,
    cwd: '/Users/alice/dev/x',
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
    resume_agent: null,
    resume_session_id: null,
    resume_command: null,
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

function entry(partial: Partial<RosterEntry> & { name: string; state: RosterEntry['state'] }): RosterEntry {
  return { role: '', ...partial };
}

describe('paneCategory', () => {
  it('une erreur l’emporte sur le travail', () => {
    const p = pane({ id: 1, tab: 0, working: true, error: { kind: 'Limit reached', text: 'quota' } });
    assert.equal(paneCategory(p), 'error');
  });

  it('une question due l’emporte sur le travail', () => {
    const p = pane({ id: 2, tab: 0, working: true, awaiting: true });
    assert.equal(paneCategory(p), 'needYou');
  });

  it('un shell nu est au repos, meme si Kova le dit en travail', () => {
    const shell = pane({ id: 3, tab: 0, agent: null, working: true, child_processes: [] });
    assert.equal(paneCategory(shell), 'idle');
  });

  it('travail puis repos', () => {
    assert.equal(paneCategory(pane({ id: 4, tab: 0, working: true })), 'working');
    assert.equal(paneCategory(pane({ id: 5, tab: 0 })), 'idle');
  });
});

describe('splitPanes et countsOf', () => {
  const panes = [
    pane({ id: 1, tab: 0, working: true }),
    pane({ id: 2, tab: 0, awaiting: true }),
    pane({ id: 3, tab: 1, error: { kind: 'API error', text: 'offline' } }),
    pane({ id: 4, tab: 1 }),
    pane({ id: 5, tab: 2, agent: null }),
  ];

  it('range chaque pane dans une seule colonne', () => {
    const split = splitPanes(panes);
    assert.deepEqual(split.working.map((p) => p.id), [1]);
    assert.deepEqual(split.needYou.map((p) => p.id), [2]);
    assert.deepEqual(split.error.map((p) => p.id), [3]);
    assert.deepEqual(split.idle.map((p) => p.id), [4, 5]);
  });

  it('les quatre comptes couvrent tous les panes', () => {
    const counts = countsOf(panes);
    assert.deepEqual(counts, { needYou: 1, working: 1, error: 1, idle: 2 });
    assert.equal(counts.needYou + counts.working + counts.error + counts.idle, panes.length);
  });

  it('liste vide : tout a zero', () => {
    assert.deepEqual(countsOf([]), { needYou: 0, working: 0, error: 0, idle: 0 });
  });
});

describe('workingFirst', () => {
  const panes = [pane({ id: 1, tab: 0 }), pane({ id: 2, tab: 0 }), pane({ id: 3, tab: 0 })];

  it('le debut le plus ancien d’abord, les inconnus en dernier', () => {
    assert.deepEqual(
      workingFirst(panes, { 1: 300, 2: 100 }).map((p) => p.id),
      [2, 1, 3],
    );
  });

  it('a egalite, l’identifiant tranche pour que deux instantanes donnent le meme ordre', () => {
    assert.deepEqual(
      workingFirst([panes[0]!, pane({ id: 9, tab: 0 })], { 1: 50, 9: 50 }).map((p) => p.id),
      [1, 9],
    );
  });
});

describe('tabCounts', () => {
  const tabs = [
    tab({ id: 10, tab_index: 0, title: 'Build', color: 2 }),
    tab({ id: 11, tab_index: 1, title: 'Notes', color: null }),
    tab({ id: 12, tab_index: 2, title: null }),
  ];
  const panes = [
    pane({ id: 1, tab: 0, tabId: 10, working: true }),
    pane({ id: 2, tab: 0, tabId: 10, awaiting: true }),
    pane({ id: 3, tab: 1, tabId: 11, error: { kind: 'Logged out', text: 'session expiree' } }),
    pane({ id: 4, tab: 1, tabId: null }),
    pane({ id: 5, tab: 5, tabId: 99, title: 'oracle' }),
  ];

  it('une ligne par onglet, dans l’ordre de la barre, un onglet vide a zero', () => {
    const rows = tabCounts(panes, tabs);
    assert.deepEqual(
      rows.map((row) => [row.key, row.title, row.counts]),
      [
        ['t10', 'Build', { needYou: 1, working: 1, error: 0, idle: 0 }],
        ['t11', 'Notes', { needYou: 0, working: 0, error: 1, idle: 1 }],
        ['t12', 'Tab 3', { needYou: 0, working: 0, error: 0, idle: 0 }],
        ['w0-i5', 'oracle', { needYou: 0, working: 0, error: 0, idle: 1 }],
      ],
    );
    assert.equal(rows[0]?.color, 2);
    assert.equal(rows[1]?.color, null);
  });

  it('un pane recu avant list-tabs garde sa propre ligne', () => {
    const rows = tabCounts([pane({ id: 6, tab: 0, tabId: null, title: 'forge' })], []);
    assert.deepEqual(rows.map((row) => [row.key, row.title]), [['w0-i0', 'forge']]);
  });
});

describe('tabNameFor', () => {
  const tabs = [tab({ id: 10, tab_index: 0, title: 'Build' }), tab({ id: 11, tab_index: 1 })];

  it('par identifiant, puis par index, puis le nom de repli', () => {
    assert.equal(tabNameFor(pane({ id: 1, tab: 0, tabId: 10 }), tabs), 'Build');
    assert.equal(tabNameFor(pane({ id: 2, tab: 1, tabId: null }), tabs), 'Tab 2');
    assert.equal(tabNameFor(pane({ id: 3, tab: 4, tabId: null }), tabs), 'Tab 5');
  });
});

describe('findAgentPane et rosterRows', () => {
  const panes = [
    pane({ id: 1, tab: 0, agent_session_name: 'chief-one' }),
    pane({ id: 2, tab: 0, title: ' Manager-Two ' }),
  ];
  const entries = [
    entry({ name: 'chief-one', role: 'chief', state: 'open' }),
    entry({ name: 'manager-two', role: 'manager', state: 'working' }),
    entry({ name: 'closed-mgr', role: 'manager', state: 'closed' }),
  ];

  it('le nom de session d’abord, le titre du pane en repli, sans casse ni espaces', () => {
    assert.equal(findAgentPane(panes, 'chief-one')?.id, 1);
    assert.equal(findAgentPane(panes, 'manager-two')?.id, 2);
    assert.equal(findAgentPane(panes, 'absent'), null);
  });

  it('une session fermee n’est pas ouverte et ne porte pas de pane', () => {
    const rows = rosterRows(entries, panes);
    assert.deepEqual(
      rows.map((row) => [row.entry.name, row.open, row.pane?.id ?? null]),
      [
        ['chief-one', true, 1],
        ['manager-two', true, 2],
        ['closed-mgr', false, null],
      ],
    );
  });
});
