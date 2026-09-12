import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { FS_FORBIDDEN_VERBS, ROUTES, ROUTE_PATTERNS } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-routes-'));
process.env['KOVALINK_QUIET'] = '1';

const { parseRange, sha256OfFile } = await import('../src/server/fsRoutes.js');
const { buildQuickDests, listRecentProjects, resolveRecentProject, shortLabel } = await import(
  '../src/fs/quickdests.js'
);
const { DEFAULT_CONFIG } = await import('../src/config.js');

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

describe('CA-110 : les routes destructrices n existent PAS', () => {
  // Le PRD les exclut sans exception et `resize-pane` a deja reapparu apres avoir ete
  // retiree en passe 1. Une interdiction qui n'est pas testee finit par revenir.
  it('aucun chemin de route du daemon ne contient un verbe destructeur', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        // On ne cherche que dans les CHEMINS de route, pas dans les commentaires ni
        // dans les appels internes a `renameSync` (la publication atomique en a besoin).
        const routes = line.match(/'\/v1\/[^']*'/g);
        if (!routes) continue;
        for (const route of routes) {
          for (const verb of FS_FORBIDDEN_VERBS) {
            if (route.toLowerCase().includes(verb)) {
              offenders.push(`${file} : ${route} contient « ${verb} »`);
            }
          }
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('la table des routes ne declare aucun verbe destructeur', () => {
    const declared = Object.values(ROUTE_PATTERNS).join(' ').toLowerCase();
    for (const verb of FS_FORBIDDEN_VERBS) {
      assert.equal(declared.includes(verb), false, `« ${verb} » est declare dans ROUTE_PATTERNS`);
    }
  });

  it('le bloc C expose exactement sept routes plus le journal', () => {
    const fsRoutes = Object.entries(ROUTE_PATTERNS)
      .filter(([, pattern]) => pattern.startsWith('/v1/fs/'))
      .map(([, pattern]) => pattern)
      .sort();
    assert.deepEqual(fsRoutes, [
      '/v1/fs/list',
      '/v1/fs/quickdests',
      '/v1/fs/read',
      '/v1/fs/text',
      '/v1/fs/upload/:uploadId',
      '/v1/fs/upload/:uploadId/complete',
      '/v1/fs/upload/init',
    ]);
    assert.equal(ROUTE_PATTERNS.audit, '/v1/audit');
  });

  it('les constructeurs de chemin cote client encodent leurs parametres', () => {
    assert.equal(ROUTES.fsUpload('a/b'), '/v1/fs/upload/a%2Fb');
    assert.equal(ROUTES.fsUploadComplete('../x'), '/v1/fs/upload/..%2Fx/complete');
  });
});

describe('en-tete Range', () => {
  it('lit une plage fermee, ouverte et suffixe', () => {
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
    assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  });

  it('borne la fin sur la taille reelle : une reprise demande souvent trop', () => {
    assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  });

  it('rend null sur une plage absurde plutot que de rendre un flux faux', () => {
    assert.equal(parseRange(undefined, 1000), null);
    assert.equal(parseRange('bytes=-', 1000), null);
    assert.equal(parseRange('bytes=900-100', 1000), null);
    assert.equal(parseRange('bytes=2000-3000', 1000), null);
    assert.equal(parseRange('octets=0-10', 1000), null);
    assert.equal(parseRange('bytes=0-10, 20-30', 1000), null);
  });
});

describe('destinations rapides', () => {
  it('met le cwd du pane FOCALISE en tete : c est le « bon dossier » demande', () => {
    const panes = [
      { id: 1, cwd: '/usr', focused: false, projectName: 'usr' },
      { id: 2, cwd: '/etc', focused: true, projectName: 'etc' },
    ] as never;
    const res = buildQuickDests(panes, DEFAULT_CONFIG);
    assert.equal(res.focusedCwd, '/etc');
    assert.equal(res.dests[0]?.path, '/etc');
    assert.equal(res.dests[0]?.badge, 'pane actif');
  });

  it('ne propose jamais deux fois le meme dossier', () => {
    const panes = [
      { id: 1, cwd: '/usr', focused: true, projectName: 'usr' },
      { id: 2, cwd: '/usr', focused: false, projectName: 'usr' },
    ] as never;
    const paths = buildQuickDests(panes, DEFAULT_CONFIG).dests.map((d) => d.path);
    assert.equal(new Set(paths).size, paths.length);
  });

  it('marque non inscriptible un dossier de la liste noire, sans le cacher', () => {
    const res = buildQuickDests([] as never, DEFAULT_CONFIG);
    const etc = buildQuickDests(
      [{ id: 1, cwd: '/etc', focused: true, projectName: 'etc' }] as never,
      DEFAULT_CONFIG,
    ).dests.find((d) => d.path === '/etc');
    assert.equal(etc?.writable, false);
    // Le dossier personnel, lui, reste inscriptible.
    assert.equal(res.dests.find((d) => d.path === res.home)?.writable, true);
  });

  it('abrege un chemin en deux segments lisibles', () => {
    assert.equal(shortLabel('/Users/robin/dev/link/docs', '/Users/robin'), 'link / docs');
    assert.equal(shortLabel('/Users/robin/dev', '/Users/robin'), 'dev');
    assert.equal(shortLabel('/Users/robin', '/Users/robin'), 'Dossier personnel');
    assert.equal(shortLabel('/', '/Users/robin'), '/');
  });
});

describe('empreinte SHA-256 en lecture (CA-101, Mac vers iPhone)', () => {
  it('calcule l empreinte du fichier entier en flux, identique a celle d un outil externe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kovalink-digest-'));
    const file = join(dir, 'hello.txt');
    writeFileSync(file, 'hello');
    // `printf hello | shasum -a 256`
    assert.equal(await sha256OfFile(file), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('un fichier vide a une empreinte, pas une erreur', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kovalink-digest-'));
    const file = join(dir, 'vide');
    writeFileSync(file, '');
    assert.equal(await sha256OfFile(file), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('projets recents de Kova (Cmd+O depuis l app)', () => {
  function withRecents(projects: unknown[], fn: () => void): void {
    const file = join(mkdtempSync(join(tmpdir(), 'kovalink-recents-')), 'recent_projects.json');
    writeFileSync(file, JSON.stringify({ projects }));
    const before = process.env['KOVALINK_KOVA_RECENTS'];
    process.env['KOVALINK_KOVA_RECENTS'] = file;
    try {
      fn();
    } finally {
      if (before === undefined) delete process.env['KOVALINK_KOVA_RECENTS'];
      else process.env['KOVALINK_KOVA_RECENTS'] = before;
    }
  }

  it('liste les projets dedupliques, du plus recent au plus ancien, libelle = nom du dossier', () => {
    withRecents(
      [
        { path: '/usr', last_opened: 100 },
        { path: '/etc', last_opened: 300 },
        { path: '/usr', last_opened: 200 },
        { path: '/nulle/part', last_opened: 999 },
        { path: '/usr/local/bin', last_opened: 50 },
      ],
      () => {
        const list = listRecentProjects();
        assert.deepEqual(
          list.map((p) => [p.index, p.path, p.label, p.lastOpenedMs]),
          [
            [0, '/etc', 'etc', 300_000],
            [1, '/usr', 'usr', 200_000],
            [2, '/usr/local/bin', 'bin', 50_000],
          ],
        );
      },
    );
  });

  it('ne tronque pas la liste : plus de vingt projets restent tous proposes', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovalink-many-'));
    const projects = Array.from({ length: 25 }, (_, i) => {
      const path = join(root, `projet-${i}`);
      mkdirSync(path);
      return { path, last_opened: 1000 - i };
    });
    withRecents(projects, () => {
      const list = listRecentProjects();
      assert.equal(list.length, 25);
      assert.equal(list[0]?.path, projects[0]?.path);
      assert.equal(list[24]?.label, 'projet-24');
    });
  });

  it('resout un index seulement si le chemin confirme concorde encore', () => {
    withRecents([{ path: '/etc', last_opened: 2 }, { path: '/usr', last_opened: 1 }], () => {
      assert.equal(resolveRecentProject(1, '/usr'), '/usr');
      // La liste a bouge entre les deux appels : on refuse plutot que d'ouvrir un autre dossier.
      assert.equal(resolveRecentProject(0, '/usr'), null);
      assert.equal(resolveRecentProject(7, '/usr'), null);
      assert.equal(resolveRecentProject(-1, '/etc'), null);
      assert.equal(resolveRecentProject(1.5, '/usr'), null);
    });
  });

  it('les routes Kova existent et aucune ne prend un cwd ou une commande libre', () => {
    assert.equal(ROUTES.kovaRecentProjects, '/v1/kova/recent-projects');
    assert.equal(ROUTES.kovaNewTab, '/v1/kova/new-tab');
    assert.equal(ROUTES.kovaSessions, '/v1/kova/sessions');
    assert.equal(ROUTES.kovaResume, '/v1/kova/resume');
    const src = readFileSync(join(SRC_DIR, 'server', 'index.ts'), 'utf8');
    assert.match(src, /cmd: 'new-tab', cwd, command: NEW_TAB_COMMAND/);
    const resume = readFileSync(join(SRC_DIR, 'kova', 'resume.ts'), 'utf8');
    assert.match(resume, /const NEW_TAB_COMMAND = 'claude';/);
    assert.match(resume, /`\$\{NEW_TAB_COMMAND\} --resume \$\{session\.sessionId\}`/);
  });
});
