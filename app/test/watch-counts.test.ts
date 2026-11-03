// Les nombres du cadran : ce qui compte, ce qui ne compte pas, et quand part l'envoi.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AskItem, Pane, Prompt } from '@/protocol';
import {
  COUNTS_DEBOUNCE_MS,
  countsOf,
  type CountsTimers,
  createCountsThrottle,
  sameCounts,
  type WatchCounts,
} from '@/features/watch/counts';

/** Seconde epoch de reference des tests. */
const T0 = 1_700_000_000;

function pane(partial: Partial<Pane> & { id: number }): Pane {
  return {
    working: false,
    awaiting: false,
    awaiting_since: null,
    error: null,
    agent_session_id: null,
    claude_session_id: null,
    agent_session_name: null,
    title: null,
    projectName: 'kova',
    ...partial,
  } as unknown as Pane;
}

function ask(partial: Partial<AskItem> & { id: string }): AskItem {
  return {
    from: 'agent',
    message: 'Send it?',
    buttons: ['OK'],
    input: false,
    askedAtMs: 1_000,
    snoozedUntilMs: 0,
    due: true,
    waiting: true,
    sessionId: null,
    cwd: null,
    ...partial,
  };
}

function parsedPrompt(paneId: number, awaitingSince: string): Prompt {
  return {
    state: 'parsed',
    paneId,
    awaitingSince,
    question: 'Bash command',
    detail: ['rm -rf build'],
    options: [{ index: 1, label: 'Yes', kind: 'approve' }],
    freeTextAllowed: false,
    promptHash: 'h',
    promptRef: 'r',
  } as Prompt;
}

function counts(partial: Partial<WatchCounts> = {}): WatchCounts {
  return { asks: 0, errors: 0, ended: 0, oldestAt: null, ...partial };
}

describe('nombres du cadran : ce qui compte', () => {
  it('le compte du daemon fait foi, chaque pane en erreur compte, la plus ancienne attente donne oldestAt', () => {
    const snap = countsOf({
      panes: [
        pane({
          id: 1,
          error: { kind: 'API error', text: 'limit' },
          awaiting: true,
          awaiting_since: new Date(T0 * 1000).toISOString(),
        }),
        pane({ id: 2, error: { kind: 'Error', text: 'boom' } }),
        pane({ id: 3 }),
      ],
      prompts: {},
      asks: [ask({ id: 'a', askedAtMs: (T0 + 100) * 1000 })],
      waitsOnYou: 3,
      nowMs: (T0 + 900) * 1000,
    });
    assert.deepEqual(snap, { asks: 3, errors: 2, ended: 0, oldestAt: T0 });
  });

  it('une question reportee, ou sans heure, ne tire pas oldestAt en arriere', () => {
    const snap = countsOf({
      panes: [],
      prompts: {},
      asks: [
        ask({ id: 'later', due: false, snoozedUntilMs: (T0 + 3_600) * 1000 }),
        ask({ id: 'undated', askedAtMs: 0 }),
      ],
      waitsOnYou: 0,
      nowMs: (T0 + 900) * 1000,
    });
    assert.equal(snap.oldestAt, null);
  });

  it('sans compte du daemon, permissions et questions sont comptees localement', () => {
    const snap = countsOf({
      panes: [
        pane({ id: 1, awaiting: true, awaiting_since: new Date((T0 - 60) * 1000).toISOString() }),
        pane({ id: 2 }),
      ],
      prompts: { 2: parsedPrompt(2, new Date((T0 - 300) * 1000).toISOString()) },
      asks: [ask({ id: 'a', askedAtMs: T0 * 1000 })],
      waitsOnYou: null,
      nowMs: (T0 + 900) * 1000,
    });
    assert.equal(snap.asks, 3);
    // oldestAt suit la formule du daemon : l'attente lue sur les panes.
    assert.equal(snap.oldestAt, T0 - 60);
  });

  it('deux valeurs differentes des que l un des nombres change', () => {
    assert.equal(sameCounts(counts({ oldestAt: null }), counts({ oldestAt: 0 })), false);
    assert.equal(sameCounts(counts({ asks: 1 }), counts({ asks: 2 })), false);
    assert.equal(sameCounts(counts({ asks: 1 }), counts({ asks: 1 })), true);
  });
});

interface FakeClock {
  timers: CountsTimers;
  delays: number[];
  pending: () => number;
  fire: () => void;
}

function fakeClock(): FakeClock {
  let id = 0;
  const due = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    timers: {
      set: (fn, ms) => {
        id += 1;
        due.set(id, fn);
        delays.push(ms);
        return id;
      },
      clear: (handle) => {
        due.delete(handle as number);
      },
    },
    delays,
    pending: () => due.size,
    fire: () => {
      const callbacks = [...due.values()];
      due.clear();
      for (const callback of callbacks) callback();
    },
  };
}

describe('nombres du cadran : quand part l envoi', () => {
  it('une rafale ne fait qu un envoi, deux secondes apres le premier changement, avec la derniere valeur', () => {
    const clock = fakeClock();
    const sent: WatchCounts[] = [];
    const throttle = createCountsThrottle((c) => sent.push(c), { timers: clock.timers });

    throttle.push(counts({ asks: 1 }));
    throttle.push(counts({ asks: 2 }));
    throttle.push(counts({ asks: 3, errors: 1 }));

    assert.equal(sent.length, 0);
    assert.equal(clock.pending(), 1);
    assert.deepEqual(clock.delays, [COUNTS_DEBOUNCE_MS]);

    clock.fire();
    assert.deepEqual(sent, [counts({ asks: 3, errors: 1 })]);
  });

  it('revenir a ce que la montre a deja annule l envoi en attente', () => {
    const clock = fakeClock();
    const sent: WatchCounts[] = [];
    const throttle = createCountsThrottle((c) => sent.push(c), { timers: clock.timers });

    throttle.push(counts({ asks: 2 }));
    clock.fire();
    assert.equal(sent.length, 1);

    throttle.push(counts({ asks: 5 }));
    throttle.push(counts({ asks: 2 }));
    assert.equal(clock.pending(), 0);
    clock.fire();
    assert.equal(sent.length, 1);
  });

  it('un meme tuple ne rouvre pas de fenetre', () => {
    const clock = fakeClock();
    const sent: WatchCounts[] = [];
    const throttle = createCountsThrottle((c) => sent.push(c), { timers: clock.timers });

    throttle.push(counts({ asks: 2 }));
    clock.fire();
    throttle.push(counts({ asks: 2 }));
    assert.equal(clock.pending(), 0);
    assert.equal(sent.length, 1);
  });

  it('flush envoie tout de suite, stop jette ce qui attend', () => {
    const clock = fakeClock();
    const sent: WatchCounts[] = [];
    const throttle = createCountsThrottle((c) => sent.push(c), { timers: clock.timers });

    throttle.push(counts({ asks: 4 }));
    throttle.flush();
    assert.deepEqual(sent, [counts({ asks: 4 })]);
    assert.equal(clock.pending(), 0);

    throttle.push(counts({ asks: 7 }));
    throttle.stop();
    clock.fire();
    assert.equal(sent.length, 1);
  });
});
