// Les regles pures de la carte Asks : quel bouton part au clic, et ce que porte la requete.
// Aucun rendu ici : seulement les valeurs qui ne doivent jamais se tromper d'un caractere,
// parce que l'agent relit ce mot.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AskItem } from '@/protocol';
import { ASK_TEXT_MAX } from '@/protocol';
import { askAnswerBody, briefAction, koOption, okOption } from '@/features/asks/answer';

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

describe('carte Asks : ce qui part au Mac', () => {
  it('le check envoie le premier bouton declare', () => {
    assert.equal(okOption(ask({ id: 'a' })), 'OK');
    assert.equal(okOption(ask({ id: 'b', buttons: ['Ship now', 'Hold'] })), 'Ship now');
    assert.equal(okOption(ask({ id: 'c', buttons: [] })), null);
  });

  it('la croix envoie le second, et rien quand la question n en declare pas', () => {
    assert.equal(koOption(ask({ id: 'a' })), 'KO');
    assert.equal(koOption(ask({ id: 'b', buttons: ['OK'] })), null);
  });

  it('un Brief sans chip part en reponse libre (Other)', () => {
    assert.equal(briefAction(ask({ id: 'a' }), null), 'Other');
    assert.equal(briefAction(ask({ id: 'a' }), 'KO'), 'KO');
  });

  it('un chip hors de la question ne part jamais', () => {
    assert.equal(briefAction(ask({ id: 'a' }), 'Approve'), null);
  });

  it('le Other de Kova n est ni le check ni la croix', () => {
    assert.equal(okOption(ask({ id: 'd', buttons: ['Yes', 'Other'] })), 'Yes');
    assert.equal(koOption(ask({ id: 'd', buttons: ['Yes', 'Other'] })), null);
  });

  it('le corps porte le bouton tel quel et le texte borne', () => {
    assert.deepEqual(askAnswerBody('Approve', '  use a migration  '), {
      action: 'Approve',
      text: 'use a migration',
    });
    assert.deepEqual(askAnswerBody('Approve', ''), { action: 'Approve', text: '' });
    assert.equal(askAnswerBody('Approve', 'x'.repeat(ASK_TEXT_MAX + 50)).text.length, ASK_TEXT_MAX);
  });
});
