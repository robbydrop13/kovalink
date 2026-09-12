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
  /**
   * Faux composer de Claude Code, pilote par le test : `composerText` est ce que la ligne
   * `❯` montre. Par defaut il suit ce qui a ete colle et se vide sur un retour chariot,
   * comme le vrai TUI quand tout va bien. `absorbDelayMs` simule la conversion d'un
   * chemin d'image ; `ignoreEnters` le nombre de retours chariot que le TUI avale.
   */
  const screen = { composerText: '', absorbDelayMs: 0, ignoreEnters: 0, reads: 0, enters: 0 };
  fake.on('command', (payload: Record<string, unknown>) => {
    if (payload['cmd'] !== 'send-keys' || payload['pane_id'] !== 66) return;
    const text = payload['text'] as string;
    if (text === '\u0015') {
      screen.composerText = '';
      return;
    }
    if (text === KEY_TABLE.enter) {
      screen.enters += 1;
      if (screen.ignoreEnters > 0) screen.ignoreEnters -= 1;
      else screen.composerText = '';
      return;
    }
    const open = text.indexOf(`${ESC}[200~`);
    const close = text.lastIndexOf(`${ESC}[201~`);
    if (open < 0 || close < 0) return;
    const pasted = text.slice(open + 6, close).split('\n')[0] ?? '';
    if (screen.absorbDelayMs > 0) {
      screen.composerText = '';
      setTimeout(() => {
        screen.composerText = pasted;
      }, screen.absorbDelayMs);
    } else screen.composerText = pasted;
  });
  const prompts = {
    current: async () => ({ state: promptState, paneId: 66 }),
    screen: async () => {
      screen.reads += 1;
      return { paneId: 66, cols: 80, rows: 24, lines: ['─────', `❯ ${screen.composerText}`, '─────'], cursor: { row: 0, col: 0 }, capturedAt: '' };
    },
    setState: (s: typeof promptState) => {
      promptState = s;
    },
  };
  const gate = new KeyGate(
    ipc as never,
    panes,
    prompts as never,
  );
  return { gate, sent, panes, prompts, screen };
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

  it('emitText attend que le composer montre le texte avant le retour chariot (image collee)', async () => {
    // Mesure : Claude Code convertit un chemin d'image en `[Image #n]` en 300 a 700 ms
    // et perd tout retour chariot recu pendant ce temps. Le message du 12 septembre a
    // 15:25 (texte + capture, `ok` dans l'audit) est reste dans le champ pour cette raison.
    const { gate, sent, screen } = makeFixture();
    screen.absorbDelayMs = 400;
    const t0 = Date.now();
    const res = await gate.emitText(66, 'regarde\n/tmp/kovalink/attachments/s/photo.png');
    assert.equal(res.applied, true);
    assert.ok(Date.now() - t0 >= 400, 'le retour chariot a attendu l absorption');
    assert.deepEqual(sent.map((x) => x.text === KEY_TABLE.enter), [false, true]);
    assert.equal(screen.composerText, '', 'le champ est vide apres envoi');
  });

  it('emitText renvoie le retour chariot si le TUI a avale le premier, et le dit dans l audit', async () => {
    const { gate, screen } = makeFixture();
    screen.ignoreEnters = 1;
    const res = await gate.emitText(66, 'continue');
    assert.equal(res.applied, true);
    assert.equal(screen.enters, 2);
    assert.equal(screen.composerText, '');
  });

  it('emitText efface le champ et refuse quand trois retours chariot restent sans effet', async () => {
    const { gate, sent, screen } = makeFixture();
    screen.ignoreEnters = 99;
    const res = await gate.emitText(66, 'perdu ?');
    assert.equal(res.applied, false);
    assert.equal(res.reason, 'not_submitted');
    assert.equal(screen.enters, 3);
    assert.equal(sent[sent.length - 1]?.text, '\u0015', 'Ctrl-U en dernier : jamais de texte orphelin');
    assert.equal(screen.composerText, '');
  });

  it('emitText, prompt parse apparu APRES le collage : aucun retour chariot, champ vide, refus explicite', async () => {
    // Regression du bug 3 : envoi pendant que le pane travaille, le detecteur signale un
    // prompt parse entre le collage et la validation. Jamais l'etat intermediaire « texte
    // dans le champ sans Entree ».
    const { gate, sent, panes, prompts, screen } = makeFixture();
    prompts.setState('none');
    // Le prompt parse apparait au moment ou le collage atteint le pane.
    const onPaste = (payload: Record<string, unknown>): void => {
      if (payload['cmd'] !== 'send-keys' || !String(payload['text']).includes('[200~')) return;
      panes.setAwaiting(66, true, new Date().toISOString());
      prompts.setState('parsed');
      fake.off('command', onPaste);
    };
    fake.on('command', onPaste);
    const res = await gate.emitText(66, 'oui vas y');
    assert.equal(res.applied, false);
    assert.equal(res.reason, 'became_awaiting');
    assert.equal(sent.some((x) => x.text === KEY_TABLE.enter), false, 'aucun retour chariot');
    assert.equal(sent[sent.length - 1]?.text, '\u0015', 'le texte colle est efface');
    assert.equal(screen.composerText, '');
  });

  it('emitLaunch n envoie l Entree que sur un pane sans agent ni processus', async () => {
    const { gate, sent } = makeFixture({ agent: null, agent_session_id: null });
    const res = await gate.emitLaunch(66);
    assert.equal(res.applied, true);
    assert.deepEqual(sent.map((x) => x.text), [KEY_TABLE.enter]);
    const live = makeFixture();
    await assert.rejects(() => live.gate.emitLaunch(66), ForbiddenError);
    const shell = makeFixture({ agent: null, agent_session_id: null, child_processes: [{ name: 'claude', pid: 1 }] });
    await assert.rejects(() => shell.gate.emitLaunch(66), ForbiddenError);
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
    const { gate, sent, panes, prompts, screen } = makeFixture();
    panes.setAwaiting(66, true, new Date().toISOString());
    prompts.setState('unparsable');
    const res = await gate.emitText(66, 'debloque toi');
    assert.equal(res.applied, true);
    assert.equal(sent.length, 2);
    assert.equal(screen.composerText, '');
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

  it('KeyGate expose exactement cinq operations d ecriture, et pas une de plus', () => {
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
    assert.deepEqual(ops.sort(), ['emitAnswer', 'emitInterrupt', 'emitKeys', 'emitLaunch', 'emitText']);
  });

  it('emitAnswer n a qu un seul appelant hors de KeyGate : prompt/answer.ts', () => {
    assert.deepEqual(where((f) => f.calls.has('emitAnswer')), ['prompt/answer.ts']);
  });

  it('les autres operations de KeyGate ne sont appelees que depuis les routes HTTPS', () => {
    // Liste fermee : un nouvel appelant doit etre ajoute ICI, en connaissance de cause.
    // Le hub WS n'y figure plus : la surface d'ecriture n'existe qu'une fois, en HTTPS.
    const callers = where(
      (f) => f.calls.has('emitInterrupt') || f.calls.has('emitText') || f.calls.has('emitKeys') || f.calls.has('emitLaunch'),
    );
    assert.deepEqual(callers, ['server/index.ts']);
  });
});

