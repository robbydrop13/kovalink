import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-sec-'));
process.env['KOVALINK_QUIET'] = '1';

const { isTailscale4, isTailscale6, resolveBinds } = await import('../src/security/bind.js');
const { mintToken, signToken, timingSafeEqualStr, verifyBearer } = await import(
  '../src/security/token.js'
);
const { logger, redact } = await import('../src/logger.js');
const { paths } = await import('../src/paths.js');

const SRC_DIR = resolve(fileURLToPath(new URL('../../src', import.meta.url)));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('bind exclusif', () => {
  it('reconnait la plage CGNAT de Tailscale', () => {
    assert.equal(isTailscale4('100.64.0.1'), true);
    assert.equal(isTailscale4('100.127.255.254'), true);
    assert.equal(isTailscale4('100.63.0.1'), false);
    assert.equal(isTailscale4('100.128.0.1'), false);
    assert.equal(isTailscale4('192.168.1.10'), false);
    assert.equal(isTailscale6('fd7a:115c:a1e0::1'), true);
    assert.equal(isTailscale6('fe80::1'), false);
  });

  it('n ecoute que sur la loopback et Tailscale, jamais le LAN', () => {
    const binds = resolveBinds({
      lo0: [
        { address: '127.0.0.1', family: 'IPv4', internal: true },
        { address: '::1', family: 'IPv6', internal: true },
      ],
      en0: [{ address: '192.168.1.42', family: 'IPv4', internal: false }],
      utun4: [
        { address: '100.101.102.103', family: 'IPv4', internal: false },
        { address: 'fd7a:115c:a1e0::abcd', family: 'IPv6', internal: false },
      ],
    });
    assert.deepEqual(binds, ['127.0.0.1', '::1', '100.101.102.103', 'fd7a:115c:a1e0::abcd']);
    assert.equal(binds.includes('192.168.1.42'), false);
  });

  it('aucune adresse d ecoute universelle nulle part dans le code', () => {
    for (const file of sourceFiles(SRC_DIR)) {
      const src = readFileSync(file, 'utf8');
      assert.equal(src.includes("'0.0.0.0'"), false, `0.0.0.0 trouve dans ${file}`);
      assert.equal(/host:\s*'::'/.test(src), false, `bind :: trouve dans ${file}`);
    }
  });
});

describe('jeton', () => {
  const master = randomBytes(32);

  it('accepte un jeton bien signe', () => {
    const { deviceId, bearer } = mintToken(master);
    const v = verifyBearer(`Bearer ${bearer}`, master, {});
    assert.equal(v.ok, true);
    if (v.ok) assert.equal(v.deviceId, deviceId);
  });

  it('refuse une signature falsifiee', () => {
    const { deviceId, exp } = mintToken(master);
    const forged = `${deviceId}.${exp}.${signToken(randomBytes(32), deviceId, exp)}`;
    assert.deepEqual(verifyBearer(forged, master, {}), { ok: false, code: 'UNAUTHORIZED' });
  });

  it('refuse un jeton expire', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const bearer = `abc.${past}.${signToken(master, 'abc', past)}`;
    assert.deepEqual(verifyBearer(bearer, master, {}), { ok: false, code: 'TOKEN_EXPIRED' });
  });

  it('refuse un appareil revoque', () => {
    const { deviceId, bearer } = mintToken(master);
    const devices = {
      [deviceId]: { deviceId, name: 'x', pairedAt: '', exp: 0, revoked: true },
    };
    assert.deepEqual(verifyBearer(bearer, master, devices), { ok: false, code: 'UNAUTHORIZED' });
  });

  it('refuse une forme invalide sans lever', () => {
    for (const bad of [undefined, '', 'Bearer', 'a.b', 'a.b.c.d', 'a.pasunnombre.c']) {
      const v = verifyBearer(bad as string | undefined, master, {});
      assert.equal(v.ok, false);
    }
  });

  it('compare a temps constant sans lever sur des longueurs differentes', () => {
    assert.equal(timingSafeEqualStr('abc', 'abcd'), false);
    assert.equal(timingSafeEqualStr('abc', 'abc'), true);
  });
});

describe('redaction des journaux', () => {
  it('ne laisse aucun jeton dans le fichier de log', () => {
    const master = randomBytes(32);
    const { bearer } = mintToken(master);
    logger.info('cycle de connexion', {
      authorization: `Bearer ${bearer}`,
      token: bearer,
      nested: { token: bearer },
      message: `Authorization: Bearer ${bearer}`,
    });
    const contents = readFileSync(paths.logFile(), 'utf8');
    assert.equal(contents.includes(bearer), false, 'le jeton ne doit jamais apparaitre');
    assert.equal(/Bearer\s+[A-Za-z0-9._~+/=-]+/.test(contents.replace(/\[REDACTED\]/g, '')), false);
  });

  it('redige aussi une charge utile d appairage collee dans un message', () => {
    const out = redact({ msg: 'kovalink://pair#eyJ2IjoxLCJjb2RlIjoic2VjcmV0In0' }) as {
      msg: string;
    };
    assert.equal(out.msg.includes('eyJ2'), false);
  });

  it('redige le jeton push Expo', () => {
    const out = redact({ expoPushToken: 'ExponentPushToken[abcdef]' }) as Record<string, string>;
    assert.equal(out['expoPushToken'], '[REDACTED]');
  });
});
