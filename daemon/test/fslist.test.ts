import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FS_PAGE_SIZE } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-list-'));
process.env['KOVALINK_QUIET'] = '1';

const { DEFAULT_CONFIG } = await import('../src/config.js');
const { listDirectory, parentOf } = await import('../src/fs/list.js');
const { FsError } = await import('../src/fs/resolve.js');

const cfg = DEFAULT_CONFIG;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kovalink-dir-'));
  mkdirSync(join(dir, 'zeta'));
  mkdirSync(join(dir, 'alpha'));
  writeFileSync(join(dir, 'petit.txt'), 'a');
  writeFileSync(join(dir, 'gros.bin'), Buffer.alloc(4096));
  writeFileSync(join(dir, '.cache'), 'secret');
  writeFileSync(join(dir, 'image.PNG'), Buffer.alloc(10));
  symlinkSync('/etc/hosts', join(dir, 'lien'));
  // Dates distinctes pour rendre le tri par date verifiable.
  utimesSync(join(dir, 'petit.txt'), new Date(1000), new Date(1000));
  utimesSync(join(dir, 'gros.bin'), new Date(9_000_000), new Date(9_000_000));
  return dir;
}

describe('listing d un dossier', () => {
  it('masque les fichiers caches par defaut et les montre sur demande', () => {
    const dir = fixture();
    const hidden = listDirectory(cfg, { path: dir });
    assert.equal(hidden.entries.some((e) => e.name === '.cache'), false);
    assert.equal(hidden.showHidden, false);

    const shown = listDirectory(cfg, { path: dir, showHidden: true });
    assert.equal(shown.entries.some((e) => e.name === '.cache'), true);
    assert.equal(shown.entries.find((e) => e.name === '.cache')?.hidden, true);
  });

  it('place les dossiers en tete quel que soit le tri', () => {
    const dir = fixture();
    for (const sort of ['name', 'size', 'mtime'] as const) {
      const res = listDirectory(cfg, { path: dir, sort });
      const firstFile = res.entries.findIndex((e) => e.kind !== 'dir');
      const lastDir = res.entries.map((e) => e.kind).lastIndexOf('dir');
      assert.ok(lastDir < firstFile, `tri ${sort} : un dossier apparait apres un fichier`);
    }
  });

  it('trie par nom, par taille et par date, dans les deux sens', () => {
    const dir = fixture();
    const names = listDirectory(cfg, { path: dir, sort: 'name' }).entries.map((e) => e.name);
    assert.deepEqual(names.slice(0, 2), ['alpha', 'zeta']);

    const bySize = listDirectory(cfg, { path: dir, sort: 'size', dir: 'desc' }).entries.filter(
      (e) => e.kind === 'file',
    );
    assert.equal(bySize[0]?.name, 'gros.bin');

    // Seules deux dates sont posees explicitement : on verifie leur ORDRE RELATIF,
    // pas une position absolue qui dependrait de l'heure de creation des autres.
    const desc = listDirectory(cfg, { path: dir, sort: 'mtime', dir: 'desc' }).entries.map(
      (e) => e.name,
    );
    assert.ok(desc.indexOf('gros.bin') < desc.indexOf('petit.txt'));
    const asc = listDirectory(cfg, { path: dir, sort: 'mtime', dir: 'asc' }).entries.map(
      (e) => e.name,
    );
    assert.ok(asc.indexOf('petit.txt') < asc.indexOf('gros.bin'));
  });

  it('rend un lien symbolique COMME un lien, avec sa cible, sans le suivre', () => {
    const dir = fixture();
    const entry = listDirectory(cfg, { path: dir }).entries.find((e) => e.name === 'lien');
    assert.equal(entry?.kind, 'symlink');
    assert.equal(entry?.linkTarget, '/etc/hosts');
  });

  it('devine le type MIME sur une extension en majuscules', () => {
    const dir = fixture();
    const entry = listDirectory(cfg, { path: dir }).entries.find((e) => e.name === 'image.PNG');
    assert.equal(entry?.mime, 'image/png');
    assert.equal(entry?.ext, '.png');
  });

  it('donne une taille nulle aux dossiers : pas de calcul recursif', () => {
    const dir = fixture();
    const entry = listDirectory(cfg, { path: dir }).entries.find((e) => e.name === 'alpha');
    assert.equal(entry?.size, null);
  });
});

describe('pagination par 500', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kovalink-page-'));
  for (let i = 0; i < 1234; i++) {
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.txt`), 'x');
  }

  it('rend au plus une page, et annonce le total reel', () => {
    const first = listDirectory(cfg, { path: dir });
    assert.equal(first.entries.length, FS_PAGE_SIZE);
    assert.equal(first.total, 1234);
    assert.equal(first.offset, 0);
    assert.equal(first.hasMore, true);
  });

  it('avance par offset sans jamais repeter ni sauter une entree', () => {
    const seen: string[] = [];
    let offset = 0;
    for (;;) {
      const page = listDirectory(cfg, { path: dir, offset });
      seen.push(...page.entries.map((e) => e.name));
      if (!page.hasMore) break;
      offset += page.entries.length;
      assert.ok(offset <= 1234, 'la pagination ne se termine pas');
    }
    assert.equal(seen.length, 1234);
    assert.equal(new Set(seen).size, 1234);
  });

  it('plafonne une limite abusive a la taille de page', () => {
    const page = listDirectory(cfg, { path: dir, limit: 100_000 });
    assert.equal(page.entries.length, FS_PAGE_SIZE);
    assert.equal(page.limit, FS_PAGE_SIZE);
  });

  it('rend la derniere page vide et hasMore faux au dela du total', () => {
    const page = listDirectory(cfg, { path: dir, offset: 5000 });
    assert.equal(page.entries.length, 0);
    assert.equal(page.hasMore, false);
    assert.equal(page.total, 1234);
  });

  it('ignore une limite et un offset non numeriques plutot que de rendre NaN', () => {
    const page = listDirectory(cfg, { path: dir, offset: 'abc' as never, limit: 'x' as never });
    assert.equal(page.offset, 0);
    assert.equal(page.limit, FS_PAGE_SIZE);
  });
});

describe('erreurs de navigation', () => {
  it('nomme la cause d un dossier inexistant', () => {
    try {
      listDirectory(cfg, { path: '/tmp/absent-99999' });
      assert.fail('aurait du echouer');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.equal(e.code, 'PATH_NOT_FOUND');
    }
  });

  it('refuse un fichier la ou un dossier est attendu', () => {
    const dir = fixture();
    try {
      listDirectory(cfg, { path: join(dir, 'petit.txt') });
      assert.fail('aurait du echouer');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.equal(e.code, 'NOT_A_DIRECTORY');
    }
  });

  it('remonte jusqu a la racine, qui n a pas de parent', () => {
    assert.equal(parentOf('/Users/robin/dev'), '/Users/robin');
    assert.equal(parentOf('/Users'), '/');
    assert.equal(parentOf('/'), null);
  });
});
