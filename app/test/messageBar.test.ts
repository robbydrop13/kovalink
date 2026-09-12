// Un seul bouton d'action à droite de la barre de message, jamais deux, jamais un mot.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barAction, canEdit, micState, type BarInput } from '@/features/chat/barAction';

const base: BarInput = {
  locked: false, disabled: false, working: false, hasText: false, hasAttachments: false, sending: false, transcribing: false, recording: false,
};

describe('barAction', () => {
  it('champ vide et agent au repos : aucun bouton à droite, le micro fantôme à gauche est actif', () => {
    assert.deepEqual(barAction(base), { kind: 'none' });
    assert.deepEqual(micState(base), { enabled: true, dimmed: false });
  });
  it('du texte ou des pièces : Send', () => {
    assert.deepEqual(barAction({ ...base, hasText: true }), { kind: 'send', enabled: true });
    assert.deepEqual(barAction({ ...base, hasAttachments: true }), { kind: 'send', enabled: true });
  });
  it('agent au travail et champ vide : Stop ; avec du texte, priorité à Send, le micro reste, atténué', () => {
    assert.deepEqual(barAction({ ...base, working: true }), { kind: 'stop' });
    assert.deepEqual(barAction({ ...base, working: true, hasText: true }), { kind: 'send', enabled: true });
    assert.deepEqual(micState({ ...base, working: true, hasText: true }), { enabled: true, dimmed: true });
    assert.equal(canEdit({ ...base, working: true }), true);
  });
  it('verrouillé par un prompt parsé : pilule grisée, rien ne part, ni Stop ni micro', () => {
    assert.deepEqual(barAction({ ...base, locked: true }), { kind: 'none' });
    assert.deepEqual(barAction({ ...base, locked: true, hasText: true }), { kind: 'send', enabled: false });
    assert.deepEqual(barAction({ ...base, locked: true, working: true }), { kind: 'none' });
    assert.deepEqual(micState({ ...base, locked: true }), { enabled: false, dimmed: false });
    assert.equal(canEdit({ ...base, locked: true }), false);
  });
  it('pane fermé ou sans agent : aucun bouton, micro inactif', () => {
    assert.deepEqual(barAction({ ...base, disabled: true }), { kind: 'none' });
    assert.deepEqual(barAction({ ...base, disabled: true, working: true }), { kind: 'none' });
    assert.deepEqual(barAction({ ...base, disabled: true, hasText: true }), { kind: 'send', enabled: false });
    assert.equal(micState({ ...base, disabled: true }).enabled, false);
  });
  it('enregistrement, transcription ou envoi de pièces : occupé, champ figé', () => {
    assert.deepEqual(barAction({ ...base, recording: true }), { kind: 'busy' });
    assert.deepEqual(barAction({ ...base, transcribing: true, hasText: true }), { kind: 'busy' });
    assert.deepEqual(barAction({ ...base, sending: true, hasAttachments: true }), { kind: 'busy' });
    assert.equal(canEdit({ ...base, recording: true }), false);
    assert.equal(micState({ ...base, transcribing: true }).enabled, false);
  });
});
