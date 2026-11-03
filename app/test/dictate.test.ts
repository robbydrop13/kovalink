// Le bouton dictee de l'accueil vise la session claap-agent. Panes construits a la main.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pane } from '@/protocol';
import { dictateTarget } from '@/features/home/dictate';

function pane(partial: Partial<Pane> & { id: number }): Pane {
  return {
    window: 0, tab: 0, cwd: '/Users/alice/dev/x', title: 'claude', focused: false, pid: 1,
    child_processes: [], is_idle: false, working: false, awaiting: false, awaiting_since: null,
    awaiting_seen: false, minimized: false, agent: 'claude', agent_session_id: null,
    agent_session_name: null, claude_session_id: null, claude_session_name: null,
    resume_agent: null, resume_session_id: null, resume_command: null, projectName: 'x',
    hasTranscript: false, chatCapable: true, permissionMode: null, color: null, tabId: null,
    launching: false, liveState: 'idle',
    ...partial,
  } as Pane;
}

describe('dictateTarget', () => {
  it('finds the claap-agent session by name', () => {
    const panes = [pane({ id: 1, agent_session_name: 'perso-agent' }), pane({ id: 7, agent_session_name: 'claap-agent' })];
    assert.equal(dictateTarget(panes)?.id, 7);
  });
  it('returns null when claap-agent is not open', () => {
    assert.equal(dictateTarget([pane({ id: 1, agent_session_name: 'perso-agent' })]), null);
  });
  it('ignores a claap-agent pane whose agent has exited', () => {
    assert.equal(dictateTarget([pane({ id: 3, title: 'claap-agent', agent: null })]), null);
  });
});
