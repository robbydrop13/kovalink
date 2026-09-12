// L'empreinte incrémentale doit valoir, octet pour octet, celle de `node:crypto`.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { Sha256, digestVerdict, sha256Hex } from '@/utils/sha256';

const ref = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe('Sha256', () => {
  it('vecteurs connus', () => {
    assert.equal(sha256Hex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(
      sha256Hex(new TextEncoder().encode('abc')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('toutes les longueurs autour des blocs de 64 octets', () => {
    for (let n = 0; n <= 200; n++) {
      const data = randomBytes(n);
      assert.equal(sha256Hex(new Uint8Array(data)), ref(data), `longueur ${n}`);
    }
  });

  it('même empreinte par tranches irrégulières que d’un seul tenant', () => {
    const data = new Uint8Array(randomBytes(300_000));
    const h = new Sha256();
    let at = 0;
    const cuts = [1, 63, 64, 65, 1000, 4096, 77_777, 100_000];
    for (const cut of cuts) {
      h.update(data.subarray(at, at + cut));
      at += cut;
    }
    h.update(data.subarray(at));
    assert.equal(h.digest(), ref(data));
  });

  it('refuse toute écriture après digest', () => {
    const h = new Sha256().update(new Uint8Array([1]));
    h.digest();
    assert.throws(() => h.update(new Uint8Array([2])));
    assert.throws(() => h.digest());
  });
});

describe('digestVerdict (CA-101, Mac vers iPhone)', () => {
  const h = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  it('ok quand les deux côtés disent la même chose, quelle que soit la casse', () => {
    assert.equal(digestVerdict(h, h), 'ok');
    assert.equal(digestVerdict(h.toUpperCase(), h), 'ok');
  });
  it('mismatch sur un seul caractère différent', () => {
    assert.equal(digestVerdict(h.replace('e3b0', 'e3b1'), h), 'mismatch');
  });
  it('unverified quand le Mac n a rien envoyé ou une valeur malformée : jamais un faux succès', () => {
    assert.equal(digestVerdict(null, h), 'unverified');
    assert.equal(digestVerdict(undefined, h), 'unverified');
    assert.equal(digestVerdict('', h), 'unverified');
    assert.equal(digestVerdict('abc', h), 'unverified');
  });
});
