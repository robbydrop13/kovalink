import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-layout-'));
process.env['KOVALINK_QUIET'] = '1';

const { LayoutGate } = await import('../src/kova/layoutPoll.js');
const { PaneStore } = await import('../src/kova/panes.js');

const pane = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 66,
  window: 0,
  tab: 1,
  cwd: '/Users/robin/dev/projet',
  title: 'cc',
  pid: 1,
  agent: 'claude',
  agent_session_id: 'sess-1',
  working: false,
  awaiting: false,
  unread: false,
  child_processes: [],
  ...over,
});
const tabs = [{ id: 32, window: 0, tab_index: 1, title: 'projet' }];

describe('porte de diffusion de la mise en page (D2, D9)', () => {
  it('ne diffuse qu une fois pour une mise en page identique', () => {
    const gate = new LayoutGate();
    assert.equal(gate.changed(tabs, [pane()]), true, 'la premiere lecture est toujours un changement');
    assert.equal(gate.changed(tabs, [pane()]), false);
  });

  it('working, awaiting et resume_command declenchent une diffusion', () => {
    for (const change of [{ working: true }, { awaiting: true }, { resume_command: 'claude --resume x' }]) {
      const gate = new LayoutGate();
      gate.changed(tabs, [pane()]);
      assert.equal(gate.changed(tabs, [pane(change)]), true, JSON.stringify(change));
    }
  });

  it('reset() rouvre la porte : une liste videe puis relue est rediffusee', () => {
    const gate = new LayoutGate();
    gate.changed(tabs, [pane()]);
    // Kova disparait : la liste est videe et l'app en est informee.
    assert.equal(gate.changed([], []), true);
    gate.reset();
    // Kova revient avec EXACTEMENT la meme mise en page qu'avant la coupure. Sans le
    // reset, la signature etait identique a celle d'avant, la porte restait fermee, et
    // la liste des panes de l'app restait vide indefiniment.
    assert.equal(gate.changed(tabs, [pane()]), true, 'sans reset, le telephone reste sur une liste vide');
  });
});

describe('etag du magasin de panes (D9)', () => {
  it('ne bouge pas quand une relecture complete ne change rien', () => {
    const store = new PaneStore();
    store.setTabs(tabs);
    store.replaceAll([pane()]);
    const etag = store.etag;
    // La relecture a lieu toutes les 5 s pour que `working` converge : si elle bougeait
    // l'etag a chaque fois, l'etag de reprise de l'app ne correspondrait plus jamais.
    store.setTabs(tabs);
    store.replaceAll([pane()]);
    assert.equal(store.etag, etag);
  });

  it('bouge des qu un champ du pane change, working compris', () => {
    const store = new PaneStore();
    store.replaceAll([pane()]);
    const etag = store.etag;
    store.replaceAll([pane({ working: true })]);
    assert.notEqual(store.etag, etag);
    assert.equal(store.get(66)?.working, true);
  });

  it('une relecture fait converger working et awaiting apres un evenement perdu', () => {
    const store = new PaneStore();
    store.replaceAll([pane({ working: true })]);
    // L'evenement `pane-working: false` de Kova n'est jamais arrive (reconnexion IPC).
    assert.equal(store.get(66)?.working, true);
    store.replaceAll([pane({ working: false })]);
    assert.equal(store.get(66)?.working, false, 'la relecture est la seule voie de convergence');
    assert.equal(store.get(66)?.liveState, 'idle');
  });
});
