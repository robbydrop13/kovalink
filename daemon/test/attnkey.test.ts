// La cle de clic d'`attn` : le daemon la lit a chaque geste et la passe par
// l'environnement (`ATTN_CLICK_KEY`, `ATTN_CLICK_FROM=kovalink`), jamais en argument, et
// jamais pour une lecture. Sans cle, l'environnement reste celui du daemon (attn reconnait
// encore le daemon par son parent, en transition). Un faux `attn` dit ce qu'il a recu.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kovalink-attnkey-'));
const keyFile = join(dir, 'key');
const KEY = 'a'.repeat(64);
const fake = join(dir, 'attn');
writeFileSync(
  fake,
  `#!/bin/sh\nif [ "$ATTN_CLICK_KEY" = "${KEY}" ]; then k=ok; elif [ -n "$ATTN_CLICK_KEY" ]; then k=other; else k=none; fi\n` +
    `echo "from=$ATTN_CLICK_FROM key=$k argv=$*"\n`,
);
chmodSync(fake, 0o755);

const { attnEnv, clickKeyPath, execAttn } = await import('../src/attention.js');

describe('cle de clic passee a attn', () => {
  const keep: Record<string, string | undefined> = {};
  before(() => {
    for (const k of ['KOVALINK_ATTN', 'KOVALINK_CLICK_KEY_FILE', 'ATTN_CLICK_KEY', 'ATTN_CLICK_FROM']) keep[k] = process.env[k];
    process.env['KOVALINK_ATTN'] = fake;
    process.env['KOVALINK_CLICK_KEY_FILE'] = keyFile;
    delete process.env['ATTN_CLICK_KEY'];
    delete process.env['ATTN_CLICK_FROM'];
  });
  after(() => {
    for (const [k, v] of Object.entries(keep)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('le chemin par defaut est celui que cree attn click-key', () => {
    const was = process.env['KOVALINK_CLICK_KEY_FILE'];
    delete process.env['KOVALINK_CLICK_KEY_FILE'];
    assert.match(clickKeyPath(), /\/\.config\/attn\/click\.key$/);
    process.env['KOVALINK_CLICK_KEY_FILE'] = was;
  });

  it('un Envoyer du telephone porte la cle, par l environnement seulement', async () => {
    writeFileSync(keyFile, `${KEY}\n`, { mode: 0o600 });
    const res = await execAttn(['act', 'a-0d0db1', 'Envoyer']);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout.trim(), 'from=kovalink key=ok argv=act a-0d0db1 Envoyer');
    assert.ok(!res.stdout.includes(KEY), 'never in argv');
  });

  it('une fermeture aussi, une lecture jamais', async () => {
    writeFileSync(keyFile, `${KEY}\n`, { mode: 0o600 });
    const close = await execAttn(['close', 'a-0d0db1', '--note', 'Fait (KovaLink)', '--by', 'robin']);
    assert.match(close.stdout, /^from=kovalink key=ok /);
    const list = await execAttn(['list', '--open', '--json']);
    assert.match(list.stdout, /^from= key=none /);
    assert.equal(attnEnv(['list', '--open', '--json']), undefined);
  });

  it('sans cle lisible ou avec une cle vide : rien n est ajoute', async () => {
    rmSync(keyFile, { force: true });
    assert.equal(attnEnv(['act', 'a-0d0db1', 'Envoyer']), undefined);
    assert.match((await execAttn(['act', 'a-0d0db1', 'Envoyer'])).stdout, /^from= key=none /);
    writeFileSync(keyFile, '\n');
    assert.equal(attnEnv(['act', 'a-0d0db1', 'Envoyer']), undefined);
  });

  it('une cle changee vaut sans relancer le daemon', async () => {
    writeFileSync(keyFile, `${'b'.repeat(64)}\n`);
    assert.match((await execAttn(['act', 'a-0d0db1', 'Envoyer'])).stdout, /key=other/);
    writeFileSync(keyFile, `${KEY}\n`);
    assert.match((await execAttn(['act', 'a-0d0db1', 'Envoyer'])).stdout, /key=ok/);
  });
});
