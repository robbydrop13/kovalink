// L'onglet de l'accueil : le Cockpit d'abord, et au lancement (choix de Robin du 19/11/2026).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_HOME_TAB, HOME_TABS, useHomeTab } from '@/store/homeTab';

describe('onglets de l accueil', () => {
  it('le Cockpit est le premier onglet et celui du lancement', () => {
    assert.deepEqual(HOME_TABS, ['cockpit', 'panes', 'asks', 'agents', 'scheduled']);
    assert.equal(DEFAULT_HOME_TAB, 'cockpit');
    assert.equal(useHomeTab.getState().tab, 'cockpit');
  });

  it('la ligne Cockpit de Needs you et le retour depuis un autre onglet passent sur le Cockpit', () => {
    useHomeTab.getState().setTab('panes');
    assert.equal(useHomeTab.getState().tab, 'panes');
    useHomeTab.getState().setTab('cockpit');
    assert.equal(useHomeTab.getState().tab, 'cockpit');
  });
});
