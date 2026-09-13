import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BUILTIN_COMMANDS, collectCommands, parseFrontmatter, parseInstalledPlugins } from '../src/claude/commands.js';

function scaffold(): { home: string; project: string } {
  const home = mkdtempSync(join(tmpdir(), 'kl-home-'));
  const project = join(home, 'work', 'repo');
  mkdirSync(join(home, '.claude', 'commands', 'front'), { recursive: true });
  mkdirSync(join(home, '.claude', 'skills', 'alfred'), { recursive: true });
  mkdirSync(join(home, '.claude', 'skills', 'hidden'), { recursive: true });
  mkdirSync(join(home, '.claude', 'plugins', 'cache', 'gh', 'skills', 'pr'), { recursive: true });
  mkdirSync(join(project, 'sub', '.claude', 'commands'), { recursive: true });
  mkdirSync(join(project, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(home, '.claude', 'commands', 'qa.md'), '---\ndescription: "QA a fix"\nargument-hint: "CLA-XXXX | <url>"\n---\nbody');
  writeFileSync(join(home, '.claude', 'commands', 'front', 'component.md'), 'no frontmatter');
  writeFileSync(join(home, '.claude', 'commands', 'bad name.md'), '');
  writeFileSync(join(home, '.claude', 'skills', 'alfred', 'SKILL.md'), '---\nname: alfred\ndescription: Alfred workflows\nuser-invocable: true\n---\n');
  writeFileSync(join(home, '.claude', 'skills', 'hidden', 'SKILL.md'), '---\nuser-invocable: false\n---\n');
  writeFileSync(join(home, '.claude', 'plugins', 'cache', 'gh', 'skills', 'pr', 'SKILL.md'), '---\ndescription: Open a PR\n---\n');
  writeFileSync(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'github@official': [{ scope: 'project', projectPath: project, installPath: join(home, '.claude', 'plugins', 'cache', 'gh') }] } }),
  );
  writeFileSync(join(project, '.claude', 'commands', 'qa.md'), '---\ndescription: Project QA\n---\n');
  writeFileSync(join(project, 'sub', '.claude', 'commands', 'deploy.md'), '---\ndescription: Deploy\n---\n');
  return { home, project };
}

describe('commandes / de Claude Code', () => {
  it('lit l en-tete : description entre guillemets, indication d arguments, non invocable', () => {
    assert.deepEqual(parseFrontmatter('---\ndescription: "Hello"\nargument-hint: "<x>"\n---\n'), { name: null, description: 'Hello', argumentHint: '<x>', invocable: true });
    assert.equal(parseFrontmatter('---\nuser-invocable: false\n---\n').invocable, false);
    assert.equal(parseFrontmatter('plain').description, '');
  });

  it('integrees en tete, projet avant utilisateur, sous-dossiers en espace de noms, plugins prefixes', () => {
    const { home, project } = scaffold();
    const list = collectCommands(join(project, 'sub'), home);
    assert.equal(list[0]?.name, BUILTIN_COMMANDS[0]?.[0]);
    const byName = new Map(list.map((c) => [c.name, c]));
    assert.equal(byName.get('qa')?.description, 'Project QA', 'le projet masque la commande utilisateur');
    assert.equal(byName.get('qa')?.source, 'project');
    assert.equal(byName.get('deploy')?.source, 'project');
    assert.equal(byName.get('front:component')?.source, 'user');
    assert.equal(byName.get('alfred')?.description, 'Alfred workflows');
    assert.equal(byName.get('github:pr')?.source, 'plugin');
    assert.equal(byName.has('hidden'), false);
    assert.equal(byName.has('bad name'), false);
    assert.equal(list.length, new Set(list.map((c) => c.name)).size, 'aucun doublon');
  });

  it('un plugin de projet reste invisible hors de son projet', () => {
    const { home } = scaffold();
    const list = collectCommands(join(home, 'elsewhere'), home);
    assert.equal(list.some((c) => c.name === 'github:pr'), false);
    assert.equal(list.some((c) => c.name === 'qa' && c.source === 'user'), true);
  });

  it('installed_plugins.json casse ou vide : aucune commande de plugin, pas d erreur', () => {
    assert.equal(parseInstalledPlugins('{').size, 0);
    assert.equal(parseInstalledPlugins('{"plugins":{"x@y":"nope"}}').size, 0);
  });
});
