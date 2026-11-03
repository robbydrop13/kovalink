import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Routine } from '@/protocol';
import { groupRoutines, inWords, lastWords, needsAttention, nextWords, sectionOf, statusOf } from '@/features/scheduled/group';

// Mardi 3 novembre 2026, 18:45 heure locale : l'heure du prototype.
const now = new Date(2026, 10, 3, 18, 45).getTime();

const at = (day: number, hour: number, minute: number): string => new Date(2026, 10, day, hour, minute).toISOString();
const before = (minutes: number): string => new Date(now - minutes * 60_000).toISOString();

function routine(over: Partial<Routine> & { name: string }): Routine {
  return {
    schedule: 'daily 09:00',
    scheduleWords: 'daily 09:00',
    enabled: true,
    done: false,
    active: true,
    manual: false,
    loaded: true,
    running: false,
    nextRun: null,
    last: null,
    description: '',
    ...over,
  };
}

const ok = (minutesAgo: number) => ({ start: before(minutesAgo + 1), end: before(minutesAgo), code: 0 });
const failed = (minutesAgo: number, code = 1) => ({ start: before(minutesAgo + 1), end: before(minutesAgo), code });

describe('nextWords', () => {
  it("aujourd'hui : l'heure seule", () => {
    assert.equal(nextWords(at(3, 19, 5), now), '19:05');
  });
  it('dans les sept jours : jour court et heure', () => {
    assert.equal(nextWords(at(4, 9, 3), now), 'Wed 09:03');
    assert.equal(nextWords(at(9, 9, 0), now), 'Mon 09:00');
  });
  it('au-delà de sept jours : le jour et le mois', () => {
    assert.equal(nextWords(at(10, 9, 0), now), '10 Nov');
    assert.equal(nextWords(new Date(2026, 11, 1, 9, 0).toISOString(), now), '1 Dec');
  });
  it('sans échéance : rien', () => {
    assert.equal(nextWords(null, now), '');
  });
});

describe('inWords', () => {
  it('minutes, heures, jours', () => {
    assert.equal(inWords(new Date(now + 20 * 60_000).toISOString(), now), 'in 20 min');
    assert.equal(inWords(new Date(now + 2 * 3_600_000).toISOString(), now), 'in 2 h');
    assert.equal(inWords(new Date(now + 3 * 86_400_000).toISOString(), now), 'in 3 d');
  });
  it('échéance passée : maintenant', () => {
    assert.equal(inWords(new Date(now - 60_000).toISOString(), now), 'now');
  });
});

describe('lastWords', () => {
  it('just now, minutes, heures, jours', () => {
    assert.equal(lastWords(new Date(now - 20_000).toISOString(), now), 'just now');
    assert.equal(lastWords(new Date(now - 10 * 60_000).toISOString(), now), '10 min ago');
    assert.equal(lastWords(new Date(now - 9 * 3_600_000).toISOString(), now), '9 h ago');
    assert.equal(lastWords(new Date(now - 2 * 86_400_000).toISOString(), now), '2 d ago');
  });
  it('sans passage : rien', () => {
    assert.equal(lastWords(null, now), '');
  });
});

describe('statusOf', () => {
  it('Ok, Failed(code), Never, Running', () => {
    assert.deepEqual(statusOf(routine({ name: 'alpha', last: ok(10) })), { kind: 'ok', label: 'Ok' });
    assert.deepEqual(statusOf(routine({ name: 'beta', last: failed(10) })), { kind: 'failed', label: 'Failed(1)' });
    assert.deepEqual(statusOf(routine({ name: 'gamma', last: failed(10, 7) })), { kind: 'failed', label: 'Failed(7)' });
    assert.deepEqual(statusOf(routine({ name: 'delta' })), { kind: 'never', label: 'Never' });
    assert.deepEqual(statusOf(routine({ name: 'epsilon', running: true, last: failed(10) })), {
      kind: 'running',
      label: 'Running',
    });
  });
});

describe('sectionOf et groupRoutines', () => {
  it('une routine en échec non suspendue va dans Needs attention, une seule fois', () => {
    const spot = routine({ name: 'alpha', nextRun: at(3, 19, 5), last: failed(600) });
    assert.equal(sectionOf(spot, now), 'attention');
    const sections = groupRoutines([spot], now);
    assert.deepEqual(
      sections.map((s) => [s.key, s.routines.map((r) => r.name)]),
      [['attention', ['alpha']]],
    );
  });

  it('suspendue : Off, même après un échec', () => {
    const paused = routine({ name: 'beta', enabled: false, last: failed(600) });
    assert.equal(sectionOf(paused, now), 'off');
    assert.equal(needsAttention([paused]), false);
  });

  it('Today, This week, Later, Off, et la routine manuelle dans Later', () => {
    const list = [
      routine({ name: 'alpha', nextRun: at(3, 19, 5), last: ok(10) }),
      routine({ name: 'beta', nextRun: at(4, 9, 3), last: ok(60 * 9) }),
      routine({ name: 'gamma', nextRun: at(20, 9, 0), last: ok(60 * 24 * 2) }),
      routine({ name: 'delta', manual: true }),
      routine({ name: 'epsilon', enabled: false, nextRun: null }),
    ];
    const sections = groupRoutines(list, now);
    assert.deepEqual(
      sections.map((s) => [s.key, s.routines.map((r) => r.name)]),
      [
        ['today', ['alpha']],
        ['week', ['beta']],
        ['later', ['gamma', 'delta']],
        ['off', ['epsilon']],
      ],
    );
  });

  it('aucune section vide', () => {
    assert.deepEqual(groupRoutines([], now), []);
  });

  it('needsAttention ne regarde que les routines actives en échec', () => {
    assert.equal(needsAttention([routine({ name: 'alpha', last: failed(10) })]), true);
    assert.equal(needsAttention([routine({ name: 'alpha', last: ok(10) })]), false);
    assert.equal(needsAttention(null), false);
  });
});
