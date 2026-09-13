// Autocomplétion `/` : quand proposer, quoi, dans quel ordre.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SlashCommand } from '@/protocol';
import { SUGGESTIONS_MAX, applyCommand, matchCommands, slashQuery, sourceTag } from '@/features/chat/slashCommands';

const cmd = (name: string, source: SlashCommand['source'] = 'builtin'): SlashCommand => ({ name, description: name, argumentHint: null, source });
const list = [cmd('clear'), cmd('compact'), cmd('config'), cmd('rename'), cmd('resume'), cmd('qa', 'user'), cmd('frontend-design:frontend-design', 'plugin')];

describe('slashQuery', () => {
  it('propose seulement pour un mot unique qui commence par /', () => {
    assert.equal(slashQuery('/'), '');
    assert.equal(slashQuery('/Comp'), 'comp');
    assert.equal(slashQuery('/frontend-design:fr'), 'frontend-design:fr');
    assert.equal(slashQuery('/compact '), null);
    assert.equal(slashQuery('/compact focus on x'), null);
    assert.equal(slashQuery('hello /compact'), null);
    assert.equal(slashQuery(''), null);
    assert.equal(slashQuery('/a\nb'), null);
  });
});

describe('matchCommands', () => {
  it('préfixes d abord, puis les noms qui contiennent, plafonnés', () => {
    assert.deepEqual(matchCommands(list, 'co').map((c) => c.name), ['compact', 'config']);
    assert.deepEqual(matchCommands(list, 'design').map((c) => c.name), ['frontend-design:frontend-design']);
    assert.deepEqual(matchCommands(list, 're').map((c) => c.name), ['rename', 'resume']);
    assert.deepEqual(matchCommands(list, 'am').map((c) => c.name), ['rename']);
    assert.equal(matchCommands(list, 'zzz').length, 0);
    const many = Array.from({ length: 30 }, (_, i) => cmd(`c${i}`));
    assert.equal(matchCommands(many, '').length, SUGGESTIONS_MAX);
    assert.equal(matchCommands(many, 'c').length, SUGGESTIONS_MAX);
  });
});

describe('applyCommand et sourceTag', () => {
  it('remplit la commande suivie d un espace ; étiquette sauf pour les intégrées', () => {
    assert.equal(applyCommand(cmd('compact')), '/compact ');
    assert.equal(sourceTag('builtin'), null);
    assert.equal(sourceTag('user'), 'user');
  });
});
