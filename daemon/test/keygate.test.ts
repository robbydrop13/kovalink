import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import ts from 'typescript';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-test-'));
process.env['KOVALINK_QUIET'] = '1';

const { KeyGate, sanitizeFreeText, ForbiddenError, MAX_TEXT } = await import(
  '../src/kova/keygate.js'
);
const { PaneStore } = await import('../src/kova/panes.js');
const { KovaIpc, claimRawChannel } = await import('../src/kova/ipc.js');
const { KOVA_EXEC, realDeps } = await import('../src/kova/discover.js');
const { FakeKova } = await import('./helpers/fakeKova.js');
const { KEY_TABLE } = await import('@kovalink/protocol');

/**
 * Un VRAI `KovaIpc` contre un faux Kova, partage par toutes les fixtures : depuis K1,
 * `KovaIpc` n'a plus de methode publique sans garde qu'un faux objet pourrait imiter.
 * Ce qui atteint le faux Kova est donc exactement ce qui atteindrait le vrai.
 */
const fake = new FakeKova();
let ipc: InstanceType<typeof KovaIpc>;
before(async () => {
  await fake.start();
  ipc = new KovaIpc({ ...realDeps, socketDir: fake.dir, commOf: () => `${KOVA_EXEC}\n` });
  ipc.start();
  await new Promise((r) => ipc.once('ready', r));
});
after(() => {
  ipc.stop();
  fake.stop();
});

const ESC = String.fromCharCode(27);
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

describe('sanitizeFreeText', () => {
  it('supprime tous les C0 sauf tabulation et saut de ligne', () => {
    const raw = 'a\u0000b\u0007c\u001bd\u001fe\u007ff\tg\nh';
    const out = sanitizeFreeText(raw);
    const body = out.slice(`${ESC}[200~`.length, -`${ESC}[201~`.length);
    assert.equal(body, 'abcdef\tg\nh');
  });

  it('supprime ESC, donc aucune sequence OSC ne survit (OSC 52 compris)', () => {
    const osc52 = `${ESC}]52;c;bWFsaWNl${String.fromCharCode(7)}`;
    const out = sanitizeFreeText(`avant${osc52}apres`);
    assert.ok(!out.slice(6, -6).includes(ESC));
    assert.equal(out.includes('52;c;bWFsaWNl'), true, 'le texte residuel est inerte');
  });

  it('supprime les controles C1 en 8 bits', () => {
    const out = sanitizeFreeText('a\u009bb\u0080c');
    assert.equal(out, `${ESC}[200~abc${ESC}[201~`);
  });

  it('emballe en bracketed paste', () => {
    const out = sanitizeFreeText('bonjour');
    assert.equal(out, `${ESC}[200~bonjour${ESC}[201~`);
  });

  it('normalise les fins de ligne CRLF, aucun retour chariot ne survit', () => {
    const out = sanitizeFreeText('a\r\nb\rc');
    assert.equal(out.includes('\r'), false);
    assert.equal(out, `${ESC}[200~a\nb\nc${ESC}[201~`);
  });

  it('refuse au dela de la taille maximale', () => {
    assert.throws(() => sanitizeFreeText('x'.repeat(MAX_TEXT + 1)), ForbiddenError);
  });
});

interface Sent {
  paneId: number;
  text: string;
}

function makeFixture(overrides: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  fake.on('command', (payload: Record<string, unknown>) => {
    if (payload['cmd'] !== 'send-keys') return;
    sent.push({ paneId: payload['pane_id'] as number, text: payload['text'] as string });
  });
  const panes = new PaneStore();
  panes.upsertRaw({
    id: 66,
    window: 0,
    tab: 1,
    cwd: '/tmp/projet',
    title: 'cc',
    pid: 1,
    agent: 'claude',
    agent_session_id: 'sess-1',
    working: true,
    awaiting: false,
    child_processes: [],
    ...overrides,
  });
  let promptState: 'none' | 'parsed' | 'unparsable' = 'unparsable';
  const prompts = {
    current: async () => ({ state: promptState, paneId: 66 }),
    setState: (s: typeof promptState) => {
      promptState = s;
    },
  };
  const gate = new KeyGate(
    ipc as never,
    panes,
    prompts as never,
  );
  return { gate, sent, panes, prompts };
}

describe('KeyGate', () => {
  it('emitInterrupt envoie exactement un caractere d echappement, jamais Ctrl-C', async () => {
    const { gate, sent } = makeFixture();
    const res = await gate.emitInterrupt(66);
    assert.equal(res.applied, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.text, KEY_TABLE.esc);
    assert.notEqual(sent[0]?.text, KEY_TABLE.ctrl_c);
  });

  it('emitInterrupt passe sans aucune garde d etat, meme en attente', async () => {
    const { gate, sent, panes, prompts } = makeFixture();
    panes.setAwaiting(66, true, new Date().toISOString());
    prompts.setState('parsed');
    const res = await gate.emitInterrupt(66);
    assert.equal(res.applied, true);
    assert.equal(sent.length, 1);
  });

  it('emitText refuse un pane sans agent', async () => {
    const { gate, sent } = makeFixture({ agent: null, agent_session_id: null });
    await assert.rejects(() => gate.emitText(66, 'ls'), ForbiddenError);
    assert.equal(sent.length, 0, 'aucun octet ne part');
  });

  it('emitText envoie le texte assaini puis le retour chariot, en deux appels', async () => {
    const { gate, sent } = makeFixture();
    const res = await gate.emitText(66, 'continue stp');
    assert.equal(res.applied, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0]?.text, `${ESC}[200~continue stp${ESC}[201~`);
    assert.equal(sent[1]?.text, KEY_TABLE.enter);
  });

  it('emitText ne laisse partir aucun retour chariot si un prompt parse est en attente', async () => {
    const { gate, sent, panes, prompts } = makeFixture();
    panes.setAwaiting(66, true, new Date().toISOString());
    prompts.setState('parsed');
    const res = await gate.emitText(66, 'oui');
    assert.equal(res.applied, false);
    assert.equal(res.reason, 'became_awaiting');
    assert.equal(sent.length, 0);
  });

  it('emitText passe quand le prompt est unparsable : c est le repli de A6', async () => {
    const { gate, sent, panes, prompts } = makeFixture();
    panes.setAwaiting(66, true, new Date().toISOString());
    prompts.setState('unparsable');
    const res = await gate.emitText(66, 'debloque toi');
    assert.equal(res.applied, true);
    assert.equal(sent.length, 2);
  });

  it('emitAnswer emet le chiffre ET le retour chariot dans un seul send-keys', async () => {
    const { gate, sent } = makeFixture();
    await gate.emitAnswer(66, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.text, '2\r');
  });

  it('emitAnswer refuse un index qui n est pas un entier positif, sans rien envoyer', async () => {
    const { gate, sent } = makeFixture();
    await assert.rejects(() => gate.emitAnswer(66, 0), ForbiddenError);
    await assert.rejects(() => gate.emitAnswer(66, 1.5), ForbiddenError);
    await assert.rejects(() => gate.emitAnswer(66, -1), ForbiddenError);
    await assert.rejects(() => gate.emitAnswer(66, Number.NaN), ForbiddenError);
    assert.equal(sent.length, 0);
  });

  it('emitKeys refuse une touche decisive quand un prompt parse attend', async () => {
    const { gate, sent, panes, prompts } = makeFixture();
    panes.setAwaiting(66, true, new Date().toISOString());
    prompts.setState('parsed');
    await assert.rejects(() => gate.emitKeys(66, ['digit2', 'enter']), ForbiddenError);
    assert.equal(sent.length, 0);
  });

  it('emitKeys n accepte que des touches de la table fermee', async () => {
    const { gate, sent } = makeFixture();
    await assert.rejects(() => gate.emitKeys(66, ['inconnue' as never]), ForbiddenError);
    assert.equal(sent.length, 0);
  });
});

// --------------------------------------------------------------------------
// K1 : analyse SYNTAXIQUE de `src/`, pas un grep. Un appelant ecrit avec des guillemets
// doubles, un gabarit, une concatenation ou un renommage a l'import est vu quand meme.
// --------------------------------------------------------------------------

interface Facts {
  /** Modules importes (specificateur brut, ex. `./sendKeys.js`). */
  imports: Set<string>;
  /** Noms importes, quel que soit le module (ex. `claimRawChannel`, un alias compte par son nom d origine). */
  importedNames: Set<string>;
  /** Appels : `f(` compte `f`, `x.m(` compte `m`, quel que soit l objet. */
  calls: Set<string>;
  /** Litteraux de chaine et gabarits, apres normalisation. */
  strings: Set<string>;
  /** Acces a une propriete par point ou par crochet avec litteral. */
  properties: Set<string>;
}

function analyze(file: string): Facts {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const facts: Facts = {
    imports: new Set(),
    importedNames: new Set(),
    calls: new Set(),
    strings: new Set(),
    properties: new Set(),
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      facts.imports.add(node.moduleSpecifier.text);
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) facts.importedNames.add((el.propertyName ?? el.name).text);
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) facts.calls.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) facts.calls.add(callee.name.text);
      else if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
        facts.calls.add(callee.argumentExpression.text);
      }
    }
    if (ts.isPropertyAccessExpression(node)) facts.properties.add(node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      facts.properties.add(node.argumentExpression.text);
    }
    if (ts.isStringLiteralLike(node)) facts.strings.add(node.text);
    if (ts.isTemplateExpression(node)) {
      // Un gabarit `send-${'keys'}` : on recompose les parties fixes pour le voir.
      facts.strings.add(node.head.text + node.templateSpans.map((s) => s.literal.text).join(''));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return facts;
}

describe('point d entree unique des ecritures (K1, analyse syntaxique)', () => {
  const files = sourceFiles(SRC_DIR);
  const facts = new Map(files.map((f) => [relative(SRC_DIR, f), analyze(f)] as const));
  const where = (pred: (f: Facts) => boolean): string[] =>
    [...facts].filter(([, f]) => pred(f)).map(([name]) => name).sort();

  it('un seul module importe sendKeys.js, quel que soit le style de guillemets', () => {
    assert.deepEqual(
      where((f) => [...f.imports].some((m) => /(^|\/)sendKeys\.js$/.test(m))),
      ['kova/keygate.ts'],
    );
  });

  it('le nom sendKeys n est appele que dans KeyGate et dans sa definition', () => {
    assert.deepEqual(where((f) => f.calls.has('sendKeys')), ['kova/keygate.ts']);
    assert.deepEqual(where((f) => f.importedNames.has('sendKeys')), ['kova/keygate.ts']);
  });

  it('la commande send-keys n est ecrite que dans sendKeys.ts et le garde-fou de ipc.ts', () => {
    const holders = where((f) => [...f.strings].some((s) => s.replace(/\s+/g, '') === 'send-keys'));
    assert.deepEqual(holders, ['kova/ipc.ts', 'kova/sendKeys.ts']);
    // Une concatenation `'send-' + 'keys'` laisse deux morceaux : on les cherche aussi.
    const pieces = where((f) => f.strings.has('send-') || f.strings.has('-keys'));
    assert.deepEqual(pieces, []);
  });

  it('requestUnchecked n existe plus nulle part : ni methode, ni appel, ni propriete', () => {
    assert.deepEqual(where((f) => f.calls.has('requestUnchecked') || f.properties.has('requestUnchecked')), []);
    for (const file of files) assert.equal(readFileSync(file, 'utf8').includes('requestUnchecked'), false, file);
  });

  it('le canal brut IPC n est reclame que par sendKeys.ts, et claimRawChannel est a usage unique', () => {
    assert.deepEqual(where((f) => f.calls.has('claimRawChannel')), ['kova/sendKeys.ts']);
    assert.deepEqual(where((f) => f.importedNames.has('claimRawChannel')), ['kova/sendKeys.ts']);
    // sendKeys.ts l'a deja reclame au chargement : une seconde reclamation echoue.
    assert.throws(() => claimRawChannel(), /deja ete reclame/);
  });

  it('KeyGate expose exactement quatre operations d ecriture, et pas une de plus', () => {
    const source = ts.createSourceFile(
      'keygate.ts',
      readFileSync(join(SRC_DIR, 'kova/keygate.ts'), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const ops: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name?.text === 'KeyGate') {
        for (const m of node.members) {
          if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text.startsWith('emit')) {
            ops.push(m.name.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.deepEqual(ops.sort(), ['emitAnswer', 'emitInterrupt', 'emitKeys', 'emitText']);
  });

  it('emitAnswer n a qu un seul appelant hors de KeyGate : prompt/answer.ts', () => {
    assert.deepEqual(where((f) => f.calls.has('emitAnswer')), ['prompt/answer.ts']);
  });

  it('les autres operations de KeyGate ne sont appelees que depuis les routes HTTPS', () => {
    // Liste fermee : un nouvel appelant doit etre ajoute ICI, en connaissance de cause.
    // Le hub WS n'y figure plus : la surface d'ecriture n'existe qu'une fois, en HTTPS.
    const callers = where((f) => f.calls.has('emitInterrupt') || f.calls.has('emitText') || f.calls.has('emitKeys'));
    assert.deepEqual(callers, ['server/index.ts']);
  });
});

