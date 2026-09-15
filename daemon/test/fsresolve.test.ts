import assert from 'node:assert/strict';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-fs-'));
process.env['KOVALINK_QUIET'] = '1';

const { DEFAULT_CONFIG } = await import('../src/config.js');
const {
  FsError,
  abbreviate,
  normalizeRequestPath,
  openForWrite,
  resolveDirForRead,
  resolveFileForRead,
  resolveForRead,
  resolveForWrite,
  sanitizeFilename,
  uniqueName,
} = await import('../src/fs/resolve.js');

const cfg = DEFAULT_CONFIG;

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `kovalink-${prefix}-`));
}

/** Code d'erreur leve, ou `null`. Sert a verifier la CAUSE, pas seulement l'echec. */
function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof FsError ? e.code : `NON_FS:${(e as Error).message}`;
  }
}

describe('normalisation des chemins', () => {
  it('refuse un chemin relatif plutot que de le resoudre contre le cwd du daemon', () => {
    assert.equal(codeOf(() => normalizeRequestPath('dev/projet')), 'BAD_REQUEST');
    assert.equal(codeOf(() => normalizeRequestPath('../../etc/passwd')), 'BAD_REQUEST');
  });

  it('refuse un chemin vide, un non-chaine et un octet nul', () => {
    assert.equal(codeOf(() => normalizeRequestPath('')), 'BAD_REQUEST');
    assert.equal(codeOf(() => normalizeRequestPath(null)), 'BAD_REQUEST');
    assert.equal(codeOf(() => normalizeRequestPath(42)), 'BAD_REQUEST');
    assert.equal(codeOf(() => normalizeRequestPath('/tmp/a\0b')), 'BAD_REQUEST');
  });

  it('ecrase les `..` AVANT toute comparaison de liste noire', () => {
    // C'est la garantie qui rend la traversee de repertoire impossible : le chemin
    // compare n'est jamais celui qui a ete envoye.
    assert.equal(normalizeRequestPath('/Users/x/dev/../.ssh/id_rsa'), '/Users/x/.ssh/id_rsa');
    assert.equal(normalizeRequestPath('/a/b/../../../../etc/passwd'), '/etc/passwd');
    assert.equal(normalizeRequestPath('/a//b/./c/'), '/a/b/c');
  });
});

describe('resolution en lecture : totale, sauf les secrets du daemon', () => {
  it('lit n importe ou sur le disque, c est le choix de Robin', () => {
    const target = resolveForRead('/etc/hosts', cfg);
    assert.equal(target.stat.isFile(), true);
    assert.equal(resolveDirForRead('/usr', cfg).stat.isDirectory(), true);
  });

  it('refuse le repertoire d etat du daemon', () => {
    const denied = join(homedir(), '.kovalink', 'devices.json');
    assert.equal(codeOf(() => resolveForRead(denied, cfg)), 'PATH_DENIED');
  });

  it('refuse un lien symbolique qui pointe vers un chemin refuse en lecture', () => {
    // Le premier controle passe (le lien est dans /tmp), le second echoue sur la cible
    // reelle. Sans le second controle, un lien suffirait a exfiltrer `devices.json`.
    const dir = tmp('link');
    const link = join(dir, 'raccourci');
    symlinkSync(join(homedir(), '.kovalink'), link);
    assert.equal(codeOf(() => resolveForRead(link, cfg)), 'PATH_DENIED');
  });

  it('dit ENOENT quand le chemin n existe pas, pas une erreur generique', () => {
    assert.equal(codeOf(() => resolveForRead('/tmp/ce-chemin-n-existe-pas-42', cfg)), 'PATH_NOT_FOUND');
  });

  it('distingue un dossier d un fichier', () => {
    const dir = tmp('kinds');
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'x');
    assert.equal(codeOf(() => resolveDirForRead(file, cfg)), 'NOT_A_DIRECTORY');
    assert.equal(codeOf(() => resolveFileForRead(dir, cfg)), 'NOT_A_FILE');
  });

  it('suit un lien vers un fichier ordinaire autorise', () => {
    const dir = tmp('follow');
    const real = join(dir, 'reel.txt');
    writeFileSync(real, 'bonjour');
    const link = join(dir, 'lien.txt');
    symlinkSync(real, link);
    const target = resolveFileForRead(link, cfg);
    assert.equal(readFileSync(target.realPath, 'utf8'), 'bonjour');
  });
});

describe('noms de fichier', () => {
  it('refuse tout separateur de chemin dans un nom', () => {
    assert.equal(codeOf(() => sanitizeFilename('../evasion.txt')), 'BAD_REQUEST');
    assert.equal(codeOf(() => sanitizeFilename('a/b.txt')), 'BAD_REQUEST');
    assert.equal(codeOf(() => sanitizeFilename('/absolu.txt')), 'BAD_REQUEST');
    assert.equal(codeOf(() => sanitizeFilename('.')), 'BAD_REQUEST');
    assert.equal(codeOf(() => sanitizeFilename('..')), 'BAD_REQUEST');
    assert.equal(codeOf(() => sanitizeFilename('')), 'BAD_REQUEST');
    assert.equal(codeOf(() => sanitizeFilename('a\0b')), 'BAD_REQUEST');
    assert.equal(codeOf(() => sanitizeFilename('x'.repeat(300))), 'BAD_REQUEST');
  });

  it('accepte accents, espaces et emoji, qui sont le quotidien de Robin', () => {
    assert.equal(sanitizeFilename('Capture d’écran 2026.png'), 'Capture d’écran 2026.png');
    assert.equal(sanitizeFilename('  reçu.pdf  '), 'reçu.pdf');
  });
});

describe('collision de nom : nom-2.ext, jamais d ecrasement', () => {
  it('suffixe en -2 puis -3, et conserve l extension', () => {
    const dir = tmp('collide');
    assert.deepEqual(uniqueName(dir, 'capture.png'), { name: 'capture.png', renamed: false });
    writeFileSync(join(dir, 'capture.png'), 'a');
    assert.deepEqual(uniqueName(dir, 'capture.png'), { name: 'capture-2.png', renamed: true });
    writeFileSync(join(dir, 'capture-2.png'), 'b');
    assert.deepEqual(uniqueName(dir, 'capture.png'), { name: 'capture-3.png', renamed: true });
  });

  it('gere un nom sans extension et une extension multiple', () => {
    const dir = tmp('collide2');
    writeFileSync(join(dir, 'NOTES'), 'a');
    assert.equal(uniqueName(dir, 'NOTES').name, 'NOTES-2');
    writeFileSync(join(dir, 'archive.tar.gz'), 'a');
    assert.equal(uniqueName(dir, 'archive.tar.gz').name, 'archive.tar-2.gz');
  });
});

describe('resolution en ecriture : la liste noire, et rien de permissif', () => {
  it('refuse un dossier de la liste noire, avec la regle declenchee', () => {
    try {
      resolveForWrite(join(homedir(), '.ssh'), 'authorized_keys', cfg);
      assert.fail('aurait du etre refuse');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.equal(e.code, 'PATH_DENIED');
      assert.equal(e.rule, 'path:~/.ssh');
      // Le message porte la cause reelle, pas un libelle generique.
      assert.match(e.message, /mecanismes de demarrage et d authentification/);
    }
  });

  it('refuse un LIEN vers un dossier de la liste noire : la cible decide', () => {
    // Sans `realpath` sur le dossier, ce raccourci contournerait toute la liste noire.
    const dir = tmp('deny-link');
    const link = join(dir, 'raccourci');
    symlinkSync(join(homedir(), 'Library', 'LaunchAgents'), link);
    const code = codeOf(() => resolveForWrite(link, 'charge.plist', cfg));
    // Le dossier peut ne pas exister sur une machine neuve : les deux refus sont bons,
    // aucun des deux ne laisse ecrire.
    assert.ok(code === 'PATH_DENIED' || code === 'PATH_NOT_FOUND', `code inattendu : ${code}`);
  });

  it('refuse un nom interdit meme dans un dossier autorise', () => {
    const dir = tmp('deny-name');
    const code = codeOf(() => resolveForWrite(dir, 'package.json', cfg));
    assert.equal(code, 'PATH_DENIED');
  });

  it('refuse d ecrire par dessus un fichier executable existant', () => {
    const dir = tmp('deny-exec');
    const script = join(dir, 'outil.sh');
    writeFileSync(script, '#!/bin/sh\n');
    chmodSync(script, 0o755);
    assert.equal(codeOf(() => resolveForWrite(dir, 'outil.sh', cfg)), 'PATH_DENIED');
  });

  it('dit que le dossier n existe pas ET qu aucun mkdir n existe', () => {
    try {
      resolveForWrite('/tmp/dossier-absent-4242', 'a.txt', cfg);
      assert.fail('aurait du echouer');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.equal(e.code, 'PATH_NOT_FOUND');
      assert.match(e.message, /ne cree pas de dossier/);
    }
  });

  it('refuse un fichier la ou un dossier de destination est attendu', () => {
    const dir = tmp('notdir');
    const file = join(dir, 'fichier.txt');
    writeFileSync(file, 'x');
    assert.equal(codeOf(() => resolveForWrite(file, 'a.txt', cfg)), 'NOT_A_DIRECTORY');
  });

  it('autorise un dossier de projet ordinaire', () => {
    const dir = tmp('allow');
    const target = resolveForWrite(dir, 'photo.jpg', cfg);
    assert.equal(target.name, 'photo.jpg');
    assert.equal(target.path, join(target.dir, 'photo.jpg'));
  });

  it('S1 : refuse ~/.zlogin, un fichier de demarrage de shell absent de toute liste', () => {
    try {
      resolveForWrite(homedir(), '.zlogin', cfg);
      assert.fail('aurait du etre refuse');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.equal(e.code, 'PATH_DENIED');
      assert.equal(e.rule, 'hidden:.zlogin');
    }
  });

  it('S2 : refuse /etc/hosts par la LISTE NOIRE, message explicite, pas par EACCES', () => {
    // `realpath('/etc')` rend `/private/etc` sur macOS : avant, la regle `/etc` ne
    // matchait plus et le refus qui remontait etait un READ_DENIED trompeur.
    try {
      resolveForWrite('/etc', 'hosts', cfg);
      assert.fail('aurait du etre refuse');
    } catch (e) {
      assert.ok(e instanceof FsError);
      assert.equal(e.code, 'PATH_DENIED');
      assert.equal(e.rule, 'path:/etc');
      assert.match(e.message, /regle path:\/etc/);
      assert.doesNotMatch(e.message, /EACCES|macOS refuse/);
    }
  });
});

describe('ouverture en ecriture : O_NOFOLLOW et comparaison d inode', () => {
  it('cree en exclusif, en 0600, et rend l inode observe', () => {
    const dir = tmp('open');
    const opened = openForWrite(join(dir, 'neuf.bin'), 'create');
    writeSync(opened.fd, Buffer.from('abc'), 0, 3, 0);
    closeSync(opened.fd);
    assert.ok(opened.ino > 0n);
    assert.equal(readFileSync(join(dir, 'neuf.bin'), 'utf8'), 'abc');
  });

  it('refuse de creer deux fois le meme fichier', () => {
    const dir = tmp('excl');
    const path = join(dir, 'unique.bin');
    closeSync(openForWrite(path, 'create').fd);
    const code = codeOf(() => openForWrite(path, 'create'));
    // EEXIST tombe dans le fourre-tout `IO_ERROR`, avec le code systeme dans le message.
    assert.equal(code, 'IO_ERROR');
  });

  it('REFUSE d ecrire au travers d un lien symbolique', () => {
    // C'est la garantie centrale : un lien depose entre la verification et l'ouverture
    // redirigerait l'ecriture vers n'importe quel chemin, liste noire comprise.
    const dir = tmp('nofollow');
    const victime = join(dir, 'victime.txt');
    writeFileSync(victime, 'contenu original');
    const piege = join(dir, 'piege.txt');
    symlinkSync(victime, piege);

    const code = codeOf(() => openForWrite(piege, 'resume'));
    assert.equal(code, 'PATH_DENIED');
    assert.equal(readFileSync(victime, 'utf8'), 'contenu original');
  });

  it('refuse un lien meme en creation', () => {
    const dir = tmp('nofollow2');
    symlinkSync('/etc/hosts', join(dir, 'lien'));
    const code = codeOf(() => openForWrite(join(dir, 'lien'), 'create'));
    assert.ok(code === 'PATH_DENIED' || code === 'IO_ERROR', `code inattendu : ${code}`);
  });

  it('refuse d ecrire dans un dossier', () => {
    const dir = tmp('isdir');
    mkdirSync(join(dir, 'sous'));
    const code = codeOf(() => openForWrite(join(dir, 'sous'), 'resume'));
    assert.ok(code === 'NOT_A_FILE' || code === 'IO_ERROR', `code inattendu : ${code}`);
  });
});

describe('abreviation d affichage', () => {
  it('remplace le dossier personnel par ~, et jamais un prefixe partiel', () => {
    assert.equal(abbreviate('/Users/alice/dev', '/Users/alice'), '~/dev');
    assert.equal(abbreviate('/Users/alice', '/Users/alice'), '~');
    assert.equal(abbreviate('/Users/aliceson/dev', '/Users/alice'), '/Users/aliceson/dev');
    assert.equal(abbreviate('/etc/hosts', '/Users/alice'), '/etc/hosts');
  });
});
