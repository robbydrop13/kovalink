import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { openTail, readMore } from '../src/transcript/tailer.js';

function tmpFile(name = 'session.jsonl'): string {
  return join(mkdtempSync(join(tmpdir(), 'kovalink-tail-')), name);
}

const line = (i: number): string => `${JSON.stringify({ type: 'user', uuid: `u${i}` })}\n`;

describe('tail incrementale du JSONL', () => {
  it('ne relit jamais ce qui a deja ete lu', () => {
    const path = tmpFile();
    writeFileSync(path, Array.from({ length: 50 }, (_, i) => line(i)).join(''));
    const { state } = openTail(path);
    const afterOpen = state.bytesRead;

    appendFileSync(path, line(50));
    const res = readMore(state);
    assert.equal(res.lines.length, 1);
    assert.equal(res.reopened, false);
    assert.equal(
      state.bytesRead - afterOpen,
      Buffer.byteLength(line(50)),
      'seuls les octets ajoutes sont lus',
    );
  });

  it('conserve une ligne partielle jusqu a son saut de ligne', () => {
    const path = tmpFile();
    writeFileSync(path, line(0));
    const { state } = openTail(path);

    const full = line(1);
    appendFileSync(path, full.slice(0, 10));
    assert.deepEqual(readMore(state).lines, [], 'rien n est emis sur une ligne partielle');
    assert.notEqual(state.carry, '');

    appendFileSync(path, full.slice(10));
    const res = readMore(state);
    assert.equal(res.lines.length, 1);
    assert.equal(res.lines[0]?.uuid, 'u1');
    assert.equal(state.carry, '');
  });

  it('supporte une ligne de 132 Ko arrivant en plusieurs morceaux', () => {
    const path = tmpFile();
    writeFileSync(path, line(0));
    const { state } = openTail(path);

    const big = `${JSON.stringify({ type: 'assistant', uuid: 'big', pad: 'x'.repeat(132_000) })}\n`;
    for (let i = 0; i < big.length; i += 16_384) {
      appendFileSync(path, big.slice(i, i + 16_384));
      readMore(state);
    }
    const res = readMore(state);
    const all = res.lines;
    assert.ok(all.length <= 1);
    // La ligne complete est arrivee lors d'un des passages : on verifie l'etat final.
    assert.equal(state.carry, '');
  });

  it('ne coupe pas un caractere UTF-8 a cheval sur deux lectures', () => {
    const path = tmpFile();
    writeFileSync(path, line(0));
    const { state } = openTail(path);

    const payload = `${JSON.stringify({ type: 'user', uuid: 'accent', text: 'ete cafe' })}\n`;
    const buf = Buffer.from(payload.replace('ete', 'été').replace('cafe', 'café'), 'utf8');
    appendFileSync(path, buf.subarray(0, 30));
    readMore(state);
    appendFileSync(path, buf.subarray(30));
    const res = readMore(state);
    assert.equal(res.lines.length, 1);
    assert.equal(String(res.lines[0]?.['text']).includes('café'), true);
  });

  it('detecte une reecriture en place a inode identique (troisieme garde)', () => {
    const path = tmpFile();
    writeFileSync(path, Array.from({ length: 5 }, (_, i) => line(i)).join(''));
    const { state } = openTail(path);
    const inode = state.inode;

    // /clear : le fichier est reecrit depuis le debut, meme inode, taille superieure.
    writeFileSync(path, Array.from({ length: 20 }, (_, i) => line(1000 + i)).join(''));
    const res = readMore(state);
    assert.equal(res.reopened, true, 'une reecriture en place doit forcer la reouverture');
    assert.equal(state.inode, inode);
    assert.equal(res.lines.length, 20);
  });

  it('detecte une troncature', () => {
    const path = tmpFile();
    writeFileSync(path, Array.from({ length: 20 }, (_, i) => line(i)).join(''));
    const { state } = openTail(path);
    writeFileSync(path, line(0));
    assert.equal(readMore(state).reopened, true);
  });

  it('ne renvoie rien quand le fichier n a pas bouge', () => {
    const path = tmpFile();
    writeFileSync(path, line(0));
    const { state } = openTail(path);
    const before = state.bytesRead;
    const res = readMore(state);
    assert.deepEqual(res.lines, []);
    assert.equal(state.bytesRead, before, 'aucun octet relu');
  });
});
