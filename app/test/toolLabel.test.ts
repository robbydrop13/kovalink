// Libellés des lignes d'action : le verbe et la cible que Robin lit en marchant.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GROUP_COLLAPSE_OVER, isCollapsible, isEditTool, shortPath, toolLabel, toolRowState } from '@/features/chat/toolLabel';

describe('toolLabel', () => {
  it('Read : Reads, chemin raccourci aux trois derniers segments', () => {
    const l = toolLabel({ name: 'Read', input: { file_path: '/Users/alice/link/app/src/boot.ts' }, preview: '' });
    assert.deepEqual(l, { verb: 'Reads', target: 'app/src/boot.ts', stats: null });
  });

  it('Edit : Edits, avec +ajoutées -retirées en lignes', () => {
    const l = toolLabel({
      name: 'Edit',
      input: { file_path: 'app/pair.tsx', old_string: 'a\nb\nc', new_string: 'a\nb\nc\nd\ne' },
      preview: '',
    });
    assert.deepEqual(l, { verb: 'Edits', target: 'app/pair.tsx', stats: '+5 -3' });
  });

  it('Bash : Runs, première ligne de la commande', () => {
    const l = toolLabel({ name: 'Bash', input: { command: 'npm test\necho fin' }, preview: '' });
    assert.deepEqual(l, { verb: 'Runs', target: 'npm test', stats: null });
  });

  it('Grep : Searches, motif entre guillemets', () => {
    const l = toolLabel({ name: 'Grep', input: { pattern: 'promptHash' }, preview: '' });
    assert.equal(l.verb, 'Searches');
    assert.equal(l.target, '"promptHash"');
  });

  it("outil inconnu : le nom brut et l'aperçu du daemon", () => {
    const l = toolLabel({ name: 'mcp__linear__create', input: {}, preview: 'PROD-12' });
    assert.deepEqual(l, { verb: 'mcp__linear__create', target: 'PROD-12', stats: null });
  });

  it('input absent ou non objet : ne lève jamais', () => {
    assert.equal(toolLabel({ name: 'Read', input: null, preview: 'x' }).target, 'x');
    assert.equal(toolLabel({ name: 'Edit', input: 'zzz', preview: 'y' }).stats, null);
  });

  it('shortPath garde les chemins courts intacts', () => {
    assert.equal(shortPath('a/b'), 'a/b');
    assert.equal(shortPath('/a/b/c/d/e'), 'c/d/e');
  });

  it('isEditTool : seuls les outils qui changent des fichiers sont dépliés', () => {
    assert.equal(isEditTool('Edit'), true);
    assert.equal(isEditTool('Read'), false);
  });
});

describe('toolRowState', () => {
  it('résultat présent : terminé ou échec, quel que soit le pane', () => {
    assert.equal(toolRowState(true, false, true), 'done');
    assert.equal(toolRowState(true, true, false), 'failed');
  });
  it("sans résultat : en cours si le pane travaille, sinon inconnu (jamais « en cours » permanent)", () => {
    assert.equal(toolRowState(false, false, true), 'running');
    assert.equal(toolRowState(false, false, false), 'unknown');
  });
});

describe('repli des groupes d’actions (docs/13, point 9)', () => {
  it('un groupe ne se replie qu’AU DELÀ de 5 actions : 5 restent visibles, 6 se replient', () => {
    assert.equal(GROUP_COLLAPSE_OVER, 5);
    assert.equal(isCollapsible(3), false);
    assert.equal(isCollapsible(5), false);
    assert.equal(isCollapsible(6), true);
  });
});
