import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, expandTilde } from '../src/config.js';
import { checkRead, checkWrite } from '../src/security/denylist.js';

const cfg = DEFAULT_CONFIG;

describe('liste noire en ecriture', () => {
  // Une assertion par entree de la liste : si quelqu un en retire une, un test tombe.
  for (const entry of cfg.denyWrite) {
    it(`refuse l ecriture sous ${entry}`, () => {
      const target = join(expandTilde(entry), 'cible.txt');
      const verdict = checkWrite(target, cfg);
      assert.equal(verdict.allowed, false, `${target} devrait etre refuse`);
      assert.equal(verdict.rule, `path:${entry}`);
    });
  }

  it('refuse le LaunchAgent nomme dans le critere d acceptation', () => {
    const target = join(homedir(), 'Library', 'LaunchAgents', 'x.plist');
    assert.equal(checkWrite(target, cfg).allowed, false);
  });

  it('refuse tout chemin traversant un bundle .app', () => {
    const v = checkWrite('/Applications/Kova.app/Contents/MacOS/kova', cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'segment:.app');
  });

  it('refuse les hooks git', () => {
    // Sous $HOME, la regle structurelle des fichiers caches passe en premier.
    const home = checkWrite(join(homedir(), 'dev/projet/.git/hooks/pre-commit'), cfg);
    assert.equal(home.allowed, false);
    assert.equal(home.rule, 'hidden:.git');
    // Hors $HOME, c'est la regle de segments qui tient.
    const v = checkWrite('/opt/projet/.git/hooks/pre-commit', cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'segment:.git/hooks');
  });

  it('refuse node_modules', () => {
    const v = checkWrite(join(homedir(), 'dev/projet/node_modules/x/index.js'), cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'segment:node_modules');
  });

  it('refuse package.json, a cause de postinstall', () => {
    const v = checkWrite(join(homedir(), 'dev/projet/package.json'), cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'name:package.json');
  });

  it('refuse un fichier existant portant un bit d execution', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kovalink-deny-'));
    const script = join(dir, 'outil.sh');
    writeFileSync(script, '#!/bin/sh\n');
    chmodSync(script, 0o755);
    const v = checkWrite(script, cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'mode:executable');
  });

  it('autorise un fichier ordinaire dans un dossier de projet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kovalink-ok-'));
    assert.equal(checkWrite(join(dir, 'photo.jpg'), cfg).allowed, true);
  });

  it('ne se laisse pas contourner par un chemin relatif', () => {
    const target = join(homedir(), 'dev', '..', '.ssh', 'id_rsa');
    assert.equal(checkWrite(target, cfg).allowed, false);
  });

  it('ne refuse pas un dossier dont le nom commence pareil, hors de $HOME', () => {
    // Sous $HOME, `.sshfoo` tombe sous la regle structurelle des fichiers caches ; la
    // regle `path:` seule ne doit pas matcher par prefixe de chaine.
    assert.equal(checkWrite(join(homedir(), '.sshfoo/x'), cfg).rule, 'hidden:.sshfoo');
    assert.equal(checkWrite('/opt/.sshfoo/x', cfg).allowed, true);
  });
});

/**
 * S1. Regle structurelle : tout composant de chemin qui commence par un point sous
 * $HOME est refuse en ecriture. Un cas par fichier cite par le relecteur securite,
 * qui avait reproduit `upload/init` vers `~/.zlogin` : AUTORISE.
 */
describe('liste noire en ecriture, fichiers caches sous $HOME (S1)', () => {
  const cited = [
    '.zlogin',
    '.zlogout',
    '.bash_login',
    '.bash_logout',
    '.login',
    '.cshrc',
    '.config/fish/config.fish',
    '.vimrc',
    '.hammerspoon/init.lua',
    '.npmrc',
    '.irbrc',
    '.gemrc',
    '.local/bin/outil',
    '.gitconfig',
  ];
  for (const rel of cited) {
    it(`refuse ~/${rel}`, () => {
      const v = checkWrite(join(homedir(), rel), cfg);
      assert.equal(v.allowed, false, `~/${rel} devrait etre refuse`);
      assert.ok(v.rule?.startsWith('hidden:'), `regle attendue hidden:, obtenu ${v.rule}`);
    });
  }

  it('refuse ~/.config/git/config meme si le fichier n existe pas encore', () => {
    const target = join(homedir(), '.config/git/config');
    assert.equal(existsSync(target), false, 'le test suppose que ce fichier n existe pas');
    const v = checkWrite(target, cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'hidden:.config');
  });

  it('refuse le dossier cache lui meme, pas seulement son contenu', () => {
    assert.equal(checkWrite(join(homedir(), '.hammerspoon'), cfg).allowed, false);
  });

  it('refuse un fichier cache dans un sous dossier profond de $HOME', () => {
    const v = checkWrite(join(homedir(), 'dev/projet/.env'), cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'hidden:.env');
  });

  it('laisse passer un dossier visible de $HOME et ne touche pas a la lecture', () => {
    assert.equal(checkWrite(join(homedir(), 'Downloads/photo.jpg'), cfg).allowed, true);
    assert.equal(checkRead(join(homedir(), '.zshrc'), cfg).allowed, true);
  });

  it('ne s applique pas hors de $HOME : un dossier cache dans /tmp reste ecrivable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kovalink-hidden-'));
    assert.equal(checkWrite(join(dir, '.cache', 'x'), cfg).allowed, true);
  });
});

/**
 * S2. Les regles passent par `realpath` des deux cotes : sur macOS `/etc` est un lien
 * vers `/private/etc`, et la regle `/etc` ne matchait jamais un chemin deja resolu.
 */
describe('liste noire en ecriture, canonicalisation (S2)', () => {
  it('refuse /etc/hosts par la regle /etc, sous sa forme demandee', () => {
    const v = checkWrite('/etc/hosts', cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'path:/etc');
  });

  it('refuse /private/etc/hosts, la forme reelle, par la MEME regle', () => {
    const v = checkWrite('/private/etc/hosts', cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'path:/etc');
  });

  it('refuse un lien symbolique vers une racine interdite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kovalink-link-'));
    const link = join(dir, 'raccourci');
    symlinkSync(join(homedir(), 'Library', 'LaunchAgents'), link);
    const v = checkWrite(join(link, 'x.plist'), cfg);
    assert.equal(v.allowed, false);
    assert.equal(v.rule, 'path:~/Library/LaunchAgents');
  });
});

describe('liste noire en lecture', () => {
  for (const entry of cfg.denyRead) {
    it(`refuse la lecture sous ${entry}`, () => {
      assert.equal(checkRead(join(expandTilde(entry), 'x'), cfg).allowed, false);
    });
  }

  it('la lecture reste totale ailleurs, c est le choix de Robin', () => {
    assert.equal(checkRead(join(homedir(), 'Documents/contrat.pdf'), cfg).allowed, true);
    assert.equal(checkRead('/etc/hosts', cfg).allowed, true);
  });
});
