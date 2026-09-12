import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const KOVA_CONFIG = mkdtempSync(join(tmpdir(), 'kovalink-kova-'));
process.env['KOVALINK_KOVA_CONFIG'] = KOVA_CONFIG;
process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-colors-'));
process.env['KOVALINK_QUIET'] = '1';

const { parseTabColors, resetTabColors, colorOf } = await import('../src/kova/tabColors.js');
const { toPane, toTab } = await import('../src/kova/panes.js');

/** Structure reelle de `~/.config/kova/session.json`, titres remplaces par des exemples. */
const REAL_SESSION = JSON.stringify({
  version: 1,
  windows: [
    {
      active_tab: 1,
      tabs: [
        { custom_title: 'Projet A', color: 1 },
        { custom_title: 'Link', color: 2 },
        { custom_title: 'Projet B', color: 2 },
        { custom_title: 'Projet C', color: 1 },
      ],
    },
  ],
});

function writeSession(json: string): void {
  writeFileSync(join(KOVA_CONFIG, 'session.json'), json);
  resetTabColors();
}

describe('couleurs d onglet Kova', () => {
  it('lit les couleurs de la structure reelle, par position', () => {
    const colors = parseTabColors(REAL_SESSION);
    assert.equal(colors.get('0/0'), 1);
    assert.equal(colors.get('0/1'), 2);
    assert.equal(colors.get('0/3'), 1);
    assert.equal(colors.size, 4);
  });

  it('ignore une couleur absente, nulle ou hors de la plage 0 a 5', () => {
    const colors = parseTabColors(
      JSON.stringify({
        windows: [{ tabs: [{ color: null }, {}, { color: 9 }, { color: -1 }, { color: 'rouge' }] }],
      }),
    );
    assert.equal(colors.size, 0);
  });

  it('ne tombe pas sur un fichier illisible ou d une autre forme', () => {
    assert.equal(parseTabColors('pas du json').size, 0);
    assert.equal(parseTabColors('{"windows":"pas un tableau"}').size, 0);
  });

  it('joint un pane a son onglet par (window, tab_index)', () => {
    writeSession(REAL_SESSION);
    // Mesure : le pane 66 porte `tab: 1`, qui est l'INDEX de l'onglet, et l'onglet
    // d'identifiant 32 porte `tab_index: 1`. Les deux doivent tomber sur la couleur 2.
    const pane = toPane({
      id: 66,
      window: 0,
      tab: 1,
      cwd: '/tmp/link',
      agent: 'claude',
      child_processes: [],
    });
    const tab = toTab({ id: 32, window: 0, tab_index: 1, pane_count: 2, focused_pane_id: 66 });
    assert.equal(pane.color, 2);
    assert.equal(tab.color, 2);
  });

  it('rend null quand l onglet n a aucune couleur, sans inventer de valeur', () => {
    writeSession(JSON.stringify({ windows: [{ tabs: [{ custom_title: 'sans couleur' }] }] }));
    assert.equal(colorOf(0, 0), null);
    const pane = toPane({ id: 1, window: 0, tab: 0, cwd: '/tmp', agent: null, child_processes: [] });
    assert.equal(pane.color, null);
  });

  it('rend null quand le fichier de session n existe pas', () => {
    writeSession(JSON.stringify({ windows: [] }));
    assert.equal(colorOf(3, 7), null);
  });
});
