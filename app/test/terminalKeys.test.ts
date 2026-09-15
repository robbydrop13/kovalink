// Barre de saisie du terminal : touches de la table fermée uniquement, désactivée hors ligne.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isKeyName } from '@/protocol';
import { TERMINAL_KEYS, canSendLine } from '@/features/terminal/terminalKeys';

describe('terminalKeys', () => {
  it('chaque touche vient de la table fermee, Esc Tab Ctrl-C fleches et Entree, dans cet ordre', () => {
    assert.deepEqual(TERMINAL_KEYS.map((k) => k.key), ['esc', 'tab', 'ctrl_c', 'up', 'down', 'enter']);
    for (const k of TERMINAL_KEYS) {
      assert.equal(isKeyName(k.key), true, k.key);
      assert.ok((k.label ? 1 : 0) + (k.icon ? 1 : 0) === 1, `${k.key}: un libelle ou une icone`);
      assert.ok(k.a11y.length > 0);
    }
  });

  it('une ligne vide ou un envoi en cours ne part pas', () => {
    assert.equal(canSendLine('ls', true, false), true);
    assert.equal(canSendLine('   ', true, false), false);
    assert.equal(canSendLine('ls', false, false), false);
    assert.equal(canSendLine('ls', true, true), false);
  });
});
