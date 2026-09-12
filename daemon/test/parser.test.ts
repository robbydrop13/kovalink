import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { classifyOption, MAX_OPTIONS, parsePromptText } from '../src/prompt/parser.js';
import { hashPrompt, promptFromContent } from '../src/prompt/state.js';

const FIXTURES = resolve(fileURLToPath(new URL('../../test/fixtures', import.meta.url)));
const fixture = (name: string): string => readFileSync(resolve(FIXTURES, name), 'utf8');

const BASH = fixture('prompt-bash.txt');
const BASH_1 = fixture('prompt-bash-consecutive-1.txt');
const BASH_2 = fixture('prompt-bash-consecutive-2.txt');
const WRITE = fixture('prompt-write.txt');
const TRUST = fixture('screen-trust-dialog.txt');
const IDLE = fixture('screen-idle.txt');

function must(text: string) {
  const core = parsePromptText(text);
  assert.ok(core, 'la fixture doit parser');
  return core;
}

describe('parsePromptText : fixtures reelles (Claude Code 2.1.268)', () => {
  it('prompt Bash : question, 4 options, detail = en-tete + commande + description', () => {
    const p = must(BASH);
    assert.equal(p.question, 'Do you want to proceed?');
    assert.deepEqual(
      p.options.map((o) => o.index),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      p.options.map((o) => o.label),
      [
        'Yes',
        'Yes, and always allow access to /private/tmp/kovalink-fixture from this project',
        'Yes, and switch to auto mode · auto mode handles these prompts for you',
        'No',
      ],
    );
    assert.deepEqual(
      p.options.map((o) => o.kind),
      ['approve', 'approve_always', 'approve_always', 'reject'],
    );
    assert.deepEqual(p.detail, ['Bash command', 'echo bonjour > hello.txt', 'Write "bonjour" to hello.txt']);
    assert.equal(p.freeTextAllowed, false);
  });

  it('prompt Write : question specifique, 3 options, contenu du fichier dans le detail', () => {
    const p = must(WRITE);
    assert.equal(p.question, 'Do you want to create notes.md?');
    assert.equal(p.options.length, 3);
    assert.deepEqual(
      p.options.map((o) => o.kind),
      ['approve', 'approve_always', 'reject'],
    );
    assert.deepEqual(p.detail, ['Create file', 'notes.md', '1 Bonjour', '2 Deuxieme ligne']);
  });

  it('la ligne Tip et les filets ne sont ni dans la question, ni dans le detail', () => {
    for (const text of [BASH, BASH_1, BASH_2, WRITE]) {
      const p = must(text);
      const all = [p.question, ...p.detail, ...p.options.map((o) => o.label)].join('\n');
      assert.equal(/Tip:/.test(all), false);
      assert.equal(/[─╌]{5,}/.test(all), false);
      assert.equal(/❯/.test(all), false, 'le marqueur de surlignage n entre jamais');
    }
  });

  it('le nombre d options est celui de l ecran, jamais 3 en dur', () => {
    assert.equal(must(BASH).options.length, 4);
    assert.equal(must(WRITE).options.length, 3);
  });

  it('ecran sans prompt (idle) : unparsable', () => {
    assert.equal(parsePromptText(IDLE), null);
  });

  it('dialogue de confiance, options sans numero : unparsable, aucun bouton devine', () => {
    assert.equal(parsePromptText(TRUST), null);
  });

  it('texte vide ou absurde : unparsable', () => {
    assert.equal(parsePromptText(''), null);
    assert.equal(parsePromptText('\n\n\n'), null);
    assert.equal(parsePromptText('1. Yes\n2. No'), null);
  });
});

describe('parsePromptText : mutations, jamais un resultat faux', () => {
  it('une ligne d option en moins (numerotation rompue) : unparsable', () => {
    const mutated = BASH.replace(/^\s*2\. Yes, and always allow.*\n/mu, '');
    assert.equal(parsePromptText(mutated), null);
  });

  it('une option en plus, numerotee dans la suite : parse avec 5 options et un autre hash', () => {
    const mutated = BASH.replace('   4. No\n', '   4. No\n   5. Maybe later\n');
    const p = must(mutated);
    assert.equal(p.options.length, 5);
    assert.equal(p.options[4]?.label, 'Maybe later');
    assert.equal(p.options[4]?.kind, 'neutral');
    const base = must(BASH);
    assert.notEqual(
      hashPrompt(p.question, p.detail, p.options),
      hashPrompt(base.question, base.detail, base.options),
    );
  });

  it('une option en plus hors suite (6 apres 4) : unparsable', () => {
    const mutated = BASH.replace('   4. No\n', '   4. No\n   6. Maybe\n');
    assert.equal(parsePromptText(mutated), null);
  });

  it('les options ne commencent pas a 1 : unparsable', () => {
    const mutated = BASH.replace(' ❯ 1. Yes', ' ❯ 0. Yes');
    assert.equal(parsePromptText(mutated), null);
  });

  it('une seule option : unparsable, ce n est pas un prompt de permission', () => {
    const mutated = BASH.replace(/^\s*[234]\. .*\n/gmu, '');
    assert.equal(parsePromptText(mutated), null);
  });

  it('detail vide (commande et description retirees) : parse encore, l en-tete reste', () => {
    const mutated = BASH.replace('   echo bonjour > hello.txt\n   Write "bonjour" to hello.txt\n', '');
    const p = must(mutated);
    assert.deepEqual(p.detail, ['Bash command']);
  });

  it('cadre entierement vide (plus d en-tete) : unparsable', () => {
    const mutated = BASH.replace(
      / Bash command\n Tip:.*\n\n {3}echo bonjour > hello.txt\n {3}Write "bonjour" to hello.txt\n/u,
      '',
    );
    assert.equal(parsePromptText(mutated), null);
  });

  it('la question ne se termine pas par un point d interrogation : unparsable', () => {
    const mutated = BASH.replace(' Do you want to proceed?', ' Do you want to proceed');
    assert.equal(parsePromptText(mutated), null);
  });

  it('pied de cadre absent : unparsable (le prompt n est pas au premier plan)', () => {
    const mutated = BASH.replace(/\n Esc to cancel · Tab to amend\n?$/u, '\n');
    assert.equal(parsePromptText(mutated), null);
  });

  it('du texte apres le pied de cadre : unparsable (prompt perime dans l historique)', () => {
    const mutated = `${BASH}\n⏺ Done.\n\n❯ \n`;
    assert.equal(parsePromptText(mutated), null);
  });

  it('deux marqueurs de surlignage : unparsable', () => {
    const mutated = BASH.replace('   4. No', ' ❯ 4. No');
    assert.equal(parsePromptText(mutated), null);
  });

  it('filet de cadre absent au dessus de la question : unparsable', () => {
    const mutated = BASH.replace(/^─+$/mu, '');
    assert.equal(parsePromptText(mutated), null);
  });

  it('libelle d option vide : unparsable', () => {
    const mutated = BASH.replace('   4. No', '   4. ');
    assert.equal(parsePromptText(mutated), null);
  });

  it('au dela de MAX_OPTIONS : unparsable', () => {
    const many = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `   ${i + 1}. Option ${i + 1}`).join(
      '\n',
    );
    const mutated = BASH.replace(/ ❯ 1\. Yes\n[\s\S]*? {3}4\. No\n/u, `${many}\n`);
    assert.equal(parsePromptText(mutated), null);
  });

  it('un contenu de fichier qui ressemble a une option reste du detail, jamais une option', () => {
    // Le contenu ecrit contient "3. No", prefixe par son numero de ligne : il reste dans
    // le cadre, entre dans le hash, et le bloc d options est inchange.
    const mutated = WRITE.replace('  2 Deuxieme ligne', '  2 3. No');
    const p = must(mutated);
    assert.equal(p.options.length, 3);
    assert.deepEqual(p.detail, ['Create file', 'notes.md', '1 Bonjour', '2 3. No']);
    // Sans le numero de ligne, la ligne ressemble a une option hors bloc : unparsable.
    const bare = WRITE.replace('  2 Deuxieme ligne', '  3. No');
    assert.equal(parsePromptText(bare), null);
  });

  it('marqueur deplace sur une autre option : meme resultat, hash identique (CA-63)', () => {
    const moved = BASH.replace(' ❯ 1. Yes', '   1. Yes').replace('   4. No', ' ❯ 4. No');
    const a = must(BASH);
    const b = must(moved);
    assert.deepEqual(b.options, a.options);
    assert.equal(hashPrompt(b.question, b.detail, b.options), hashPrompt(a.question, a.detail, a.options));
  });

  it('la largeur du pane ne change pas le resultat : espaces de fin et filet plus court', () => {
    const narrow = BASH.replace(/^─+$/mu, '─'.repeat(40)).replace(/\n/g, '   \n');
    const a = must(BASH);
    const b = must(narrow);
    assert.equal(hashPrompt(b.question, b.detail, b.options), hashPrompt(a.question, a.detail, a.options));
  });
});

describe('hashPrompt (C20)', () => {
  it('CA-62 : deux Bash consecutifs, meme question, memes libelles, hash DIFFERENT', () => {
    const a = must(BASH_1);
    const b = must(BASH_2);
    assert.equal(a.question, b.question);
    assert.deepEqual(a.options, b.options);
    assert.notDeepEqual(a.detail, b.detail);
    assert.notEqual(hashPrompt(a.question, a.detail, a.options), hashPrompt(b.question, b.detail, b.options));
  });

  it('CA-63 : modifier une seule ligne de detail change le hash', () => {
    const a = must(BASH);
    const detail = [...a.detail];
    detail[1] = 'rm -rf /';
    assert.notEqual(hashPrompt(a.question, a.detail, a.options), hashPrompt(a.question, detail, a.options));
  });

  it('reordonner deux options change le hash, meme a libelles identiques', () => {
    const a = must(BASH);
    const swapped = a.options.map((o, i) => ({ ...o, label: a.options[a.options.length - 1 - i]?.label ?? '' }));
    assert.notEqual(hashPrompt(a.question, a.detail, a.options), hashPrompt(a.question, a.detail, swapped));
  });

  it('le hash est stable, versionne et en base64url', () => {
    const a = must(BASH);
    const h = hashPrompt(a.question, a.detail, a.options);
    assert.equal(h, hashPrompt(a.question, a.detail, a.options));
    assert.match(h, /^[A-Za-z0-9_-]{43}$/);
  });

  it('les espaces multiples et la normalisation NFC n entrent pas dans le hash', () => {
    const h1 = hashPrompt('Do you  want?', ['a   b'], [{ index: 1, label: 'Yes', kind: 'approve' }]);
    const h2 = hashPrompt('Do you want?', ['a b'], [{ index: 1, label: 'Yes ', kind: 'approve' }]);
    assert.equal(h1, h2);
    const nfd = 'créer';
    const nfc = 'créer';
    assert.equal(hashPrompt(nfd, [], []), hashPrompt(nfc, [], []));
  });
});

describe('promptFromContent', () => {
  it('rend parsed avec hash et promptRef sur une fixture, unparsable sinon', () => {
    const since = '2026-09-11T11:00:47.000Z';
    const parsed = promptFromContent({ id: 15, text: BASH, cols: 221, rows: 64, cursor: { row: 19, col: 1 } }, since, 'ref-1');
    assert.equal(parsed.state, 'parsed');
    if (parsed.state === 'parsed') {
      assert.equal(parsed.paneId, 15);
      assert.equal(parsed.awaitingSince, since);
      assert.equal(parsed.promptRef, 'ref-1');
      assert.equal(parsed.promptHash, hashPrompt(parsed.question, parsed.detail, parsed.options));
    }
    const raw = promptFromContent({ id: 15, text: IDLE, cols: 221, rows: 64, cursor: { row: 61, col: 2 } }, since, 'ref-2');
    assert.equal(raw.state, 'unparsable');
    if (raw.state === 'unparsable') assert.equal(raw.rawScreen.split('\n').length <= 30, true);
  });

  it('pane inexistant : none', () => {
    const p = promptFromContent({ id: 15, error: 'not found' } as never, 'x', 'ref');
    assert.equal(p.state, 'none');
  });
});

describe('classifyOption', () => {
  it('reconnait la portee durable avant le simple oui', () => {
    assert.equal(classifyOption('Yes'), 'approve');
    assert.equal(classifyOption("Yes, and don't ask again for this session"), 'approve_always');
    assert.equal(classifyOption('Yes, and switch to auto mode'), 'approve_always');
    assert.equal(classifyOption('Yes, and switch to accept edits (auto-approve) for this session (shift+tab)'), 'approve_always');
    assert.equal(classifyOption('No'), 'reject');
    assert.equal(classifyOption('No, and tell Claude what to do differently'), 'reject');
    assert.equal(classifyOption('Migration incrementale'), 'neutral');
  });
});
