import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-lock-'));
process.env['KOVALINK_QUIET'] = '1';

const {
  detectLiveInstance,
  isLockAlive,
  lockPath,
  portInUse,
  readLock,
  scriptTailOf,
  writeInstanceLock,
  EXIT_ALREADY_RUNNING,
  EXIT_NO_LISTENER,
} = await import('../src/lock.js');
const { initRuntimeState, readRuntimeState, clearRuntimeState } = await import('../src/state.js');
const { statusLine } = await import('../src/status.js');

const ABS = '/Users/alice/Mes projets/link/daemon/dist/src/main.js';
const REL = 'daemon/dist/src/main.js';
const NODE = '/Users/alice/.nvm/versions/node/v20.20.1/bin/node';

/** Deux formes reelles de sortie de `ps -p <pid> -o command=`. */
const psAbsolute = `${NODE} ${ABS} run\n`;
const psRelative = `node ${REL} run\n`;

function deps(over: Record<string, unknown> = {}) {
  return {
    commandOf: () => psAbsolute,
    selfPid: () => 1000,
    selfScript: () => ABS,
    ...over,
  } as Parameters<typeof writeInstanceLock>[0];
}

/** Un port libre, obtenu en laissant le systeme en choisir un. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

function occupy(port: number): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(port, '127.0.0.1', () =>
      resolve({ close: () => new Promise<void>((r) => s.close(() => r())) }),
    );
  });
}

function reset(): void {
  clearRuntimeState();
  try {
    unlinkSync(lockPath());
  } catch {
    /* pas de verrou */
  }
}

describe('vivacite du verrou, invocation relative ou absolue', () => {
  it('la queue de chemin est commune aux deux formes', () => {
    assert.equal(scriptTailOf(ABS), 'dist/src/main.js');
    assert.equal(scriptTailOf(REL), 'dist/src/main.js');
  });

  it('MEME VERDICT que le daemon ait ete lance en relatif ou en absolu', () => {
    // C'est le test qui manquait. `ps -o command=` rend la commande TELLE QU'INVOQUEE :
    // comparer le chemin absolu complet declarait perime un verrou bien vivant, et le
    // verrou echouait donc en s'ouvrant.
    const lock = {
      pid: 1000,
      script: ABS,
      scriptTail: scriptTailOf(ABS),
      startedAt: '2026-09-10T10:00:00.000Z',
    };
    const verdictAbsolu = isLockAlive(lock, deps({ commandOf: () => psAbsolute }));
    const verdictRelatif = isLockAlive(lock, deps({ commandOf: () => psRelative }));
    assert.equal(verdictAbsolu, true, 'invocation absolue');
    assert.equal(verdictRelatif, true, 'invocation relative');
    assert.equal(verdictAbsolu, verdictRelatif);
  });

  it('tient aussi quand le verrou a ete ecrit depuis une invocation relative', () => {
    const lock = {
      pid: 1000,
      script: REL,
      scriptTail: scriptTailOf(REL),
      startedAt: '2026-09-10T10:00:00.000Z',
    };
    assert.equal(isLockAlive(lock, deps({ commandOf: () => psAbsolute })), true);
    assert.equal(isLockAlive(lock, deps({ commandOf: () => psRelative })), true);
  });

  it('exige que le programme soit un node, pas seulement un chemin qui ressemble', () => {
    const lock = { pid: 1, script: ABS, scriptTail: scriptTailOf(ABS), startedAt: '' };
    assert.equal(
      isLockAlive(lock, deps({ commandOf: () => `/bin/cat ${ABS}` })),
      false,
      'un autre programme citant le chemin ne compte pas',
    );
    assert.equal(isLockAlive(lock, deps({ commandOf: () => '/sbin/launchd' })), false);
    assert.equal(isLockAlive(lock, deps({ commandOf: () => null })), false);
  });

  it('ne se fie jamais au seul fait que le PID reponde', () => {
    const lock = { pid: 1, script: ABS, scriptTail: scriptTailOf(ABS), startedAt: '' };
    // PID vivant (launchd tourne toujours), mais ce n'est pas notre daemon.
    assert.equal(isLockAlive(lock, deps({ commandOf: () => '/sbin/launchd' })), false);
  });

  it('accepte un verrou ecrit par une version anterieure, sans scriptTail', () => {
    reset();
    writeFileSync(lockPath(), JSON.stringify({ pid: 1000, script: ABS, startedAt: '' }));
    const lock = readLock();
    assert.equal(lock?.scriptTail, 'dist/src/main.js');
    assert.equal(isLockAlive(lock!, deps({ commandOf: () => psRelative })), true);
  });
});

describe('detection d une instance vivante', () => {
  it('detecte par le verrou', async () => {
    reset();
    const port = await freePort();
    writeFileSync(
      lockPath(),
      JSON.stringify({
        pid: 1000,
        script: ABS,
        scriptTail: scriptTailOf(ABS),
        startedAt: '2026-09-10T10:00:00.000Z',
      }),
    );
    const live = await detectLiveInstance(port, deps({ selfPid: () => 2000 }));
    assert.equal(live?.kind, 'lock');
  });

  it('detecte par le PORT meme sans fichier de verrou, second signal independant', async () => {
    reset();
    const port = await freePort();
    const held = await occupy(port);
    const live = await detectLiveInstance(port, deps({ selfPid: () => 2000, commandOf: () => null }));
    assert.equal(live?.kind, 'port');
    await held.close();
  });

  it('ne detecte rien quand le verrou est mort et le port libre', async () => {
    reset();
    const port = await freePort();
    writeFileSync(
      lockPath(),
      JSON.stringify({ pid: 999_999, script: ABS, scriptTail: scriptTailOf(ABS), startedAt: '' }),
    );
    assert.equal(await detectLiveInstance(port, deps({ selfPid: () => 2000, commandOf: () => null })), null);
  });

  it('la detection n ECRIT rien', async () => {
    reset();
    const port = await freePort();
    await detectLiveInstance(port, deps());
    assert.equal(existsSync(lockPath()), false, 'aucun fichier de verrou ne doit apparaitre');
  });

  it('portInUse dit vrai sur un port pris, faux sur un port libre', async () => {
    const port = await freePort();
    assert.equal(await portInUse(port), false);
    const held = await occupy(port);
    assert.equal(await portInUse(port), true);
    await held.close();
  });
});

describe('pose du verrou', () => {
  it('pose le verrou et le libere', () => {
    reset();
    const res = writeInstanceLock(deps());
    assert.ok(!('heldBy' in res));
    assert.equal(readLock()?.pid, 1000);
    assert.equal(readLock()?.scriptTail, 'dist/src/main.js');
    if (!('heldBy' in res)) res.release();
    assert.equal(existsSync(lockPath()), false);
  });

  it('REFUSE d ecraser le verrou d une instance vivante, meme en relatif', () => {
    reset();
    const first = writeInstanceLock(deps());
    assert.ok(!('heldBy' in first));
    // Le scenario du daemon fantome : une seconde instance lancee en relatif croyait
    // le verrou perime et l ecrasait avec son propre PID.
    const second = writeInstanceLock(deps({ selfPid: () => 2000, commandOf: () => psRelative }));
    assert.ok('heldBy' in second, 'la seconde instance ne doit pas prendre le verrou');
    assert.equal(readLock()?.pid, 1000, 'le verrou du titulaire est intact');
    if (!('heldBy' in first)) first.release();
  });

  it('ecrase un verrou dont le PID a ete recycle par un autre programme', () => {
    reset();
    const first = writeInstanceLock(deps());
    const recycled = writeInstanceLock(
      deps({ selfPid: () => 2000, commandOf: () => '/usr/libexec/sociallayerd' }),
    );
    assert.ok(!('heldBy' in recycled));
    assert.equal(readLock()?.pid, 2000);
    if (!('heldBy' in recycled)) recycled.release();
    void first;
  });

  it('ignore un fichier de verrou corrompu', () => {
    reset();
    writeFileSync(lockPath(), 'pas du json');
    assert.equal(readLock(), null);
    const res = writeInstanceLock(deps());
    assert.ok(!('heldBy' in res));
    if (!('heldBy' in res)) res.release();
  });

  it('la liberation ne supprime que SON propre verrou', () => {
    reset();
    const first = writeInstanceLock(deps());
    writeFileSync(
      lockPath(),
      JSON.stringify({
        pid: 4242,
        script: ABS,
        scriptTail: scriptTailOf(ABS),
        startedAt: new Date().toISOString(),
      }),
    );
    if (!('heldBy' in first)) first.release();
    assert.equal(readLock()?.pid, 4242, 'le verrou du successeur doit survivre');
  });

  it('expose des codes de sortie distincts', () => {
    assert.equal(EXIT_ALREADY_RUNNING, 4);
    assert.equal(EXIT_NO_LISTENER, 5);
  });
});

describe('commande status', () => {
  it('dit que le daemon ne tourne pas quand aucun verrou vivant n existe', () => {
    reset();
    assert.equal(statusLine(), 'kovalinkd ne tourne pas.');
  });

  it('repond pareil que le daemon ait ete lance en relatif ou en absolu', () => {
    reset();
    const res = writeInstanceLock(deps({ selfPid: () => process.pid }));
    initRuntimeState({
      pid: process.pid,
      version: '0.1.0',
      startedAt: new Date().toISOString(),
      binds: ['127.0.0.1', '::1', '100.101.102.103'],
      port: 8765,
      kova: { status: 'up', pid: 85_882 },
      tsDns: 'mon-mac.tailnet-xxxx.ts.net',
      certExpiresAt: 'Dec  9 12:00:00 2026 GMT',
    });
    const lignAbs = statusLine(new Date(), deps({ selfPid: () => process.pid }));
    const lignRel = statusLine(
      new Date(),
      deps({ selfPid: () => process.pid, commandOf: () => psRelative }),
    );
    assert.match(lignAbs, /kovalinkd tourne/);
    assert.equal(lignRel, lignAbs, 'le verdict ne doit pas dependre de la forme du chemin');
    assert.equal(lignAbs.split('\n').length, 1, 'une seule ligne');
    assert.match(lignAbs, /100\.101\.102\.103/);
    assert.match(lignAbs, /port 8765/);
    assert.match(lignAbs, /kova up \(pid 85882\)/);
    assert.match(lignAbs, /Dec {2}9 12:00:00 2026 GMT/);
    assert.equal(readRuntimeState()?.port, 8765);
    if (!('heldBy' in res)) res.release();
  });

  it('signale un etat publie perime', () => {
    reset();
    const res = writeInstanceLock(deps({ selfPid: () => process.pid }));
    initRuntimeState({
      pid: process.pid,
      version: '0.1.0',
      startedAt: '2026-09-10T10:00:00.000Z',
      binds: ['127.0.0.1'],
      port: 8765,
      kova: { status: 'reconnecting', pid: null },
      tsDns: null,
      certExpiresAt: null,
    });
    const line = statusLine(
      new Date(Date.now() + 10 * 60_000),
      deps({ selfPid: () => process.pid }),
    );
    assert.match(line, /etat publie perime/);
    assert.match(line, /kova reconnecting/);
    if (!('heldBy' in res)) res.release();
  });
});
