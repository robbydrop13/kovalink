// « Lu » remonte au Mac : un envoi au plus, et JAMAIS une exception qui remonterait dans
// l'ecran de session. Un echec est un non evenement : la marque locale a deja ete posee.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markPaneReadOnMac } from '@/features/sessions/markReadOnMac';

const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('markPaneReadOnMac', () => {
  it('emet exactement un appel, sur le bon paneId', async () => {
    const sent: number[] = [];
    markPaneReadOnMac(66, async (id) => {
      sent.push(id);
      return { applied: true };
    });
    await settle();
    assert.deepEqual(sent, [66]);
  });

  it('une promesse rejetee ne ressort pas, et ne laisse pas de rejet non gere', async () => {
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown): void => {
      unhandled = e;
    };
    process.on('unhandledRejection', onUnhandled);
    assert.doesNotThrow(() => markPaneReadOnMac(3, async () => Promise.reject(new Error('Mac unreachable'))));
    await settle();
    await settle();
    process.off('unhandledRejection', onUnhandled);
    assert.equal(unhandled, null);
  });

  it('un emetteur qui leve avant sa promesse est le meme non evenement', () => {
    assert.doesNotThrow(() =>
      markPaneReadOnMac(3, () => {
        throw new Error('not paired');
      }),
    );
  });
});
