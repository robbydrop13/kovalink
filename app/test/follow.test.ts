// « Suivre sur le Mac » : ouvrir une session émet exactement un `focus-pane`, ou aucun.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { followNotice, followPane } from '@/features/sessions/follow';

describe('followPane', () => {
  it('réglage actif : exactement un focus-pane, sur le bon paneId', () => {
    const sent: number[] = [];
    const res = followPane(66, true, (id) => {
      sent.push(id);
      return true;
    });
    assert.equal(res, 'sent');
    assert.deepEqual(sent, [66]);
    assert.equal(followNotice(res), null, 'rien à dire quand ça marche');
  });

  it('réglage coupé : aucun envoi, aucun toast', () => {
    const sent: number[] = [];
    const res = followPane(66, false, (id) => {
      sent.push(id);
      return true;
    });
    assert.equal(res, 'off');
    assert.deepEqual(sent, []);
    assert.equal(followNotice(res), null);
  });

  it('liaison coupée : la session s’ouvre quand même et le toast le dit', () => {
    const res = followPane(3, true, () => false);
    assert.equal(res, 'unreachable');
    assert.match(followNotice(res) ?? '', /Mac unreachable/);
  });
});
