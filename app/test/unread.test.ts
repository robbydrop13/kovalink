// L'anneau de Cmd+J (docs/16) : ordre de Kova à travers les onglets, bouclage à partir du
// pane courant, `awaiting` non vus en tête, `working` exclus, repli sur une session
// inactive, purge des marques des panes fermés.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pane, Prompt, Tab } from '@/protocol';
import { groupByTab, paletteEntries } from '@/features/sessions/tabGroups';
import { KOVA_UNREAD_MARK, idleRing, isUnread, nextTarget, staleMarks, unreadRing } from '@/features/sessions/unread';

function pane(partial: Partial<Pane> & { id: number; tab: number }): Pane {
  return {
    window: 0, cwd: '/x', title: 'claude', focused: false, pid: 1, child_processes: [], is_idle: false, working: false,
    awaiting: false, awaiting_since: null, awaiting_seen: false, minimized: false, agent: 'claude', agent_session_id: null,
    agent_session_name: null, claude_session_id: null, claude_session_name: null, resume_agent: null, resume_session_id: null, resume_command: null, projectName: 'x', hasTranscript: true,
    chatCapable: true, permissionMode: null, color: null, tabId: null, launching: false, liveState: 'idle', ...partial,
  };
}
function tab(id: number, index: number, window = 0): Tab {
  return { id, window, tab_index: index, title: null, pane_count: 1, focused_pane_id: 0, active: false, has_bell: false, has_completion: false, has_running: false, color: null };
}
const done = (paneId: number, ref: string): Prompt => ({
  state: 'turn_end', paneId, sessionId: null, endedAt: '2026-09-12T18:00:00.000Z', summary: 'ok', subtitle: '', toolCount: 0, durationMs: null, promptRef: ref,
});
const question = (paneId: number, ref: string): Prompt => ({
  state: 'unparsable', paneId, awaitingSince: '2026-09-12T18:00:00.000Z', rawScreen: '', cols: 80, rows: 24, promptRef: ref,
});

// Ordre de Kova : fenêtre 0 onglets 0..2, fenêtre 1 onglet 0.
const TABS = [tab(11, 0), tab(3, 1), tab(18, 2), tab(30, 0, 1)];
const PANES = [
  pane({ id: 13, tab: 0 }), // done, non lu
  pane({ id: 3, tab: 1 }), // done, lu
  pane({ id: 4, tab: 1, agent: null, title: 'shell' }), // shell, rien à lire
  pane({ id: 20, tab: 2, working: true }), // travaille : exclu
  pane({ id: 11, tab: 2, awaiting: true, awaiting_since: '2026-09-12T18:01:00.000Z' }), // question non vue
  pane({ id: 40, tab: 0, window: 1 }), // done, non lu, autre fenêtre
  pane({ id: 41, tab: 0, window: 1 }), // inactif, rien à lire
];
const PROMPTS: Record<number, Prompt> = { 13: done(13, 'r13'), 3: done(3, 'r3'), 20: done(20, 'r20'), 11: question(11, 'r11'), 40: done(40, 'r40') };
const MARKS = { 3: 'r3' };
const entries = paletteEntries(groupByTab(PANES, TABS), '');

describe('isUnread : le bit de Kova fait foi', () => {
  it('tranche dans les deux sens, y compris là où l’app n’a aucun `Prompt`', () => {
    // Une cloche ou une commande shell finie : Kova dit non lu, l'app n'a rien à montrer.
    // C'est le cas que l'ancienne règle locale rendait invisible sur le téléphone.
    const bell = pane({ id: 70, tab: 0, agent: null, title: 'shell', unread: true });
    assert.equal(isUnread(bell, undefined, {}), true);
    // Kova dit lu : même un `Prompt` lisible non marqué ne rend pas le pane non lu.
    assert.equal(isUnread(pane({ id: 71, tab: 0, unread: false }), done(71, 'r71'), {}), false);
    // Un pane qui travaille et que Kova marque non lu (Cmd+U) le reste, comme sur le Mac.
    assert.equal(isUnread(pane({ id: 72, tab: 0, working: true, unread: true }), undefined, {}), true);
  });

  it('la marque locale efface la pastille tout de suite, avec ou sans `promptRef`', () => {
    const bell = pane({ id: 70, tab: 0, agent: null, unread: true });
    assert.equal(isUnread(bell, undefined, { 70: KOVA_UNREAD_MARK }), false);
    const turn = pane({ id: 73, tab: 0, unread: true });
    assert.equal(isUnread(turn, done(73, 'r73'), { 73: 'r73' }), false);
    assert.equal(isUnread(turn, done(73, 'r73-bis'), { 73: 'r73' }), true, 'nouvelle référence');
  });
});

describe('isUnread : repli sans le champ (Kova plus ancien)', () => {
  it('lisible et non marqué ; jamais un pane qui travaille ; une marque périmée redevient non lue', () => {
    assert.equal(isUnread(PANES[0] as Pane, PROMPTS[13], MARKS), true);
    assert.equal(isUnread(PANES[1] as Pane, PROMPTS[3], MARKS), false);
    assert.equal(isUnread(PANES[3] as Pane, PROMPTS[20], MARKS), false, 'working');
    assert.equal(isUnread(PANES[1] as Pane, done(3, 'r3-bis'), MARKS), true, 'nouvelle référence');
    assert.equal(isUnread(PANES[2] as Pane, undefined, MARKS), false);
  });
});

describe('unreadRing', () => {
  it('awaiting non vu en tête, puis l’ordre de Kova à travers les fenêtres, pane courant exclu', () => {
    assert.deepEqual(unreadRing(entries, PROMPTS, MARKS, null).map((e) => e.pane.id), [11, 13, 40]);
    assert.deepEqual(unreadRing(entries, PROMPTS, MARKS, 13).map((e) => e.pane.id), [11, 40]);
  });
  it('boucle à partir du pane courant', () => {
    const seen = { ...MARKS, 11: 'r11' };
    assert.deepEqual(unreadRing(entries, PROMPTS, seen, 40).map((e) => e.pane.id), [13]);
    assert.deepEqual(unreadRing(entries, PROMPTS, seen, 3).map((e) => e.pane.id), [40, 13]);
  });
  it('une question déjà vue sur le Mac reste non lue, mais sans priorité', () => {
    const panes = PANES.map((p) => (p.id === 11 ? { ...p, awaiting_seen: true } : p));
    const e = paletteEntries(groupByTab(panes, TABS), '');
    assert.deepEqual(unreadRing(e, PROMPTS, MARKS, null).map((x) => x.pane.id), [13, 11, 40]);
  });
});

describe('nextTarget et repli', () => {
  it('le premier non lu avec le compte des autres, sinon la prochaine session Claude inactive, sinon rien', () => {
    const t1 = nextTarget(entries, PROMPTS, MARKS, 13);
    assert.equal(t1?.kind, 'unread');
    assert.equal(t1?.entry.pane.id, 11);
    assert.equal(t1?.others, 2);
    const allRead = { 13: 'r13', 3: 'r3', 11: 'r11', 40: 'r40' };
    const t2 = nextTarget(entries, PROMPTS, allRead, 13);
    assert.equal(t2?.kind, 'idle');
    assert.deepEqual(idleRing(entries, PROMPTS, allRead, 13).map((e) => e.pane.id), [3, 40, 41], 'inactives dans l’ordre depuis le courant, sans le shell ni le working');
    assert.deepEqual(idleRing(entries, PROMPTS, allRead, 40).map((e) => e.pane.id), [41, 13, 3], 'boucle');
    const none = nextTarget([entries[0] as (typeof entries)[number]], PROMPTS, allRead, 13);
    assert.equal(none, null);
  });
});

describe('staleMarks', () => {
  it('rend les marques des panes fermés, à purger', () => {
    assert.deepEqual(staleMarks({ 3: 'r3', 99: 'gone' }, PANES), [99]);
  });

  it('purge aussi la marque d’un pane que Kova annonce lu, pour qu’un nouveau signal ressorte', () => {
    const panes = [pane({ id: 3, tab: 0, unread: false }), pane({ id: 5, tab: 0, unread: true })];
    assert.deepEqual(staleMarks({ 3: 'r3', 5: 'r5' }, panes), [3]);
  });
});

describe('unreadRing : les panes minimisés restent dehors', () => {
  it('comme `collect_unread` sur le Mac, qui ne s’y arrête pas non plus', () => {
    const panes = PANES.map((p) => (p.id === 13 ? { ...p, minimized: true } : p));
    const e = paletteEntries(groupByTab(panes, TABS), '');
    assert.deepEqual(unreadRing(e, PROMPTS, MARKS, null).map((x) => x.pane.id), [11, 40]);
    assert.equal(nextTarget(e, PROMPTS, MARKS, null)?.entry.pane.id, 11);
  });
});
