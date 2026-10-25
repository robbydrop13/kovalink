// Les questions des agents (`kova ask`) côté app : ce que le bandeau compte, ce que la
// réponse laisse partir, et ce qu'un instantané efface.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AskItem } from '@/protocol';
import { ASK_TEXT_MAX } from '@/protocol';
import { dueAsks, nextAsk, snoozedAsks, useAsks } from '@/store/asks';
import { askText, isAskButton } from '@/features/asks/answer';

function ask(partial: Partial<AskItem> & { id: string }): AskItem {
  return {
    from: 'agent',
    message: 'Send it?',
    buttons: ['OK', 'KO'],
    input: true,
    askedAtMs: 1_000,
    snoozedUntilMs: 0,
    due: true,
    waiting: true,
    sessionId: null,
    cwd: null,
    ...partial,
  };
}

describe('questions des agents : ce que l ecran montre', () => {
  it('les dues d abord, la plus ancienne en tete', () => {
    const list = [
      ask({ id: 'c', askedAtMs: 3_000 }),
      ask({ id: 'a', askedAtMs: 1_000 }),
      ask({ id: 'b', askedAtMs: 2_000 }),
    ];
    assert.deepEqual(dueAsks(list).map((a) => a.id), ['a', 'b', 'c']);
    assert.equal(nextAsk(list)?.id, 'a');
  });

  it('une question remise a plus tard ne compte dans aucun bandeau', () => {
    const list = [ask({ id: 'a', due: false, snoozedUntilMs: 9_000 }), ask({ id: 'b' })];
    assert.deepEqual(dueAsks(list).map((a) => a.id), ['b']);
    assert.equal(nextAsk(list)?.id, 'b');
    // Elle reste visible ailleurs : un report n'est pas un abandon.
    assert.deepEqual(snoozedAsks(list).map((a) => a.id), ['a']);
  });

  it('aucune question due : pas de bandeau du tout', () => {
    assert.equal(nextAsk([]), null);
    assert.equal(nextAsk([ask({ id: 'a', due: false })]), null);
  });

  it('un instantane remplace la liste et oublie les gestes des questions disparues', () => {
    const store = useAsks.getState();
    store.applySnapshot([ask({ id: 'a' })], [{ label: '5 min', seconds: 300 }], true);
    useAsks.getState().setPhase('a', 'failed');
    useAsks.getState().setNotice('a', 'not sent');
    assert.equal(useAsks.getState().phase['a'], 'failed');
    useAsks.getState().applySnapshot([ask({ id: 'b' })], [], true);
    assert.deepEqual(useAsks.getState().asks.map((x) => x.id), ['b']);
    assert.equal(useAsks.getState().phase['a'], undefined);
    assert.equal(useAsks.getState().notice['a'], undefined);
    // Des delais vides ne remplacent pas ceux qu'on connait : ils viennent de Kova et
    // ne changent pas, et une liste vide ferait disparaitre les boutons « Later ».
    assert.deepEqual(useAsks.getState().snoozeChoices, [{ label: '5 min', seconds: 300 }]);
  });
});

describe('questions des agents : ce qui part au Mac', () => {
  it('le bouton doit etre un de ceux que l agent a declares', () => {
    const q = ask({ id: 'a' });
    assert.equal(isAskButton(q, 'OK'), true);
    assert.equal(isAskButton(q, 'ok'), false);
    assert.equal(isAskButton(q, 'OK; rm -rf /'), false);
    assert.equal(isAskButton(q, ''), false);
  });

  it('le texte libre est coupe au plafond du protocole, espaces en moins', () => {
    assert.equal(askText('  coupe le dernier paragraphe  '), 'coupe le dernier paragraphe');
    assert.equal(askText('').length, 0);
    assert.equal(askText('x'.repeat(ASK_TEXT_MAX + 50)).length, ASK_TEXT_MAX);
  });
});
