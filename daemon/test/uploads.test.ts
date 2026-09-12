import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { UPLOAD_CHUNK_BYTES } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-up-'));
process.env['KOVALINK_QUIET'] = '1';

const { DEFAULT_CONFIG } = await import('../src/config.js');
const { UploadStore, sha256OfFile } = await import('../src/fs/uploads.js');
const { FsError } = await import('../src/fs/resolve.js');

const cfg = (): typeof DEFAULT_CONFIG => DEFAULT_CONFIG;

function dest(): string {
  return mkdtempSync(join(tmpdir(), 'kovalink-dest-'));
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Un morceau arrive TOUJOURS en flux, jamais en Buffer : c'est le contrat de la route. */
function stream(buf: Buffer, pieces = 3): Readable {
  const size = Math.max(Math.ceil(buf.length / pieces), 1);
  const parts: Buffer[] = [];
  for (let i = 0; i < buf.length; i += size) parts.push(buf.subarray(i, i + size));
  return Readable.from(parts.length > 0 ? parts : [Buffer.alloc(0)]);
}

async function codeOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof FsError ? e.code : `NON_FS:${(e as Error).message}`;
  }
}

describe('upload : le chemin nominal', () => {
  it('transfere un fichier en trois morceaux et verifie l empreinte', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const data = randomBytes(3000);

    const init = store.init({
      destDir: dir,
      filename: 'photo.jpg',
      size: data.length,
      sha256: sha256(data),
    });
    assert.equal(init.receivedBytes, 0);
    assert.equal(init.chunkBytes, UPLOAD_CHUNK_BYTES);
    assert.equal(init.plannedName, 'photo.jpg');

    let offset = 0;
    for (const slice of [data.subarray(0, 1000), data.subarray(1000, 2500), data.subarray(2500)]) {
      const res = await store.writeChunk(init.uploadId, offset, stream(slice));
      offset += slice.length;
      assert.equal(res.receivedBytes, offset);
    }

    const done = await store.complete(init.uploadId);
    assert.equal(done.name, 'photo.jpg');
    assert.equal(done.renamed, false);
    assert.equal(done.sha256, sha256(data));
    assert.deepEqual(readFileSync(done.path), data);
  });

  it('accepte un fichier de 0 octet', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const init = store.init({ destDir: dir, filename: 'vide.txt', size: 0 });
    const done = await store.complete(init.uploadId);
    assert.equal(done.size, 0);
    assert.equal(existsSync(done.path), true);
  });

  it('ne laisse aucun `.part` derriere lui apres publication', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const data = randomBytes(64);
    const init = store.init({ destDir: dir, filename: 'a.bin', size: data.length });
    await store.writeChunk(init.uploadId, 0, stream(data));
    await store.complete(init.uploadId);
    assert.deepEqual(readdirSync(dir), ['a.bin']);
  });
});

describe('reprise apres coupure', () => {
  it('retrouve le transfert et rend les octets DEJA recus', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const data = randomBytes(5000);
    const digest = sha256(data);

    const first = store.init({ destDir: dir, filename: 'gros.bin', size: 5000, sha256: digest });
    await store.writeChunk(first.uploadId, 0, stream(data.subarray(0, 2500)));

    // Coupure reseau : l'app relance un `init` identique. Elle ne doit PAS repartir de 0.
    const again = store.init({ destDir: dir, filename: 'gros.bin', size: 5000, sha256: digest });
    assert.equal(again.uploadId, first.uploadId);
    assert.equal(again.receivedBytes, 2500);

    await store.writeChunk(again.uploadId, 2500, stream(data.subarray(2500)));
    const done = await store.complete(again.uploadId);
    assert.deepEqual(readFileSync(done.path), data);
  });

  it('survit a un redemarrage du daemon grace au manifeste persiste', async () => {
    const dir = dest();
    const data = randomBytes(4000);
    const digest = sha256(data);

    const before = new UploadStore(cfg);
    const init = before.init({ destDir: dir, filename: 'reprise.bin', size: 4000, sha256: digest });
    await before.writeChunk(init.uploadId, 0, stream(data.subarray(0, 1500)));

    // Nouvelle instance : rien en memoire, tout sur le disque.
    const after = new UploadStore(cfg);
    assert.equal(after.status(init.uploadId).receivedBytes, 1500);
    await after.writeChunk(init.uploadId, 1500, stream(data.subarray(1500)));
    const done = await after.complete(init.uploadId);
    assert.deepEqual(readFileSync(done.path), data);
  });

  it('repond OFFSET_MISMATCH avec le chiffre reel, pour que le client se RECALE', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const data = randomBytes(3000);
    const init = store.init({ destDir: dir, filename: 'recale.bin', size: 3000 });
    await store.writeChunk(init.uploadId, 0, stream(data.subarray(0, 1000)));

    try {
      await store.writeChunk(init.uploadId, 2000, stream(data.subarray(2000)));
      assert.fail('aurait du etre refuse');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.equal(e.code, 'OFFSET_MISMATCH');
      // Sans ce chiffre, le client n'a d'autre choix que de tout recommencer, ce qui
      // fait exploser le rapport « octets envoyes / taille » du critere CA-107.
      assert.equal((e as unknown as { receivedBytes?: number }).receivedBytes, 1000);
    }

    // Le recalage aboutit.
    await store.writeChunk(init.uploadId, 1000, stream(data.subarray(1000)));
    const done = await store.complete(init.uploadId);
    assert.deepEqual(readFileSync(done.path), data);
  });

  it('refuse un morceau qui depasse la taille annoncee', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const init = store.init({ destDir: dir, filename: 'trop.bin', size: 100 });
    const code = await codeOf(() => store.writeChunk(init.uploadId, 0, stream(randomBytes(200))));
    assert.equal(code, 'BAD_REQUEST');
  });

  it('refuse de publier un transfert incomplet, en disant ou reprendre', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const data = randomBytes(1000);
    const init = store.init({ destDir: dir, filename: 'partiel.bin', size: 1000 });
    await store.writeChunk(init.uploadId, 0, stream(data.subarray(0, 400)));
    try {
      await store.complete(init.uploadId);
      assert.fail('aurait du echouer');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.match(e.message, /400 octets recus sur 1000/);
    }
  });
});

describe('integrite et collision', () => {
  it('refuse la publication quand l empreinte diverge, et ne publie RIEN', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const data = randomBytes(500);
    const init = store.init({
      destDir: dir,
      filename: 'faux.bin',
      size: 500,
      sha256: sha256(randomBytes(500)),
    });
    await store.writeChunk(init.uploadId, 0, stream(data));
    const code = await codeOf(() => store.complete(init.uploadId));
    assert.equal(code, 'CHECKSUM_MISMATCH');
    assert.equal(existsSync(join(dir, 'faux.bin')), false);
  });

  it('suffixe en nom-2.ext et laisse l original intact', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    writeFileSync(join(dir, 'capture.png'), 'original');
    const data = randomBytes(128);

    const init = store.init({ destDir: dir, filename: 'capture.png', size: 128 });
    await store.writeChunk(init.uploadId, 0, stream(data));
    const done = await store.complete(init.uploadId);

    assert.equal(done.name, 'capture-2.png');
    assert.equal(done.renamed, true);
    assert.equal(readFileSync(join(dir, 'capture.png'), 'utf8'), 'original');
    assert.deepEqual(readFileSync(join(dir, 'capture-2.png')), data);
  });

  it('calcule l empreinte en flux, sans charger le fichier', async () => {
    const dir = dest();
    const path = join(dir, 'gros.bin');
    const data = randomBytes(3 * 1024 * 1024);
    writeFileSync(path, data);
    assert.equal(await sha256OfFile(path), sha256(data));
  });
});

describe('annulation et liste noire', () => {
  it('annule sans laisser de fichier partiel dans la destination', async () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    const init = store.init({ destDir: dir, filename: 'annule.bin', size: 4000 });
    await store.writeChunk(init.uploadId, 0, stream(randomBytes(1500)));
    assert.equal(readdirSync(dir).length, 1, 'le .part doit exister avant annulation');

    store.abort(init.uploadId);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(await codeOf(async () => store.status(init.uploadId)), 'UPLOAD_NOT_FOUND');
  });

  it('refuse AVANT tout transfert un dossier de la liste noire', () => {
    const store = new UploadStore(cfg);
    try {
      store.init({ destDir: join(homedir(), '.ssh'), filename: 'cle.pub', size: 10 });
      assert.fail('aurait du etre refuse');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.equal(e.code, 'PATH_DENIED');
      assert.equal(e.rule, 'path:~/.ssh');
    }
  });

  it('refuse un nom qui tente de sortir du dossier de destination', () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    assert.equal(
      codeOfSync(() => store.init({ destDir: dir, filename: '../evasion.txt', size: 1 })),
      'BAD_REQUEST',
    );
  });

  it('refuse un identifiant de transfert qui n a pas la forme d un UUID', () => {
    const store = new UploadStore(cfg);
    assert.equal(codeOfSync(() => store.status('../../etc/passwd')), 'BAD_REQUEST');
  });

  it('refuse une taille absente ou negative', () => {
    const store = new UploadStore(cfg);
    const dir = dest();
    assert.equal(codeOfSync(() => store.init({ destDir: dir, filename: 'a.bin' })), 'BAD_REQUEST');
    assert.equal(
      codeOfSync(() => store.init({ destDir: dir, filename: 'a.bin', size: -1 })),
      'BAD_REQUEST',
    );
  });
});

function codeOfSync(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof FsError ? e.code : `NON_FS:${(e as Error).message}`;
  }
}
