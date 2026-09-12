// Un seul bouton d'action à droite de la barre de message, jamais deux, jamais un mot.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barAction, canEdit, type BarInput } from '@/features/chat/barAction';

const base: BarInput = {
  locked: false, disabled: false, working: false, hasText: false, hasAttachments: false, sending: false, transcribing: false, recording: false,
};

describe('barAction', () => {
  it('champ vide et agent au repos : le micro', () => {
    assert.deepEqual(barAction(base), { kind: 'mic', enabled: true });
  });
  it('du texte ou des pièces : Send', () => {
    assert.deepEqual(barAction({ ...base, hasText: true }), { kind: 'send', enabled: true });
    assert.deepEqual(barAction({ ...base, hasAttachments: true }), { kind: 'send', enabled: true });
  });
  it('agent au travail : Stop, même avec du texte, le champ reste éditable', () => {
    assert.deepEqual(barAction({ ...base, working: true, hasText: true }), { kind: 'stop' });
    assert.equal(canEdit({ ...base, working: true }), true);
  });
  it('verrouillé par un prompt parsé : pilule grisée, rien ne part, pas de Stop non plus', () => {
    assert.deepEqual(barAction({ ...base, locked: true }), { kind: 'mic', enabled: false });
    assert.deepEqual(barAction({ ...base, locked: true, hasText: true }), { kind: 'send', enabled: false });
    assert.deepEqual(barAction({ ...base, locked: true, working: true }), { kind: 'mic', enabled: false });
    assert.equal(canEdit({ ...base, locked: true }), false);
  });
  it('pane fermé ou sans agent : aucun bouton', () => {
    assert.deepEqual(barAction({ ...base, disabled: true }), { kind: 'none' });
    assert.deepEqual(barAction({ ...base, disabled: true, hasText: true }), { kind: 'send', enabled: false });
  });
  it('enregistrement, transcription ou envoi de pièces : occupé, champ figé', () => {
    assert.deepEqual(barAction({ ...base, recording: true }), { kind: 'busy' });
    assert.deepEqual(barAction({ ...base, transcribing: true, hasText: true }), { kind: 'busy' });
    assert.deepEqual(barAction({ ...base, sending: true, hasAttachments: true }), { kind: 'busy' });
    assert.equal(canEdit({ ...base, recording: true }), false);
  });
});
