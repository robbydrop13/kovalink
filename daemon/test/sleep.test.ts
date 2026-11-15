import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-sleep-'));
process.env['KOVALINK_QUIET'] = '1';

const { SleepAssertion, SLEEP_CAP_MS, RESPAWN_DELAY_MS, parseAcPower } = await import('../src/sleep.js');
const { sleepPart } = await import('../src/status.js');

/**
 * Faux `caffeinate` et minuteries simulees : on verifie les ARGUMENTS passes et la
 * minuterie du plafond sans lancer un processus ni attendre 4 h.
 */
function harness(enabled = true) {
  const spawned: string[][] = [];
  let killed = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimer = 1;
  let flag = enabled;
  const sleep = new SleepAssertion(() => flag, {
    spawn: (args) => {
      spawned.push(args);
      return {
        kill: () => {
          killed += 1;
        },
      };
    },
    setTimeout: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (h) => {
      timers.delete(h as number);
    },
    pid: 4242,
  });
  const fireCap = (): void => {
    for (const [id, t] of timers) {
      timers.delete(id);
      t.fn();
    }
  };
  return {
    sleep,
    spawned,
    killed: () => killed,
    timers,
    fireCap,
    setEnabled: (v: boolean) => {
      flag = v;
    },
  };
}

describe('assertion anti-veille (A1, A13)', () => {
  it('pose caffeinate -i -w <pid du daemon>, pour mourir avec lui', () => {
    const h = harness();
    h.sleep.reconcile(true);
    assert.deepEqual(h.spawned, [['-i', '-w', '4242']]);
    assert.equal(h.sleep.active, true);
  });

  it('ne pose qu une seule assertion tant qu un agent travaille', () => {
    const h = harness();
    h.sleep.reconcile(true);
    h.sleep.reconcile(true);
    h.sleep.reconcile(true);
    assert.equal(h.spawned.length, 1);
  });

  it('relache des que plus aucun agent ne travaille', () => {
    const h = harness();
    h.sleep.reconcile(true);
    h.sleep.reconcile(false);
    assert.equal(h.killed(), 1);
    assert.equal(h.sleep.active, false);
    assert.equal(h.timers.size, 0, 'la minuterie du plafond est desarmee');
  });

  it('interrupteur desactive : aucune assertion, meme avec un agent en working (CA-126)', () => {
    const h = harness(false);
    h.sleep.reconcile(true);
    assert.deepEqual(h.spawned, []);
    assert.equal(h.sleep.active, false);
  });

  it('interrupteur desactive EN COURS de route : l assertion posee est relachee', () => {
    const h = harness(true);
    h.sleep.reconcile(true);
    h.setEnabled(false);
    h.sleep.reconcile(true);
    assert.equal(h.killed(), 1);
    assert.equal(h.sleep.active, false);
  });

  it('le plafond de 4 h est une MINUTERIE armee a la pose, pas une lecture au prochain evenement', () => {
    const h = harness();
    h.sleep.reconcile(true);
    assert.equal(h.timers.size, 1);
    const [timer] = [...h.timers.values()];
    assert.equal(timer?.ms, SLEEP_CAP_MS);
    assert.equal(SLEEP_CAP_MS, 4 * 3_600_000);
    h.fireCap();
    assert.equal(h.killed(), 1, 'caffeinate tue par la minuterie seule');
    assert.equal(h.sleep.active, false);
  });

  it('apres le plafond, aucune nouvelle assertion tant que le travail ne s est pas arrete (CA-125)', () => {
    const h = harness();
    h.sleep.reconcile(true);
    h.fireCap();
    h.sleep.reconcile(true);
    assert.equal(h.spawned.length, 1, 'un agent qui tourne depuis 4 h ne merite plus d assertion');
    h.sleep.reconcile(false);
    h.sleep.reconcile(true);
    assert.equal(h.spawned.length, 2, 'un nouveau travail rearme');
  });

  it('stop() relache et n echoue pas sur un processus deja mort', () => {
    const h = harness();
    h.sleep.reconcile(true);
    h.sleep.stop();
    h.sleep.stop();
    assert.equal(h.killed(), 1);
  });
});

/**
 * Banc avec horloge, alimentation et faux caffeinate que l'on peut faire mourir.
 * `advance` fait sonner, dans l'ordre, les minuteries echues.
 */
function bench(opts: { enabled?: boolean } = {}) {
  let now = Date.parse('2026-11-15T13:30:00Z');
  let flag = opts.enabled ?? true;
  const spawned: string[][] = [];
  const exits: Array<() => void> = [];
  let killed = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const states: Array<{ held: boolean; reason: string | null; power: string }> = [];
  const sleep = new SleepAssertion(() => flag, {
    spawn: (args) => {
      spawned.push(args);
      return {
        kill: () => void (killed += 1),
        onExit: (cb) => void exits.push(cb),
      };
    },
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
    pid: 4242,
    now: () => now,
  });
  sleep.onChange = (st) => states.push({ held: st.held, reason: st.reason, power: st.power });
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].fn();
    }
    now = end;
  };
  return {
    sleep,
    advance,
    spawned,
    states,
    killed: () => killed,
    /** Le dernier caffeinate meurt sans qu'on l'ait tue. */
    die: () => exits[exits.length - 1]?.(),
    setEnabled: (v: boolean) => void (flag = v),
  };
}

const HOUR = 3_600_000;

describe('anti-veille : sur secteur, le Mac ne dort jamais (Robin, 15 novembre)', () => {
  it('rejoue le 15 novembre : les agents s arretent a 14:30:36, le Mac reste tenu eveille', () => {
    const h = bench();
    h.sleep.setPower(true);
    h.sleep.reconcile(true);
    h.sleep.reconcile(false); // « plus aucun agent au travail » : avant, relache, veille 92 s plus tard
    assert.equal(h.sleep.active, true);
    assert.equal(h.killed(), 0);
    assert.deepEqual(h.spawned, [['-i', '-w', '4242']], 'un seul caffeinate, pose des la lecture du secteur');
    // Ni fenetre ni plafond : toujours tenu le lendemain.
    h.advance(24 * HOUR);
    assert.equal(h.sleep.active, true);
    assert.equal(h.spawned.length, 1);
    assert.equal(h.sleep.state.reason, 'ac');
    assert.equal(h.sleep.state.since, '2026-11-15T13:30:00.000Z');
  });

  it('sans aucun agent ni telephone, le secteur suffit', () => {
    const h = bench();
    assert.equal(h.sleep.active, false, 'alimentation encore inconnue : regle de la batterie');
    h.sleep.setPower(true);
    assert.equal(h.sleep.active, true);
  });

  it('un caffeinate qui meurt est repris, une seule fois, apres le delai', () => {
    const h = bench();
    h.sleep.setPower(true);
    h.die();
    assert.equal(h.sleep.active, false);
    assert.equal(h.sleep.state.held, false, 'state.json ne ment pas pendant le trou');
    h.sleep.reconcile(false);
    h.sleep.setPower(true);
    assert.equal(h.spawned.length, 1, 'pas de reprise en boucle serree');
    h.advance(RESPAWN_DELAY_MS);
    assert.equal(h.sleep.active, true);
    assert.equal(h.spawned.length, 2);
    h.advance(HOUR);
    assert.equal(h.spawned.length, 2);
  });

  it('debranche : retour a la regle de la batterie, agent au travail et plafond de 4 h', () => {
    const h = bench();
    h.sleep.setPower(true);
    h.sleep.reconcile(true);
    h.sleep.setPower(false);
    assert.deepEqual(h.spawned[1], ['-i', '-w', '4242']);
    assert.equal(h.killed(), 1, 'l assertion du secteur est remplacee, pas doublee');
    assert.equal(h.sleep.state.reason, 'agent');
    h.advance(SLEEP_CAP_MS);
    assert.equal(h.sleep.active, false, 'plafond de 4 h sur batterie');
    // Rebranche : tenu de nouveau, sans condition.
    h.sleep.setPower(true);
    assert.equal(h.sleep.active, true);
    h.advance(SLEEP_CAP_MS * 2);
    assert.equal(h.sleep.active, true, 'aucun plafond sur secteur');
  });

  it('debranche sans agent au travail : le Mac peut dormir', () => {
    const h = bench();
    h.sleep.setPower(true);
    h.sleep.setPower(false);
    assert.equal(h.sleep.active, false);
    assert.equal(h.killed(), 1);
  });

  it('une lecture de l alimentation en echec ne change rien', () => {
    const h = bench();
    h.sleep.setPower(true);
    h.sleep.setPower(null);
    assert.equal(h.sleep.active, true);
    assert.equal(h.spawned.length, 1);
  });

  it('interrupteur de l app desactive : rien, meme sur secteur ; reactive : repris', () => {
    const h = bench({ enabled: false });
    h.sleep.setPower(true);
    assert.equal(h.sleep.active, false);
    h.setEnabled(true);
    h.sleep.reconcile(false);
    assert.equal(h.sleep.active, true);
    h.setEnabled(false);
    h.sleep.reconcile(false);
    assert.equal(h.sleep.active, false);
  });

  it('chaque changement est publie pour state.json, et stop() relache sans reprise', () => {
    const h = bench();
    h.sleep.setPower(true);
    assert.deepEqual(h.states.at(-1), { held: true, reason: 'ac', power: 'ac' });
    h.sleep.stop();
    assert.deepEqual(h.states.at(-1), { held: false, reason: null, power: 'ac' });
    h.die();
    h.advance(HOUR);
    h.sleep.setPower(false);
    h.sleep.setPower(true);
    assert.equal(h.sleep.active, false, 'apres stop(), plus rien n est pose');
    assert.equal(h.spawned.length, 1);
  });

  it('lit l alimentation dans la sortie de pmset', () => {
    assert.equal(parseAcPower("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged"), true);
    assert.equal(parseAcPower("Now drawing from 'Battery Power'\n -InternalBattery-0\t80%; discharging"), false);
    assert.equal(parseAcPower(''), null);
  });

  it('kovalinkd status dit si le Mac est tenu eveille', () => {
    assert.equal(
      sleepPart({ held: true, reason: 'ac', since: '2026-11-15T13:30:00.000Z', power: 'ac' }),
      'Mac tenu eveille (secteur) depuis 2026-11-15T13:30:00.000Z',
    );
    assert.equal(sleepPart({ held: false, reason: null, since: null, power: 'battery' }), 'Mac libre de dormir (batterie)');
  });
});
