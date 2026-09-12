import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { FS_READ_DIGEST_HEADER, FS_READ_QUERY, ROUTES } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-fsread-'));
process.env['KOVALINK_QUIET'] = '1';

const { registerFsRoutes } = await import('../src/server/fsRoutes.js');
const { UploadStore } = await import('../src/fs/uploads.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');
import type { Services } from '../src/server/services.js';

const dir = mkdtempSync(join(tmpdir(), 'kovalink-fsread-files-'));
const file = join(dir, 'rapport.bin');
const content = Buffer.alloc(300_000, 7);
writeFileSync(file, content);
const expected = createHash('sha256').update(content).digest('hex');

async function server() {
  const app = Fastify();
  const cfg = () => DEFAULT_CONFIG;
  const services = { cfg, rate: { allow: () => true }, panes: { all: () => [] } } as unknown as Services;
  registerFsRoutes(app, services, new UploadStore(cfg));
  await app.ready();
  return app;
}

const url = (digest: boolean) => {
  const q = new URLSearchParams();
  q.set(FS_READ_QUERY.path, file);
  if (digest) q.set(FS_READ_QUERY.digest, 'true');
  return `${ROUTES.fsRead}?${q.toString()}`;
};

describe('fs/read?digest=true, sens Mac vers iPhone (CA-101)', () => {
  it('GET : l en-tete porte l empreinte du fichier ENTIER, le corps est le fichier', async () => {
    const app = await server();
    const res = await app.inject({ method: 'GET', url: url(true) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers[FS_READ_DIGEST_HEADER], expected);
    assert.equal(res.rawPayload.length, content.length);
    await app.close();
  });

  it('HEAD : memes en-tetes (empreinte, taille), aucun corps : c est ce que l app lit avant de telecharger', async () => {
    const app = await server();
    const res = await app.inject({ method: 'HEAD', url: url(true) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers[FS_READ_DIGEST_HEADER], expected);
    assert.equal(res.headers['content-length'], String(content.length));
    assert.equal(res.rawPayload.length, 0);
    await app.close();
  });

  it('sans digest=true, aucune empreinte n est calculee ni servie', async () => {
    const app = await server();
    const res = await app.inject({ method: 'GET', url: url(false) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers[FS_READ_DIGEST_HEADER], undefined);
    await app.close();
  });
});
