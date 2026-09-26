import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import ts from 'typescript';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-test-'));
process.env['KOVALINK_QUIET'] = '1';

const {
  KeyGate,
  sanitizeFreeText,
  ForbiddenError,
  MAX_TEXT,
  MIN_NEEDLE_LEN,
  composerIsEmpty,
  composerNeedles,
  composerShows,
} = await import('../src/kova/keygate.js');
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

/** Tout le journal d'audit ecrit depuis le debut du fichier de test. */
function auditText(): string {
  const dir = join(process.env['KOVALINK_HOME'] ?? '', 'audit');
  try {
    return readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('');
  } catch {
    return '';
  }
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
  const screen = {
    composerText: '',
    absorbDelayMs: 0,
    ignoreEnters: 0,
    reads: 0,
    enters: 0,
    /** Vrai : le TUI replie le collage en `[Pasted text #1 +N lines]`, comme le vrai. */
    collapsePaste: false,
  };
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
    const body = text.slice(open + 6, close);
    const pasted = screen.collapsePaste
      ? `[Pasted text #1 +${body.split('\n').length - 1} lines]`
      : (body.split('\n')[0] ?? '');
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

  // ------------------------------------------------------------------------
  // D7 : reconnaitre le repli d'un collage, et PROUVER la soumission.
  // ------------------------------------------------------------------------

  it('reconnait le repli d un collage multi-lignes en [Pasted text #n +m lines]', async () => {
    // Preuve dans les captures PTY de Robin : `pty-capture-32294-46.raw` contient
    // « Pasted text #1 +8 lines] », et les panes 34 et 46 sont exactement ceux dont les
    // envois du 25 septembre journalisaient `absorb=timeout`. L'aiguille tiree du texte ne
    // pouvait par construction jamais matcher ce que le composer affiche.
    const { gate, sent, screen } = makeFixture();
    screen.collapsePaste = true;
    const texte = Array.from({ length: 9 }, (_, i) => `ligne numero ${i}`).join('\n');
    const t0 = Date.now();
    const res = await gate.emitText(66, texte);
    assert.equal(res.applied, true);
    assert.ok(Date.now() - t0 < 1_500, 'aucune attente de 3 s : l absorption est VUE');
    assert.equal(sent.filter((x) => x.text === KEY_TABLE.enter).length, 1, 'un seul retour chariot');
    const journal = auditText();
    assert.ok(journal.includes('absorb=needle'), `absorption non reconnue : ${journal.slice(-200)}`);
  });

  it('un collage replie que le TUI ne valide JAMAIS est refuse, jamais annonce comme parti', async () => {
    // C'est le seul vrai message perdu en silence du systeme : `submitted()` rendait
    // `true` des que l'aiguille etait ABSENTE, ce qui est trivialement vrai quand elle n'a
    // jamais pu matcher. Le daemon journalisait `applied: true` sans aucune preuve.
    const { gate, sent, screen } = makeFixture();
    screen.collapsePaste = true;
    screen.ignoreEnters = 99;
    const res = await gate.emitText(66, 'premiere ligne\ndeuxieme ligne\ntroisieme ligne');
    assert.equal(res.applied, false);
    assert.equal(res.reason, 'not_submitted');
    assert.equal(screen.enters, 3);
    assert.equal(sent[sent.length - 1]?.text, '\u0015', 'le champ est vide, jamais de texte orphelin');
  });

  it('un message de un ou deux caracteres n a pas d aiguille, et part quand meme en une Entree', async () => {
    // Cas reels : `2026-09-18T19:34:05 not_submitted len=1` et
    // `2026-09-16T16:56:05 len=1 enter=3`. Une aiguille de 1 a 3 caracteres matche a peu
    // pres n'importe quel composer : la soumission n'etait donc jamais prouvee, trois
    // Entrees partaient, puis un Ctrl-U effacait le texte de Robin.
    assert.deepEqual(composerNeedles('y'), []);
    assert.equal(composerShows(['❯ your turn, dis moi'], 'y'), false, 'une aiguille de 1 caractere ne prouve rien');
    assert.ok(MIN_NEEDLE_LEN >= 4);
    const { gate, sent, screen } = makeFixture();
    const res = await gate.emitText(66, 'ok');
    assert.equal(res.applied, true);
    assert.equal(screen.enters, 1, 'une seule Entree');
    assert.equal(sent.some((x) => x.text === '\u0015'), false, 'aucun Ctrl-U : rien n a ete efface');
  });

  it('le champ vide est une preuve, le champ encore plein n en est pas une', () => {
    assert.equal(composerIsEmpty(['─────', '❯ ', '─────']), true);
    assert.equal(composerIsEmpty(['❯ continue stp']), false);
    // Un collage replie sous la ligne du chevron : le champ n'est PAS vide.
    assert.equal(composerIsEmpty(['❯ ', '[Pasted text #3 +11 lines]']), false);
    assert.equal(composerIsEmpty(['rien a voir']), false, 'sans composer lisible, aucune preuve');
  });

  it('emitText ne reste pas 400 ms sur un envoi ordinaire : la premiere capture gagne', async () => {
    const { gate } = makeFixture();
    const t0 = Date.now();
    assert.equal((await gate.emitText(66, 'continue stp')).applied, true);
    assert.ok(Date.now() - t0 < 400, `envoi en ${Date.now() - t0} ms, le plancher etait de ~400 ms`);
  });

  // ------------------------------------------------------------------------
  // D8 : un echec IPC ne laisse jamais de texte en plan dans le composer du Mac.
  // ------------------------------------------------------------------------

  it('collage refuse par l IPC : applied false, raison ipc_timeout, audit en erreur', async () => {
    const { gate, sent } = makeFixture();
    fake.respond = (msg) =>
      msg['cmd'] === 'send-keys' ? { ok: false, error: 'Kova did not answer within 5 s' } : null;
    try {
      const res = await gate.emitText(66, 'tu peux relancer le build');
      assert.deepEqual(res, { applied: false, reason: 'ipc_timeout' });
      assert.equal(sent.some((x) => x.text === KEY_TABLE.enter), false, 'aucune validation');
    } finally {
      fake.respond = null;
    }
    const journal = auditText();
    assert.ok(journal.includes('"result":"error"'), 'un echec IPC doit laisser une ligne d audit');
    assert.ok(journal.includes('paste len=25'));
  });

  it('validation refusee par l IPC : le champ est vide, et l app recoit un echec', async () => {
    const { gate, sent, screen } = makeFixture();
    fake.respond = (msg) =>
      msg['cmd'] === 'send-keys' && msg['text'] === KEY_TABLE.enter
        ? { ok: false, error: 'Kova did not answer within 5 s' }
        : null;
    try {
      const res = await gate.emitText(66, 'relance la suite de tests');
      assert.deepEqual(res, { applied: false, reason: 'ipc_timeout' });
    } finally {
      fake.respond = null;
    }
    assert.equal(sent[sent.length - 1]?.text, '\u0015', 'Ctrl-U : rien ne reste dans le champ du Mac');
    assert.equal(screen.composerText, '');
    assert.ok(auditText().includes('enter len=25'));
  });

  it('emitLaunch n envoie l Entree que sur un pane sans agent (processus claude compris)', async () => {
    const { gate, sent } = makeFixture({ agent: null, agent_session_id: null });
    const res = await gate.emitLaunch(66);
    assert.equal(res.applied, true);
    assert.deepEqual(sent.map((x) => x.text), [KEY_TABLE.enter]);
    const live = makeFixture();
    await assert.rejects(() => live.gate.emitLaunch(66), ForbiddenError);
    const shell = makeFixture({ agent: null, agent_session_id: null, child_processes: [{ name: 'claude', pid: 1 }] });
    await assert.rejects(() => shell.gate.emitLaunch(66), ForbiddenError);
    // Un shell frais avec un processus d'initialisation du prompt : accepte.
    const fresh = makeFixture({ agent: null, agent_session_id: null, child_processes: [{ name: 'starship', pid: 2 }] });
    assert.equal((await fresh.gate.emitLaunch(66)).applied, true);
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

  it('emitTerminalInput sur un shell nu : la ligne assainie puis l Entree, en deux appels', async () => {
    const { gate, sent } = makeFixture({ agent: null, agent_session_id: null, working: false });
    const res = await gate.emitTerminalInput(66, `ls -la${ESC}[31m\nwc\t-l`, 'dev');
    assert.deepEqual(res, { applied: true });
    assert.deepEqual(sent.map((x) => x.text), ['ls -la[31m wc-l', KEY_TABLE.enter]);
  });

  it('emitTerminalInput refuse sans rien envoyer : prompt parse en attente, ligne vide, trop longue', async () => {
    const { gate, sent, panes, prompts } = makeFixture();
    panes.setAwaiting(66, true, new Date().toISOString());
    prompts.setState('parsed');
    await assert.rejects(() => gate.emitTerminalInput(66, '1'), (e: Error) => e instanceof ForbiddenError && (e as InstanceType<typeof ForbiddenError>).code === 'FORBIDDEN_KEY');
    const shell = makeFixture({ agent: null, agent_session_id: null });
    await assert.rejects(() => shell.gate.emitTerminalInput(66, `${ESC}`), ForbiddenError);
    await assert.rejects(
      () => shell.gate.emitTerminalInput(66, 'x'.repeat(MAX_TEXT + 1)),
      (e: Error) => (e as InstanceType<typeof ForbiddenError>).code === 'TEXT_TOO_LONG',
    );
    assert.equal(sent.length, 0);
    assert.equal(shell.sent.length, 0);
  });

  it('emitTerminalInput passe sur un prompt unparsable (repli A6) et n ecrit jamais le texte dans l audit', async () => {
    const { gate, sent, panes, prompts } = makeFixture();
    panes.setAwaiting(66, true, new Date().toISOString());
    prompts.setState('unparsable');
    const secret = 'export TOKEN=tres-secret-42';
    assert.equal((await gate.emitTerminalInput(66, secret, 'dev')).applied, true);
    assert.equal(sent.length, 2);
    const auditDir = join(process.env['KOVALINK_HOME'] ?? '', 'audit');
    const journal = readdirSync(auditDir).map((f) => readFileSync(join(auditDir, f), 'utf8')).join('');
    assert.ok(journal.includes('"action":"pane.terminalInput"'));
    assert.equal(journal.includes('tres-secret-42'), false);
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

  it('KeyGate expose exactement six operations d ecriture, et pas une de plus', () => {
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
    assert.deepEqual(ops.sort(), ['emitAnswer', 'emitInterrupt', 'emitKeys', 'emitLaunch', 'emitTerminalInput', 'emitText']);
  });

  it('emitAnswer n a qu un seul appelant hors de KeyGate : prompt/answer.ts', () => {
    assert.deepEqual(where((f) => f.calls.has('emitAnswer')), ['prompt/answer.ts']);
  });

  it('les autres operations de KeyGate ne sont appelees que depuis les routes HTTPS', () => {
    // Liste fermee : un nouvel appelant doit etre ajoute ICI, en connaissance de cause.
    // Le hub WS n'y figure plus : la surface d'ecriture n'existe qu'une fois, en HTTPS.
    const callers = where(
      (f) =>
        f.calls.has('emitInterrupt') ||
        f.calls.has('emitText') ||
        f.calls.has('emitKeys') ||
        f.calls.has('emitLaunch') ||
        f.calls.has('emitTerminalInput'),
    );
    // `kova/resume.ts` porte `emitLaunch` pour les deux routes qui creent un onglet.
    assert.deepEqual(callers, ['kova/resume.ts', 'server/index.ts']);
  });
});

