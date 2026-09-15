// Pieces jointes du chat (docs/15) : le dossier de session est cree par le daemon, en
// 0700, sous la seule racine du protocole, et une piece televersee s'y lit comme
// n'importe quel fichier du Mac.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, describe, it } from 'node:test';
import {
  ATTACHMENTS_ROOT,
  attachmentName,
  attachmentsDir,
  attachmentsSessionOf,
  isAttachmentPath,
} from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-att-'));
process.env['KOVALINK_QUIET'] = '1';

const { DEFAULT_CONFIG } = await import('../src/config.js');
const { ensureAttachmentsDir } = await import('../src/fs/attachments.js');
const { UploadStore } = await import('../src/fs/uploads.js');
const { FsError, resolveFileForRead } = await import('../src/fs/resolve.js');
const { checkRead, checkWrite } = await import('../src/security/denylist.js');

const cfg = (): typeof DEFAULT_CONFIG => DEFAULT_CONFIG;

/** Session de test unique : le dossier est reel, sous `/tmp`, et retire a la fin. */
const SESSION = `test-${randomBytes(4).toString('hex')}`;
const DIR = attachmentsDir(SESSION);

after(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('protocole : forme des chemins de pieces jointes', () => {
  it('abrege la session a 8 caracteres surs, sous la racine', () => {
    assert.equal(
      attachmentsDir('2b1f5c3e-7a9d-4e6b-9c1a-0f8d7e6c5b4a'),
      `${ATTACHMENTS_ROOT}/2b1f5c3e`,
    );
    assert.equal(attachmentsDir('../../etc'), `${ATTACHMENTS_ROOT}/etc`);
    assert.equal(attachmentsDir(''), `${ATTACHMENTS_ROOT}/session`);
  });

  it('ne reconnait que <racine>/<session>, rien de plus profond ni de plus haut', () => {
    assert.equal(attachmentsSessionOf(`${ATTACHMENTS_ROOT}/2b1f5c3e`), '2b1f5c3e');
    assert.equal(attachmentsSessionOf(ATTACHMENTS_ROOT), null);
    assert.equal(attachmentsSessionOf(`${ATTACHMENTS_ROOT}/`), null);
    assert.equal(attachmentsSessionOf(`${ATTACHMENTS_ROOT}/a/b`), null);
    assert.equal(attachmentsSessionOf(`${ATTACHMENTS_ROOT}/.ssh`), null);
    assert.equal(attachmentsSessionOf('/tmp/kovalink/attachmentsX/a'), null);
    assert.equal(attachmentsSessionOf('/Users/alice/attachments/a'), null);
  });

  it('horodate le nom et ne garde que le dernier segment', () => {
    const at = new Date(2026, 8, 11, 15, 30, 12);
    assert.equal(attachmentName('IMG_4231.jpg', at), '20260911-153012-IMG_4231.jpg');
    assert.equal(attachmentName('/var/mobile/x/photo.HEIC', at), '20260911-153012-photo.HEIC');
    assert.equal(attachmentName('   ', at), '20260911-153012-piece');
  });

  it('reconnait une ligne de chemin de piece, et rien d autre', () => {
    assert.equal(isAttachmentPath(`${ATTACHMENTS_ROOT}/2b1f5c3e/20260911-153012-a.jpg`), true);
    assert.equal(isAttachmentPath(`${ATTACHMENTS_ROOT}/`), false);
    assert.equal(isAttachmentPath('voici la maquette'), false);
    assert.equal(isAttachmentPath('/tmp/kova-paste-1.png'), false);
  });
});

describe('daemon : creation du dossier de session', () => {
  it('cree la racine et le dossier de session en 0700, et rend le chemin', () => {
    const out = ensureAttachmentsDir(DIR);
    assert.equal(out, DIR);
    for (const level of [ATTACHMENTS_ROOT, DIR]) {
      const st = statSync(level);
      assert.equal(st.isDirectory(), true);
      assert.equal(st.mode & 0o777, 0o700, `${level} doit etre en 0700`);
    }
  });

  it('est idempotent : un second appel ne change rien', () => {
    assert.equal(ensureAttachmentsDir(DIR), DIR);
  });

  it('ne cree RIEN hors de la forme <racine>/<session>', () => {
    const deeper = `${DIR}/plus/profond`;
    assert.equal(ensureAttachmentsDir(deeper), null);
    assert.equal(existsSync(deeper), false);
    assert.equal(ensureAttachmentsDir(ATTACHMENTS_ROOT), null);
    const elsewhere = join(tmpdir(), `kovalink-hors-racine-${SESSION}`);
    assert.equal(ensureAttachmentsDir(elsewhere), null);
    assert.equal(existsSync(elsewhere), false);
  });

  it('une traversee est resolue AVANT la comparaison : elle n est pas une session', () => {
    const short = DIR.split('/').pop() as string;
    assert.equal(ensureAttachmentsDir(`${DIR}/../../../etc`), null);
    assert.equal(ensureAttachmentsDir(`${ATTACHMENTS_ROOT}/../attachments/${short}`), DIR);
  });

  it('refuse un chemin relatif comme le reste du bloc C', () => {
    assert.throws(() => ensureAttachmentsDir('kovalink/attachments/x'), (e: unknown) => {
      return e instanceof FsError && e.code === 'BAD_REQUEST';
    });
  });

  it('la liste noire laisse ecrire et lire sous la racine', () => {
    assert.equal(checkWrite(join(DIR, 'sonde.jpg'), cfg()).allowed, true);
    assert.equal(checkRead(join(DIR, 'sonde.jpg'), cfg()).allowed, true);
  });
});

describe('daemon : une piece televersee dans le dossier de session', () => {
  it('passe par l upload en flux, verifie l empreinte, et se lit par fs/read', async () => {
    const store = new UploadStore(cfg);
    const data = randomBytes(5000);
    const filename = attachmentName('IMG_0001.jpg', new Date(2026, 8, 11, 15, 30, 12));

    // `init` cree le dossier lui meme : l'app n'a rien a preparer.
    const init = store.init({
      destDir: DIR,
      filename,
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
    assert.equal(init.receivedBytes, 0);

    let offset = 0;
    for (const piece of [data.subarray(0, 2000), data.subarray(2000)]) {
      const res = await store.writeChunk(init.uploadId, offset, Readable.from([piece]));
      offset = res.receivedBytes;
    }
    const done = await store.complete(init.uploadId);
    assert.equal(done.name, filename);
    assert.equal(done.sha256, createHash('sha256').update(data).digest('hex'));

    // Le chemin que l'app compose (racine `/tmp`) et celui que le daemon rend (chemin
    // reel) designent le meme fichier, lisible par `resolveFileForRead` comme tout autre.
    const composed = `${DIR}/${done.name}`;
    const viaComposed = resolveFileForRead(composed, cfg());
    const viaReal = resolveFileForRead(done.path, cfg());
    assert.equal(viaComposed.realPath, viaReal.realPath);
    assert.equal(readFileSync(viaComposed.realPath).equals(data), true);
    assert.equal(statSync(viaComposed.realPath).mode & 0o777, 0o644);
  });
});
