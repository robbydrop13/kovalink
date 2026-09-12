// La confirmation de fermeture dit l'état réel du pane, et un agent au travail est un danger.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closeStateLabel } from '@/features/sessions/closeState';

describe('closeStateLabel', () => {
  it('un agent au travail exige la double confirmation', () => {
    assert.deepEqual(closeStateLabel({ working: true, awaiting: false, agent: 'claude' }), {
      label: 'The agent is working right now: closing interrupts the task.',
      danger: true,
    });
  });
  it('attente, repos et shell sont sans danger, avec leur libellé', () => {
    assert.equal(closeStateLabel({ working: false, awaiting: true, agent: 'claude' }).danger, false);
    assert.equal(closeStateLabel({ working: false, awaiting: false, agent: 'claude' }).label, 'The agent is idle.');
    assert.equal(closeStateLabel({ working: false, awaiting: false, agent: null }).label, 'Plain shell, no agent.');
  });
});
