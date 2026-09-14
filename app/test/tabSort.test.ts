// Tri des onglets sur l'écran Sessions : une bascule, persistée, restaurée au démarrage.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { setTabSortPersistence, useTabSort } from '@/store/tabSort';
import type { TabSortMode } from '@/features/sessions/tabGroups';

function memory(onDisk: TabSortMode | null = null) {
  const box = { saved: null as TabSortMode | null, saves: 0 };
  setTabSortPersistence({
    load: async () => onDisk,
    save: async (mode) => {
      box.saved = mode;
      box.saves += 1;
    },
  });
  return box;
}

describe('tri des onglets', () => {
  beforeEach(() => {
    useTabSort.setState({ mode: 'kova', hydrated: false });
  });

  it('ordre de Kova par defaut, une bascule passe par activite et revient, chaque fois enregistree', () => {
    const box = memory();
    assert.equal(useTabSort.getState().mode, 'kova');
    useTabSort.getState().toggle();
    assert.equal(useTabSort.getState().mode, 'activity');
    assert.equal(box.saved, 'activity');
    useTabSort.getState().toggle();
    assert.equal(useTabSort.getState().mode, 'kova');
    assert.equal(box.saves, 2);
  });

  it('restaure le mode du disque, ignore une valeur inconnue', async () => {
    memory('activity');
    await useTabSort.getState().hydrate();
    assert.equal(useTabSort.getState().mode, 'activity');
    useTabSort.setState({ mode: 'kova', hydrated: false });
    setTabSortPersistence({ load: async () => 'sideways' as TabSortMode, save: async () => undefined });
    await useTabSort.getState().hydrate();
    assert.equal(useTabSort.getState().mode, 'kova');
  });

  it('une bascule pendant le chargement l emporte sur le disque', async () => {
    let release: (() => void) | null = null;
    setTabSortPersistence({
      load: () => new Promise((resolve) => (release = () => resolve('activity'))),
      save: async () => undefined,
    });
    const loading = useTabSort.getState().hydrate();
    useTabSort.getState().toggle();
    useTabSort.getState().toggle();
    (release as (() => void) | null)?.();
    await loading;
    assert.equal(useTabSort.getState().mode, 'kova');
  });
});
