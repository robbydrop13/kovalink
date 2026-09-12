// Brouillon par pane : gardé en quittant la session, persisté, effacé à l'envoi.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { draftOf, setDraftPersistence, useDrafts } from '@/store/drafts';

function memory(initial: Record<number, string> | null = null) {
  const box = { saved: initial, saves: 0 };
  setDraftPersistence({
    load: async () => box.saved,
    save: async (d) => {
      box.saved = { ...d };
      box.saves += 1;
    },
  });
  return box;
}

describe('brouillons du composer', () => {
  beforeEach(() => {
    useDrafts.setState({ byPane: {}, hydrated: false });
  });

  it('garde un brouillon par pane, et un brouillon vide n’est jamais stocké', () => {
    memory();
    const s = useDrafts.getState();
    s.set(66, 'Recrée un ');
    s.set(13, 'autre pane');
    assert.equal(draftOf(useDrafts.getState().byPane, 66), 'Recrée un ');
    assert.equal(draftOf(useDrafts.getState().byPane, 13), 'autre pane');
    assert.equal(draftOf(useDrafts.getState().byPane, 99), '');
    s.set(66, '');
    assert.equal(66 in useDrafts.getState().byPane, false);
  });

  it('persiste avec un délai, et `clear` efface après un envoi réussi', async () => {
    const box = memory();
    const s = useDrafts.getState();
    s.set(66, 'brouillon');
    await s.flush();
    assert.deepEqual(box.saved, { 66: 'brouillon' });
    s.clear(66);
    await s.flush();
    assert.deepEqual(box.saved, {});
  });

  it('restaure les brouillons du disque au démarrage, sans écraser ce qui vient d’être tapé', async () => {
    memory({ 66: 'du disque', 13: 'aussi' });
    useDrafts.getState().set(66, 'tapé avant la fin du chargement');
    await useDrafts.getState().hydrate();
    assert.equal(draftOf(useDrafts.getState().byPane, 66), 'tapé avant la fin du chargement');
    assert.equal(draftOf(useDrafts.getState().byPane, 13), 'aussi');
    assert.equal(useDrafts.getState().hydrated, true);
  });

  it('un disque illisible ne casse rien : brouillons vides, store prêt', async () => {
    setDraftPersistence({
      load: async () => {
        throw new Error('sqlite absent');
      },
      save: async () => undefined,
    });
    await useDrafts.getState().hydrate();
    assert.deepEqual(useDrafts.getState().byPane, {});
    assert.equal(useDrafts.getState().hydrated, true);
  });
});
