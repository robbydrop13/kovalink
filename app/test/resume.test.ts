// A4 : ce qu'un retour au premier plan redemande. Il n'existait AUCUN rafraîchissement au
// retour dans l'app : après une absence courte, un simple ping partait, et rien d'autre.
// Combiné au tail que personne ne rouvrait après un réveil du Mac, dix secondes passées
// dans une autre app pouvaient laisser le chat gelé pour toujours, pastille verte comprise.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BACKGROUND_RECONNECT_AFTER_MS, STALL_AFTER_MS, isStalled, resumeActions } from '@/net/resume';

const open = { open: true, awayMs: 1_000, visiblePaneId: 66, visibleSessionId: 'sess-1' };

describe('resumeActions', () => {
  it('redemande tout ce qui est visible après une absence courte', () => {
    assert.deepEqual(resumeActions(open), ['ping', 'panes.subscribe', 'pane.peek', 'session.attach']);
  });

  it('redemande même après dix secondes : la durée ne dispense de rien', () => {
    assert.deepEqual(resumeActions({ ...open, awayMs: 10_000 }), [
      'ping',
      'panes.subscribe',
      'pane.peek',
      'session.attach',
    ]);
  });

  it('sur la liste des sessions, ni peek ni attache', () => {
    assert.deepEqual(resumeActions({ ...open, visiblePaneId: null, visibleSessionId: null }), [
      'ping',
      'panes.subscribe',
    ]);
  });

  it('socket fermé ou absence longue : une reconnexion, et elle seule', () => {
    // Le `hello.ok` de la connexion neuve rejoue lui même l'abonnement, le `peek` et
    // l'attache de session : redemander ici enverrait tout en double.
    assert.deepEqual(resumeActions({ ...open, open: false }), ['reconnect']);
    assert.deepEqual(resumeActions({ ...open, awayMs: BACKGROUND_RECONNECT_AFTER_MS + 1 }), ['reconnect']);
    assert.deepEqual(resumeActions({ ...open, awayMs: BACKGROUND_RECONNECT_AFTER_MS }), [
      'ping',
      'panes.subscribe',
      'pane.peek',
      'session.attach',
    ]);
  });
});

describe('isStalled, le filet contre le gel silencieux', () => {
  const up = { appActive: true, linkUp: true, lastHeardAt: 1_000 };

  it('pastille verte, app à l écran, rien du Mac depuis plus de 45 s : gelé', () => {
    assert.equal(isStalled(up, 1_000 + STALL_AFTER_MS), false);
    assert.equal(isStalled(up, 1_000 + STALL_AFTER_MS + 1), true);
  });

  it('en arrière plan, les minuteries dorment : un long silence n y veut rien dire', () => {
    assert.equal(isStalled({ ...up, appActive: false }, 10 * STALL_AFTER_MS), false);
  });

  it('liaison déjà annoncée coupée, ou jamais rien reçu : pas de second diagnostic', () => {
    assert.equal(isStalled({ ...up, linkUp: false }, 10 * STALL_AFTER_MS), false);
    assert.equal(isStalled({ ...up, lastHeardAt: null }, 10 * STALL_AFTER_MS), false);
  });
});
