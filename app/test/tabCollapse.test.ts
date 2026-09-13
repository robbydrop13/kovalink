// Onglets repliés sur l'écran Sessions : par identifiant Kova, persistés, restaurés au démarrage.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { setTabCollapsePersistence, useTabCollapse, type Collapsed } from '@/store/tabCollapse';

/** `onDisk` est ce que le disque contient au lancement ; `saved` la derniere ecriture. */
function memory(onDisk: Collapsed | null = null) {
  const box = { saved: null as Collapsed | null, saves: 0 };
  setTabCollapsePersistence({
    load: async () => onDisk,
    save: async (c) => {
      box.saved = { ...c };
      box.saves += 1;
    },
  });
  return box;
}

describe('onglets replies', () => {
  beforeEach(() => {
    useTabCollapse.setState({ collapsed: {}, hydrated: false });
  });

  it('un tap replie, le suivant deplie, seuls les onglets replies sont stockes', () => {
    const box = memory();
    const s = useTabCollapse.getState();
    assert.equal(s.isCollapsed(7), false);
    s.toggle(7);
    assert.equal(useTabCollapse.getState().isCollapsed(7), true);
    assert.deepEqual(useTabCollapse.getState().collapsed, { 7: true });
    s.toggle(7);
    assert.equal(useTabCollapse.getState().isCollapsed(7), false);
    assert.deepEqual(useTabCollapse.getState().collapsed, {});
    assert.equal(box.saves, 2);
  });

  it('persiste a chaque bascule, par identifiant d onglet', async () => {
    const box = memory();
    const s = useTabCollapse.getState();
    s.toggle(3);
    s.toggle(9);
    await Promise.resolve();
    assert.deepEqual(box.saved, { 3: true, 9: true });
    s.toggle(3);
    await Promise.resolve();
    assert.deepEqual(box.saved, { 9: true });
  });

  it('restaure les onglets replies du disque au demarrage, sans ecraser un tap fait avant', async () => {
    memory({ 3: true, 9: true });
    useTabCollapse.getState().toggle(5);
    await useTabCollapse.getState().hydrate();
    const s = useTabCollapse.getState();
    assert.equal(s.isCollapsed(3), true);
    assert.equal(s.isCollapsed(9), true);
    assert.equal(s.isCollapsed(5), true);
    assert.equal(s.hydrated, true);
  });

  it('un disque illisible ne casse rien : tout deplie, store pret', async () => {
    setTabCollapsePersistence({
      load: async () => {
        throw new Error('sqlite absent');
      },
      save: async () => undefined,
    });
    await useTabCollapse.getState().hydrate();
    assert.deepEqual(useTabCollapse.getState().collapsed, {});
    assert.equal(useTabCollapse.getState().hydrated, true);
  });
});
