import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-sleep-'));
process.env['KOVALINK_QUIET'] = '1';

const { SleepAssertion, SLEEP_CAP_MS } = await import('../src/sleep.js');

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
