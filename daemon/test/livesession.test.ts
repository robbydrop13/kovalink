import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { liveSessionOf, parseSessionFile } from '../src/kova/liveSession.js';

describe('repli de detection de session Claude', () => {
  it('lit le fichier de session du processus enfant, nom /rename seulement', () => {
    const body = JSON.stringify({ pid: 28232, sessionId: '1ff57736-f625-4b38-8145-000000000001', startedAt: 1, name: 'dollary-dev', nameSource: 'user' });
    assert.deepEqual(parseSessionFile(body, 28232), { id: '1ff57736-f625-4b38-8145-000000000001', name: 'dollary-dev' });
    const derived = JSON.stringify({ pid: 1, sessionId: 'abc', name: 'tmp-5f', nameSource: 'derived' });
    assert.deepEqual(parseSessionFile(derived, 1), { id: 'abc', name: null });
  });

  it('refuse un pid qui ne correspond pas, un identifiant douteux, un JSON casse', () => {
    assert.equal(parseSessionFile(JSON.stringify({ pid: 2, sessionId: 'abc' }), 1), null);
    assert.equal(parseSessionFile(JSON.stringify({ pid: 1, sessionId: 'a b/../x' }), 1), null);
    assert.equal(parseSessionFile('{', 1), null);
  });

  it('trouve la session parmi les enfants, ignore les pids sans fichier', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kl-sessions-'));
    writeFileSync(join(dir, '4242.json'), JSON.stringify({ pid: 4242, sessionId: 'sess-4242', startedAt: 1 }));
    assert.deepEqual(liveSessionOf([1, 4242], dir), { id: 'sess-4242', name: null });
    assert.equal(liveSessionOf([7], dir), null);
    assert.equal(liveSessionOf([], dir), null);
  });
});
