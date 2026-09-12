import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-rawpurge-'));
process.env['KOVALINK_QUIET'] = '1';

const { purgeOrphanRaws, RAW_PURGE_MIN_AGE_MS } = await import('../src/kova/rawPurge.js');
const { KOVA_EXEC } = await import('../src/kova/discover.js');
import type { RawPurgeDeps } from '../src/kova/rawPurge.js';

const NOW = 1_800_000_000_000;
const OLD = NOW - 2 * RAW_PURGE_MIN_AGE_MS;

function fixture(over: Partial<RawPurgeDeps> = {}) {
  const moved: { from: string; to: string }[] = [];
  const psCalls: number[] = [];
  const deps: RawPurgeDeps = {
    logsDir: '/logs',
    trashDir: '/trash',
    socketDir: '/tmp',
    readLogs: () => [
      'pty-capture-23414-1.raw',
      'pty-capture-23414-3.raw',
      'pty-capture-44276-1.raw',
      'pty-capture-44276-2.raw',
      'pty-capture-488-1.raw',
      'kova.log',
      'pty-capture-x-1.raw',
    ],
    readDir: () => ['kova-23414.sock'],
    statSocket: () => ({ isSocket: true, uid: 501, mode: 0o600, mtimeMs: NOW }),
    currentUid: () => 501,
    commOf: (pid) => {
      psCalls.push(pid);
      if (pid === 23414) return `${KOVA_EXEC}\n`;
      if (pid === 488) return '/usr/libexec/sociallayerd\n';
      return null;
    },
    statFile: () => ({ size: 1000, mtimeMs: OLD }),
    moveToTrash: (from, to) => {
      moved.push({ from, to });
    },
    now: () => NOW,
    ...over,
  };
  return { deps, moved, psCalls };
}

describe('purge des .raw orphelins (CA-129)', () => {
  it('deplace vers la corbeille les captures des PID morts, garde celles du socket vivant', () => {
    const { deps, moved } = fixture();
    const res = purgeOrphanRaws(deps);
    assert.deepEqual(
      res.purged.map((p) => p.name).sort(),
      ['pty-capture-44276-1.raw', 'pty-capture-44276-2.raw', 'pty-capture-488-1.raw'],
    );
    assert.equal(res.keptLive, 2);
    assert.equal(res.bytes, 3000);
    assert.deepEqual(
      moved.map((m) => m.to).sort(),
      ['/trash/pty-capture-44276-1.raw', '/trash/pty-capture-44276-2.raw', '/trash/pty-capture-488-1.raw'],
    );
  });

  it('un PID recycle par un autre processus est purge : ps dit sociallayerd, pas Kova (V9)', () => {
    const { deps } = fixture();
    const res = purgeOrphanRaws(deps);
    assert.ok(res.purged.some((p) => p.pid === 488));
  });

  it('un Kova vivant SANS socket (demarrage) est garde : le verdict vient de ps, jamais de kill(pid,0)', () => {
    const { deps, moved } = fixture({ readDir: () => [] });
    const res = purgeOrphanRaws(deps);
    assert.equal(res.keptLive, 2, 'les deux captures du PID 23414 restent');
    assert.equal(moved.some((m) => m.from.includes('23414')), false);
  });

  it('un fichier vivant est garde sans appeler ps quand son socket est la ; ps une fois par PID mort', () => {
    const { deps, psCalls } = fixture();
    purgeOrphanRaws(deps);
    // 23414 : identifie par discoverKovaSockets (qui appelle ps une fois), jamais revu.
    assert.deepEqual(
      psCalls.filter((p) => p !== 23414).sort((a, b) => a - b),
      [488, 44276],
      'chaque PID mort est verifie exactement une fois',
    );
  });

  it('la marge d age protege un fichier modifie il y a moins d une heure', () => {
    const { deps, moved } = fixture({ statFile: () => ({ size: 10, mtimeMs: NOW - 60_000 }) });
    const res = purgeOrphanRaws(deps);
    assert.equal(res.purged.length, 0);
    assert.equal(res.keptRecent, 3);
    assert.equal(moved.length, 0);
  });

  it('en simulation, rien n est deplace mais le resultat est le meme', () => {
    const { deps, moved } = fixture();
    const res = purgeOrphanRaws(deps, true);
    assert.equal(res.purged.length, 3);
    assert.equal(moved.length, 0);
  });

  it('un dossier de journaux absent ne fait rien et ne leve pas', () => {
    const { deps } = fixture({
      readLogs: () => {
        throw new Error('ENOENT');
      },
    });
    assert.deepEqual(purgeOrphanRaws(deps).purged, []);
  });

  it('un echec de deplacement ne bloque pas les autres fichiers', () => {
    const { deps } = fixture({
      moveToTrash: (from) => {
        if (from.includes('44276-1')) throw new Error('EXDEV');
      },
    });
    const res = purgeOrphanRaws(deps);
    assert.deepEqual(res.purged.map((p) => p.name).sort(), ['pty-capture-44276-2.raw', 'pty-capture-488-1.raw']);
  });
});
