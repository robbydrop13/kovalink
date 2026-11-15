import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-sleep-'));
process.env['KOVALINK_QUIET'] = '1';

const { SleepAssertion, SLEEP_CAP_MS, PHONE_HOLD_MS, PUSH_HOLD_MS, parseAcPower } = await import('../src/sleep.js');

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
 * Horloge simulee : `advance` avance le temps et fait sonner, dans l'ordre, les minuteries
 * echues, y compris celles qu'une minuterie rearme.
 */
function clocked(opts: { ac?: boolean; enabled?: boolean } = {}) {
  let now = 0;
  let ac = opts.ac ?? true;
  let flag = opts.enabled ?? true;
  let spawned = 0;
  let killed = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const sleep = new SleepAssertion(() => flag, {
    spawn: () => {
      spawned += 1;
      return { kill: () => void (killed += 1) };
    },
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
    pid: 4242,
    now: () => now,
    onAcPower: () => ac,
  });
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
    spawned: () => spawned,
    killed: () => killed,
    setAc: (v: boolean) => void (ac = v),
    setEnabled: (v: boolean) => void (flag = v),
  };
}

const MIN = 60_000;

describe('anti-veille : Robin au telephone (15 novembre)', () => {
  it('rejoue le 15 novembre : agents a l arret, telephone connecte 75 s plus tard, le Mac reste eveille', () => {
    const h = clocked();
    h.sleep.reconcile(true);
    h.sleep.reconcile(false); // 14:30:36, « plus aucun agent au travail »
    assert.equal(h.sleep.active, false);
    h.advance(75_000); // 14:31:51, l'iPhone se connecte et envoie `hello`
    h.sleep.touch('phone');
    assert.equal(h.sleep.active, true, 'sans cette tenue, veille a 14:32:08');
    // Robin lit sa liste : un ping toutes les 20 s pendant 10 minutes.
    for (let i = 0; i < 30; i++) {
      h.advance(20_000);
      h.sleep.touch('phone');
    }
    assert.equal(h.sleep.active, true);
    assert.equal(h.spawned(), 2, 'un seul caffeinate pour toute la tenue');
    // Il range le telephone : 15 minutes apres le dernier message, le Mac peut dormir.
    h.advance(PHONE_HOLD_MS - 1);
    assert.equal(h.sleep.active, true);
    h.advance(1);
    assert.equal(h.sleep.active, false);
    assert.equal(h.killed(), 2);
  });

  it('une notification tient le Mac 30 minutes, le temps que Robin la touche', () => {
    const h = clocked();
    h.sleep.touch('push');
    assert.equal(h.sleep.active, true);
    h.advance(PUSH_HOLD_MS - 1);
    assert.equal(h.sleep.active, true);
    h.advance(1);
    assert.equal(h.sleep.active, false);
  });

  it('un message du telephone ne raccourcit pas la tenue d une notification', () => {
    const h = clocked();
    h.sleep.touch('push');
    h.advance(MIN);
    h.sleep.touch('phone');
    h.advance(PUSH_HOLD_MS - MIN - 1);
    assert.equal(h.sleep.active, true);
    h.advance(1);
    assert.equal(h.sleep.active, false);
  });

  it('sur batterie, ni le telephone ni une notification ne tiennent le Mac ; l agent au travail, si', () => {
    const h = clocked({ ac: false });
    h.sleep.touch('phone');
    h.sleep.touch('push');
    assert.equal(h.sleep.active, false);
    h.sleep.reconcile(true);
    assert.equal(h.sleep.active, true);
  });

  it('interrupteur desactive : aucune tenue', () => {
    const h = clocked({ enabled: false });
    h.sleep.touch('phone');
    assert.equal(h.sleep.active, false);
    assert.equal(h.spawned(), 0);
  });

  it('la fin du travail d un agent ne relache pas pendant que Robin est au telephone', () => {
    const h = clocked();
    h.sleep.reconcile(true);
    h.sleep.touch('phone');
    h.sleep.reconcile(false);
    assert.equal(h.sleep.active, true);
    assert.equal(h.killed(), 0, 'le meme caffeinate continue');
    h.advance(PHONE_HOLD_MS);
    assert.equal(h.sleep.active, false);
  });

  it('le plafond de 4 h vaut aussi pour un telephone qui ne lache jamais', () => {
    const h = clocked();
    for (let t = 0; t < SLEEP_CAP_MS + 10 * MIN; t += MIN) {
      h.sleep.touch('phone');
      h.advance(MIN);
    }
    assert.equal(h.sleep.active, false, 'relache au plafond, pas reposee tant que le telephone insiste');
    assert.equal(h.spawned(), 1);
    h.advance(PHONE_HOLD_MS);
    h.sleep.touch('phone');
    assert.equal(h.sleep.active, true, 'apres un vrai silence, une nouvelle tenue est permise');
  });

  it('stop() desarme la tenue', () => {
    const h = clocked();
    h.sleep.touch('phone');
    h.sleep.stop();
    assert.equal(h.sleep.active, false);
    h.advance(PHONE_HOLD_MS);
    assert.equal(h.killed(), 1);
  });

  it('lit l alimentation dans la sortie de pmset', () => {
    assert.equal(parseAcPower("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged"), true);
    assert.equal(parseAcPower("Now drawing from 'Battery Power'\n -InternalBattery-0\t80%; discharging"), false);
    assert.equal(parseAcPower(''), false);
  });
});
