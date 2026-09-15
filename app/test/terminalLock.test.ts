// Verrou Face ID de la saisie terminal : une fois par pane, tant que la vue Term reste ouverte au premier plan.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOCKED, isTerminalUnlocked, nextLock, unlockPane } from '@/features/terminal/terminalLock';

const open = { paneId: 3, termOpen: true, focused: true, appActive: true };

describe('terminalLock', () => {
  it('verrouille par defaut, deverrouille seulement le pane authentifie', () => {
    assert.equal(isTerminalUnlocked(LOCKED, 3), false);
    const lock = unlockPane(3);
    assert.equal(isTerminalUnlocked(lock, 3), true);
    assert.equal(isTerminalUnlocked(lock, 4), false);
  });

  it('reste deverrouille tant que le contexte ne change pas', () => {
    const lock = unlockPane(3);
    assert.equal(nextLock(lock, open), lock);
  });

  it('reverrouille en quittant la vue Term, l ecran, le pane ou le premier plan', () => {
    const lock = unlockPane(3);
    assert.equal(isTerminalUnlocked(nextLock(lock, { ...open, termOpen: false }), 3), false);
    assert.equal(isTerminalUnlocked(nextLock(lock, { ...open, focused: false }), 3), false);
    assert.equal(isTerminalUnlocked(nextLock(lock, { ...open, appActive: false }), 3), false);
    assert.equal(isTerminalUnlocked(nextLock(lock, { ...open, paneId: 4 }), 4), false);
  });

  it('un verrou ferme le reste quel que soit le contexte', () => {
    assert.equal(nextLock(LOCKED, open), LOCKED);
  });
});
