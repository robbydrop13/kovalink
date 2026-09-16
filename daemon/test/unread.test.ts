// Le bit de non lu de Kova (`unread` de `list-panes`) traverse le daemon tel quel : c'est
// lui qui fait dire la meme chose au bouton Next du telephone et a la pastille du Mac.
// Le cas qui compte est l'ABSENCE du champ : elle doit rester une absence, pas un `false`.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_KOVA_CONFIG'] = mkdtempSync(join(tmpdir(), 'kovalink-kova-unread-'));
process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-unread-'));
process.env['KOVALINK_QUIET'] = '1';

const { toPane } = await import('../src/kova/panes.js');

const RAW: Record<string, unknown> = {
  id: 7,
  window: 0,
  tab: 0,
  cwd: '/tmp/projet',
  agent: null,
  child_processes: [],
};

describe('toPane et le bit de non lu de Kova', () => {
  it('recopie `unread` tel quel, dans les deux sens', () => {
    assert.equal(toPane({ ...RAW, unread: true }).unread, true);
    assert.equal(toPane({ ...RAW, unread: false }).unread, false);
  });

  it('laisse le champ ABSENT quand Kova ne l envoie pas, pour que l app garde son repli', () => {
    const pane = toPane(RAW);
    assert.equal(pane.unread, undefined);
    // `false` dirait « Kova affirme que ce pane est lu » et supprimerait le repli local.
    assert.equal('unread' in pane, false);
  });

  it('ignore une valeur qui n est pas un booleen', () => {
    assert.equal('unread' in toPane({ ...RAW, unread: 'oui' }), false);
    assert.equal('unread' in toPane({ ...RAW, unread: 1 }), false);
    assert.equal('unread' in toPane({ ...RAW, unread: null }), false);
  });

  it('n interfere pas avec les autres champs du pane', () => {
    const pane = toPane({ ...RAW, unread: true, minimized: true, working: true });
    assert.equal(pane.unread, true);
    assert.equal(pane.minimized, true);
    assert.equal(pane.working, true);
    assert.equal(pane.liveState, 'working');
  });
});
