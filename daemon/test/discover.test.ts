import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { discoverKovaSocket, discoverKovaSockets, KOVA_EXEC, type DiscoverDeps } from '../src/kova/discover.js';

function deps(over: Partial<DiscoverDeps> = {}): DiscoverDeps {
  return {
    readDir: () => ['kova-85882.sock'],
    statSocket: () => ({ isSocket: true, uid: 501, mode: 0o600, mtimeMs: 1000 }),
    commOf: () => `${KOVA_EXEC}\n`,
    currentUid: () => 501,
    ...over,
  };
}

describe('decouverte du socket Kova', () => {
  it('retient un socket dont le PID est bien Kova', () => {
    const found = discoverKovaSockets(deps());
    assert.equal(found.length, 1);
    assert.equal(found[0]?.pid, 85_882);
    assert.equal(found[0]?.path, '/tmp/kova-85882.sock');
  });

  it('ecarte un PID recycle : kill(pid,0) reussirait, ps dit autre chose (V9)', () => {
    // Cas reel mesure : le PID 488 est aujourd hui sociallayerd.
    const found = discoverKovaSockets(
      deps({
        readDir: () => ['kova-488.sock'],
        commOf: () => '/usr/libexec/sociallayerd\n',
      }),
    );
    assert.deepEqual(found, []);
  });

  it('ecarte un PID qui ne tourne plus', () => {
    assert.deepEqual(discoverKovaSockets(deps({ commOf: () => null })), []);
  });

  it('ignore les noms qui ne sont pas des sockets kova', () => {
    const found = discoverKovaSockets(
      deps({ readDir: () => ['kova.sock', 'kova-abc.sock', 'autre-1.sock', 'kova-1.sock.bak'] }),
    );
    assert.deepEqual(found, []);
  });

  it('refuse un socket appartenant a un autre compte (/tmp est ouvert a tous)', () => {
    const found = discoverKovaSockets(
      deps({ statSocket: () => ({ isSocket: true, uid: 502, mode: 0o600, mtimeMs: 1 }) }),
    );
    assert.deepEqual(found, []);
  });

  it('refuse un socket qui n est pas en 0600', () => {
    const found = discoverKovaSockets(
      deps({ statSocket: () => ({ isSocket: true, uid: 501, mode: 0o666, mtimeMs: 1 }) }),
    );
    assert.deepEqual(found, []);
  });

  it('refuse une entree qui n est pas un socket', () => {
    const found = discoverKovaSockets(
      deps({ statSocket: () => ({ isSocket: false, uid: 501, mode: 0o600, mtimeMs: 1 }) }),
    );
    assert.deepEqual(found, []);
  });

  it('classe le plus recemment actif en tete', () => {
    const mtimes: Record<string, number> = {
      '/tmp/kova-1.sock': 10,
      '/tmp/kova-2.sock': 999,
      '/tmp/kova-3.sock': 500,
    };
    const found = discoverKovaSockets(
      deps({
        readDir: () => ['kova-1.sock', 'kova-2.sock', 'kova-3.sock'],
        statSocket: (p) => ({ isSocket: true, uid: 501, mode: 0o600, mtimeMs: mtimes[p] ?? 0 }),
      }),
    );
    assert.deepEqual(
      found.map((f) => f.pid),
      [2, 3, 1],
    );
    assert.equal(discoverKovaSocket(deps({
      readDir: () => ['kova-1.sock', 'kova-2.sock', 'kova-3.sock'],
      statSocket: (p) => ({ isSocket: true, uid: 501, mode: 0o600, mtimeMs: mtimes[p] ?? 0 }),
    }))?.pid, 2);
  });

  it('renvoie null quand /tmp est illisible', () => {
    assert.equal(
      discoverKovaSocket(
        deps({
          readDir: () => {
            throw new Error('EACCES');
          },
        }),
      ),
      null,
    );
  });
});
