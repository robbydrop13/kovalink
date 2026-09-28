import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-tls-'));
process.env['KOVALINK_QUIET'] = '1';

const { coversName } = await import('../src/security/tls.js');

/** Auto-signe, CN et SAN `example-mac.tail0000.ts.net`, expire en 2126. */
const CERT = fileURLToPath(new URL('../../test/fixtures/cert-example-mac.crt', import.meta.url));

describe('coversName', () => {
  it('reconnait le nom pour lequel le certificat a ete emis', () => {
    assert.equal(coversName(CERT, 'example-mac.tail0000.ts.net'), true);
  });

  it("refuse le nom d'une autre machine du meme tailnet", () => {
    // Le cas du changement de Mac : meme tailnet, nom voisin, certificat inutilisable.
    assert.equal(coversName(CERT, 'example-mac-1.tail0000.ts.net'), false);
  });

  it('refuse un certificat absent ou illisible plutot que de lever', () => {
    assert.equal(coversName(join(tmpdir(), 'kovalink-absent.pem'), 'example-mac.tail0000.ts.net'), false);
  });
});
