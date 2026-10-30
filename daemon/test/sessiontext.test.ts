// Envoi par nom de session pour la montre : la resolution est celle du pont Slack, et un
// nom inconnu ou ambigu ne doit JAMAIS atteindre KeyGate. Le texte libre, lui, reste
// garde par `emitText` comme sur `paneText`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActionResponse, Pane } from '@kovalink/protocol';
import { sendToSession } from '../src/kova/sessionText.js';
import { ForbiddenError } from '../src/kova/keygate.js';

/** Pane minimal : ce que `resolveSession` lit pour nommer et choisir un candidat. */
function pane(id: number, name: string | null, title: string | null = null): Pane {
  return {
    id,
    agent: 'claude',
    claude_session_name: name,
    agent_session_name: null,
    title,
  } as unknown as Pane;
}

type Call = { paneId: number; text: string; deviceId: string };

/** Faux KeyGate : rend la reponse donnee (ou leve l'erreur) et garde les emissions. */
function deps(panes: readonly Pane[], answer: ActionResponse | Error = { applied: true }) {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      panes: () => panes,
      emitText: async (paneId: number, text: string, deviceId: string) => {
        calls.push({ paneId, text, deviceId });
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

const TWO = [pane(1, 'claap-agent'), pane(2, 'perso-agent')];

describe('sendToSession', () => {
  it('un nom exact atteint le bon pane et rend le nom de session', async () => {
    const h = deps(TWO);
    assert.deepEqual(await sendToSession(h.deps, 'claap-agent', 'hello', 'dev'), {
      applied: true,
      session: 'claap-agent',
    });
    assert.deepEqual(h.calls, [{ paneId: 1, text: 'hello', deviceId: 'dev' }]);
  });

  it('le nom est insensible a la casse', async () => {
    const h = deps(TWO);
    assert.deepEqual(await sendToSession(h.deps, 'CLAAp-Agent', 'hello', 'dev'), {
      applied: true,
      session: 'claap-agent',
    });
    assert.deepEqual(h.calls, [{ paneId: 1, text: 'hello', deviceId: 'dev' }]);
  });

  it('un prefixe unique suffit', async () => {
    const h = deps(TWO);
    assert.deepEqual(await sendToSession(h.deps, 'perso', 'hello', 'dev'), {
      applied: true,
      session: 'perso-agent',
    });
    assert.deepEqual(h.calls, [{ paneId: 2, text: 'hello', deviceId: 'dev' }]);
  });

  it('un nom inconnu rend unknown_session avec les noms, sans rien emettre', async () => {
    const h = deps(TWO);
    assert.deepEqual(await sendToSession(h.deps, 'nope', 'hello', 'dev'), {
      applied: false,
      reason: 'unknown_session',
      names: ['claap-agent', 'perso-agent'],
    });
    assert.deepEqual(h.calls, []);
  });

  it('deux panes au meme nom rendent ambiguous_session, sans rien emettre', async () => {
    const h = deps([pane(1, 'claap-agent'), pane(2, 'claap-agent'), pane(3, 'perso-agent')]);
    assert.deepEqual(await sendToSession(h.deps, 'claap-agent', 'hello', 'dev'), {
      applied: false,
      reason: 'ambiguous_session',
      names: ['claap-agent', 'perso-agent'],
    });
    assert.deepEqual(h.calls, []);
  });

  it('un refus de KeyGate (applied false) est rendu tel quel, avec le nom', async () => {
    const h = deps(TWO, { applied: false, reason: 'became_awaiting' });
    assert.deepEqual(await sendToSession(h.deps, 'claap-agent', 'hello', 'dev'), {
      applied: false,
      reason: 'became_awaiting',
      session: 'claap-agent',
    });
    assert.deepEqual(h.calls, [{ paneId: 1, text: 'hello', deviceId: 'dev' }]);
  });

  it('ForbiddenError de KeyGate remonte, la route la traduira en 403', async () => {
    const h = deps(TWO, new ForbiddenError('TEXT_TOO_LONG', 'text over limit'));
    await assert.rejects(
      sendToSession(h.deps, 'claap-agent', 'hello', 'dev'),
      (e: unknown) => e instanceof ForbiddenError && e.code === 'TEXT_TOO_LONG',
    );
  });
});
