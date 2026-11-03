// Needs you cote telephone : ce que les magasins traduisent en `NeedInput`, ce que le
// protocole en fait, et l'ordre que Next parcourt. Noms inventes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { needItems, type AskItem, type NeedItem, type Pane, type Prompt, type Routine } from '@/protocol';
import {
  askIdOf,
  needCounts,
  needInputOf,
  nextNeedDecision,
  paneIdOfAsk,
  visibleNeedItems,
  type NeedsSnapshot,
} from '@/features/home/needs';

function pane(partial: Partial<Pane> & { id: number }): Pane {
  return {
    window: 0,
    tab: 0,
    cwd: '/x',
    title: 'claude',
    focused: false,
    pid: 1,
    child_processes: [],
    is_idle: false,
    working: false,
    awaiting: false,
    awaiting_since: null,
    awaiting_seen: false,
    minimized: false,
    agent: 'claude',
    agent_session_id: null,
    agent_session_name: null,
    claude_session_id: null,
    claude_session_name: null,
    resume_agent: null,
    resume_session_id: null,
    resume_command: null,
    projectName: 'x',
    hasTranscript: true,
    chatCapable: true,
    permissionMode: null,
    color: null,
    tabId: null,
    launching: false,
    liveState: 'idle',
    ...partial,
  };
}

function routine(partial: Partial<Routine> & { name: string }): Routine {
  return {
    schedule: 'daily at 09:17',
    scheduleWords: 'daily at 09:17',
    enabled: true,
    done: false,
    active: true,
    manual: false,
    loaded: true,
    running: false,
    nextRun: null,
    last: null,
    description: '',
    ...partial,
  };
}

function ask(partial: Partial<AskItem> & { id: string }): AskItem {
  return {
    from: 'agent',
    message: 'Ship it?',
    buttons: ['OK', 'KO'],
    input: false,
    askedAtMs: 1_000_000,
    snoozedUntilMs: 0,
    due: true,
    waiting: true,
    sessionId: null,
    cwd: null,
    ...partial,
  };
}

function parsed(paneId: number, awaitingSince: string, question: string, detail: string[] = []): Prompt {
  return {
    state: 'parsed',
    paneId,
    awaitingSince,
    question,
    detail,
    options: [],
    freeTextAllowed: true,
    promptHash: 'hash',
    promptRef: `r${paneId}`,
  };
}

function snapshot(partial: Partial<NeedsSnapshot>): NeedsSnapshot {
  return { panes: [], prompts: {}, routines: [], asks: [], nowMs: 2_000_000, ...partial };
}

describe('needInputOf : ce que les magasins savent', () => {
  it('une erreur prend l heure ou l app l a vue pour la premiere fois', () => {
    const api = pane({ id: 7, title: 'alpha', error: { kind: 'Limit reached', text: 'resets 5pm' } });
    const input = needInputOf(snapshot({ panes: [api], errorSince: { 7: 1_500_000 } }));
    assert.deepEqual(input.panes, [
      { id: 7, error_since: 1_500, permission_since: null, title: 'alpha', detail: 'resets 5pm' },
    ]);
    assert.deepEqual(
      needItems(input).map((item) => item.key),
      ['pane:7'],
    );
  });

  it('un prompt de permission donne son debut et sa commande, meme sans awaiting', () => {
    const web = pane({ id: 8, title: 'beta' });
    const prompt = parsed(8, '2026-11-03T20:00:10.000Z', 'Run this?', ['Bash rm -rf build']);
    const input = needInputOf(snapshot({ panes: [web], prompts: { 8: prompt } }));
    const since = Math.floor(Date.parse('2026-11-03T20:00:10.000Z') / 1000);
    assert.deepEqual(input.panes, [
      { id: 8, error_since: null, permission_since: since, title: 'beta', detail: 'Bash rm -rf build' },
    ]);
  });

  it('un pane qui travaille ne montre ni erreur ni prompt', () => {
    const busy = pane({ id: 9, title: 'gamma', working: true, error: { kind: 'Error', text: 'lost' } });
    assert.deepEqual(needInputOf(snapshot({ panes: [busy] })).panes, []);
  });

  it('une routine en echec prend la fin de son dernier run, jamais un run en cours', () => {
    const routines = [
      routine({ name: 'nightly', last: { start: '2026-11-03T19:00:00Z', end: '2026-11-03T19:05:00.000Z', code: 1 } }),
      routine({ name: 'paused', enabled: false, last: { start: '2026-11-03T18:00:00Z', end: '2026-11-03T18:05:00Z', code: 2 } }),
      routine({ name: 'running', running: true, last: { start: '2026-11-03T17:00:00Z', end: '2026-11-03T17:05:00Z', code: 3 } }),
      routine({ name: 'fine', last: { start: '2026-11-03T16:00:00Z', end: '2026-11-03T16:05:00Z', code: 0 } }),
    ];
    const input = needInputOf(snapshot({ routines }));
    assert.deepEqual(
      needItems(input).map((item) => item.key),
      ['routine:nightly'],
    );
    assert.equal(
      input.routines?.find((item) => item.name === 'nightly')?.failed_at,
      Math.floor(Date.parse('2026-11-03T19:05:00.000Z') / 1000),
    );
    assert.equal(input.routines?.find((item) => item.name === 'paused')?.paused, true);
  });

  it('une question est rattachee a son pane par sa session et porte son report', () => {
    const api = pane({ id: 7, title: 'alpha', claude_session_id: 's1' });
    const question = ask({
      id: 'a1',
      message: 'Ship it?\nAfter the review',
      askedAtMs: 1_700_000_000_000,
      sessionId: 's1',
      snoozedUntilMs: 1_700_000_600_000,
    });
    const input = needInputOf(snapshot({ panes: [api], asks: [question] }));
    assert.deepEqual(input.asks, [
      {
        id: 'a1',
        pane_id: 7,
        created_at: 1_700_000_000,
        snoozed_until: 1_700_000_600,
        answered: false,
        title: 'Ship it?',
        detail: 'After the review',
      },
    ]);
    assert.equal(paneIdOfAsk(question, [api]), 7);
  });

  it('le protocole garde son ordre : erreurs, routine, puis questions par age', () => {
    const input = needInputOf(
      snapshot({
        panes: [
          pane({ id: 4, title: 'delta', awaiting: true, awaiting_since: '2026-11-03T20:00:20.000Z' }),
          pane({ id: 3, title: 'alpha', error: { kind: 'Error', text: 'dead' } }),
        ],
        routines: [routine({ name: 'nightly', last: { start: '2026-11-03T18:00:00Z', end: '2026-11-03T18:01:00Z', code: 1 } })],
        asks: [ask({ id: 'a1', message: 'Ship it?', askedAtMs: 1_700_000_000_000 })],
        errorSince: { 3: 1_700_000_000_000 },
        nowMs: 1_700_100_000_000,
      }),
    );
    assert.deepEqual(
      needItems(input).map((item) => item.key),
      ['pane:3', 'routine:nightly', 'ask:a1', 'pane:4'],
    );
  });
});

describe('Needs you : les lignes et les comptes', () => {
  const items = needItems(
    needInputOf(
      snapshot({
        panes: [
          pane({ id: 4, title: 'delta', awaiting: true, awaiting_since: '2026-11-03T20:00:20.000Z' }),
          pane({ id: 3, title: 'alpha', error: { kind: 'Error', text: 'dead' } }),
        ],
        routines: [routine({ name: 'nightly', last: { start: '2026-11-03T18:00:00Z', end: '2026-11-03T18:01:00Z', code: 1 } })],
        asks: [
          ask({ id: 'a1', message: 'Ship it?', askedAtMs: 1_700_000_000_000 }),
          ask({ id: 'a2', message: 'Another?', askedAtMs: 1_700_000_100_000 }),
        ],
        errorSince: { 3: 1_700_000_000_000 },
        nowMs: 1_700_100_000_000,
      }),
    ),
  );

  it('compte ce qui attend une reponse, les erreurs et les routines a part', () => {
    assert.deepEqual(needCounts(items), { needYou: 3, errors: 1, failed: 1 });
  });

  it('les erreurs et routines restent, les questions remplissent quatre lignes', () => {
    assert.deepEqual(
      visibleNeedItems(items, false).map((item) => item.key),
      ['pane:3', 'routine:nightly', 'ask:a1', 'ask:a2'],
    );
    assert.deepEqual(
      visibleNeedItems(items, true).map((item) => item.key),
      items.map((item) => item.key),
    );
  });

  it('quatre erreurs debordent deja : les questions gardent deux lignes', () => {
    const error = (id: number): NeedItem => ({
      kind: 'error',
      key: `pane:${id}`,
      pane_id: id,
      since: id,
      title: `e${id}`,
      detail: '',
    });
    const question = (id: string): NeedItem => ({
      kind: 'ask',
      key: `ask:${id}`,
      pane_id: null,
      since: 0,
      title: id,
      detail: '',
    });
    const shown = visibleNeedItems(
      [error(1), error(2), error(3), error(4), question('a'), question('b'), question('c')],
      false,
    );
    assert.equal(shown.length, 6);
    assert.deepEqual(
      shown.slice(-2).map((item) => item.key),
      ['ask:a', 'ask:b'],
    );
  });

  it('l identifiant d une question se lit dans sa cle', () => {
    const question = items.find((item) => item.kind === 'ask');
    assert.ok(question);
    assert.equal(askIdOf(question), 'a1');
    const error = items.find((item) => item.kind === 'error');
    assert.ok(error);
    assert.equal(askIdOf(error), null);
  });
});

describe('Next : erreurs et questions d abord, la routine une fois', () => {
  const withRoutine = needItems(
    needInputOf(
      snapshot({
        panes: [
          pane({ id: 3, title: 'alpha', error: { kind: 'Error', text: 'dead' } }),
          pane({ id: 4, title: 'beta', awaiting: true, awaiting_since: '2026-11-03T20:00:20.000Z' }),
        ],
        routines: [routine({ name: 'nightly', last: { start: '2026-11-03T18:00:00Z', end: '2026-11-03T18:01:00Z', code: 1 } })],
        asks: [ask({ id: 'a1', message: 'Ship it?', askedAtMs: 1_700_000_000_000 })],
        errorSince: { 3: 1_700_000_000_000 },
        nowMs: 1_700_100_000_000,
      }),
    ),
  );

  it('parcourt les panes et les questions en bouclant, sans s arreter sur la routine', () => {
    const first = nextNeedDecision(withRoutine, null, false);
    assert.equal(first?.kind === 'need' ? first.item.pane_id : null, 3);
    const afterThree = nextNeedDecision(withRoutine, 3, false);
    assert.equal(afterThree?.kind === 'need' ? afterThree.item.key : null, 'ask:a1');
    const afterFour = nextNeedDecision(withRoutine, 4, false);
    assert.equal(afterFour?.kind === 'need' ? afterFour.item.pane_id : null, 3);
    assert.equal(nextNeedDecision(withRoutine.slice(0, 1), 3, false), null);
  });

  it('une seule routine en echec renvoie vers Scheduled, une seule fois', () => {
    const only = withRoutine.filter((item) => item.kind === 'failed_routine');
    assert.deepEqual(nextNeedDecision(only, null, false), { kind: 'scheduled', others: 1 });
    assert.equal(nextNeedDecision(only, null, true), null);
  });

  it('une question seule reste une cible, meme posee sur le pane courant', () => {
    const question = withRoutine.find((item) => item.kind === 'ask');
    assert.ok(question);
    const hit = nextNeedDecision([question], null, false);
    assert.equal(hit?.kind === 'need' ? hit.item.key : null, 'ask:a1');
    assert.equal(askIdOf(question), 'a1');
  });
});
