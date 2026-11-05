// Le panneau : reconnaitre un fichier du Mac dans un message sans faux positif, fusionner
// les deux historiques, et construire les reponses d'une fiche dans la forme de Kova.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DecisionSheet, PanelHistoryEntry } from '@/protocol';
import { parseMarkdown } from '@/features/chat/markdownAst';
import { mergeHistory, recordEntry, retitleEntry, entryName } from '@/features/panel/history';
import {
  answeredCount,
  answersPayload,
  choose,
  setNote,
  stateFromDraft,
} from '@/features/panel/sheetAnswers';
import { planImages } from '@/features/panel/imagePlan';
import {
  codePanelPath,
  expandHome,
  findPanelPaths,
  hostOf,
  pathTarget,
  targetOfParams,
} from '@/features/panel/target';
import { askHref, askPanelTarget, isDecisionAsk } from '@/features/asks/answer';

const paths = (text: string): string[] => findPanelPaths(text).map((m) => m.path);

describe('chemins du panneau dans un message', () => {
  it('reconnait un chemin absolu ou en ~/ qui finit en .md ou .html', () => {
    assert.deepEqual(paths('See /Users/robin/notes.md and ~/x/README.md, then ~/site/index.html.'), [
      '/Users/robin/notes.md',
      '~/x/README.md',
      '~/site/index.html',
    ]);
    assert.deepEqual(paths('(~/plan.md)'), ['~/plan.md']);
    assert.deepEqual(paths('"/tmp/a.htm"'), ['/tmp/a.htm']);
  });

  it('aucun faux positif : nom nu, chemin relatif, dans un mot, autre extension, URL', () => {
    assert.deepEqual(paths('edit foo.md then docs/foo.md and a/b.html'), []);
    assert.deepEqual(paths('x/Users/robin/notes.md'), []);
    assert.deepEqual(paths('/Users/robin/notes.mdx /etc/hosts /a/b.md5'), []);
    assert.deepEqual(paths('https://a.com/x.md'), []);
    assert.deepEqual(paths('//cdn/x.md and /.md'), []);
  });

  it('un code en ligne qui n est qu un chemin s ouvre, espaces comprises', () => {
    assert.equal(codePanelPath('~/AI directory/a b.md'), '~/AI directory/a b.md');
    assert.equal(codePanelPath(' /tmp/x.html '), '/tmp/x.html');
    assert.equal(codePanelPath('cat /tmp/x.md'), null);
    assert.equal(codePanelPath('README.md'), null);
  });

  it('le Markdown porte le chemin sur son propre span, et un nom nu n est plus un lien', () => {
    const [block] = parseMarkdown('Open ~/notes/plan.md or `~/a b.html`, not README.md.');
    assert.ok(block && block.type === 'paragraph');
    if (block.type !== 'paragraph') return;
    const withPath = block.spans.filter((s) => s.path);
    assert.deepEqual(withPath.map((s) => s.path), ['~/notes/plan.md', '~/a b.html']);
    assert.equal(block.spans.some((s) => s.href), false, 'README.md ne devient pas http://README.md');
  });

  it('un vrai lien garde son href, meme vers un .md', () => {
    const [block] = parseMarkdown('[plan](https://a.com/plan.md) and https://b.com/x');
    assert.ok(block && block.type === 'paragraph');
    if (block.type !== 'paragraph') return;
    assert.deepEqual(block.spans.filter((s) => s.href).map((s) => s.href), ['https://a.com/plan.md', 'https://b.com/x']);
    assert.equal(block.spans.some((s) => s.path), false);
  });

  it('developpe ~ avec le dossier du Mac, laisse un absolu, refuse le reste', () => {
    assert.equal(expandHome('~/a.md', '/Users/robin'), '/Users/robin/a.md');
    assert.equal(expandHome('~/a.md', '/Users/robin/'), '/Users/robin/a.md');
    assert.equal(expandHome('/x/a.md', null), '/x/a.md');
    assert.equal(expandHome('~/a.md', null), null);
    assert.equal(expandHome('a.md', '/Users/robin'), null);
  });

  it('les parametres de la route et le genre d un chemin', () => {
    assert.deepEqual(targetOfParams({ kind: 'web', target: 'https://a.com' }), { kind: 'web', target: 'https://a.com' });
    assert.equal(targetOfParams({ kind: 'web', target: 'javascript:alert(1)' }), null);
    assert.equal(targetOfParams({ kind: 'nope', target: 'x' }), null);
    assert.deepEqual(pathTarget('/a/b.HTML'), { kind: 'html', target: '/a/b.HTML' });
    assert.equal(hostOf('https://www.claude.ai/artifact/x'), 'claude.ai');
  });
});

const entry = (target: string, openedAtMs: number, title = '', kind: PanelHistoryEntry['kind'] = 'web'): PanelHistoryEntry => ({
  kind,
  target,
  title,
  openedAtMs,
});

describe('historique du panneau', () => {
  it('fusionne par cible, la plus recente d abord, le titre non vide le plus recent', () => {
    const mac = [entry('https://a.com', 300, 'A on Mac'), entry('/x/n.md', 100, '', 'markdown')];
    const phone = [entry('/x/n.md', 400, 'Notes', 'markdown'), entry('https://a.com', 200, 'old')];
    const merged = mergeHistory(mac, phone);
    assert.deepEqual(merged.map((e) => [e.target, e.openedAtMs, e.title]), [
      ['/x/n.md', 400, 'Notes'],
      ['https://a.com', 300, 'A on Mac'],
    ]);
  });

  it('un titre vide recent prend celui d une ouverture plus ancienne', () => {
    const merged = mergeHistory([entry('https://a.com', 300)], [entry('https://a.com', 100, 'Kept')]);
    assert.equal(merged[0]?.title, 'Kept');
  });

  it('borne a 50', () => {
    const many = Array.from({ length: 70 }, (_, i) => entry(`https://a.com/${i}`, i));
    assert.equal(mergeHistory(many, []).length, 50);
  });

  it('ouvrir remonte en tete une seule fois et garde le titre connu', () => {
    const list = [entry('https://b.com', 2), entry('https://a.com', 1, 'A')];
    const next = recordEntry(list, { kind: 'web', target: 'https://a.com' }, '', 10);
    assert.deepEqual(next.map((e) => [e.target, e.title, e.openedAtMs]), [
      ['https://a.com', 'A', 10],
      ['https://b.com', '', 2],
    ]);
    assert.equal(retitleEntry(next, 'https://b.com', ' B ')[1]?.title, 'B');
    assert.equal(retitleEntry(next, 'https://a.com', 'A'), next);
  });

  it('le nom d une entree sans titre', () => {
    assert.equal(entryName(entry('https://www.x.com/p', 1)), 'x.com');
    assert.equal(entryName(entry('/a/b/plan.md', 1, '', 'markdown')), 'plan.md');
  });
});

const SHEET: DecisionSheet = {
  title: 'Plan',
  decisions: [
    { id: 'D1', title: 'When', options: [{ id: 'A', label: 'Now', reco: true }, { id: 'B', label: 'Later' }] },
    { id: 'D2', title: 'Who', options: [{ id: 'A', label: 'Me' }] },
    { id: 'D3', title: 'Where', options: [{ id: 'A', label: 'Here' }] },
  ],
};

describe('reponses d une fiche', () => {
  it('part du brouillon de Kova (tableau) et rend la forme de sa page (objet par id)', () => {
    let state = stateFromDraft({ decisions: [{ id: 'D1', choice: 'B', note: 'n1' }], note: 'g' });
    state = choose(state, 'D2', 'other');
    state = setNote(state, 'D2', '  ask the team  ');
    assert.deepEqual(answersPayload(SHEET, state), {
      decisions: { D1: { choice: 'B', note: 'n1' }, D2: { choice: 'other', note: 'ask the team' } },
      note: 'g',
    });
    assert.equal(answeredCount(SHEET, state), 2);
  });

  it('retoucher le choix le decoche, une decision vide n est pas envoyee (elle reste ouverte)', () => {
    let state = choose(stateFromDraft(undefined), 'D1', 'A');
    state = choose(state, 'D1', 'A');
    state = setNote(state, 'D3', '   ');
    assert.deepEqual(answersPayload(SHEET, state), { decisions: {} });
  });

  it('ecarte une decision inconnue et un choix hors options, garde la note', () => {
    let state = choose(stateFromDraft(undefined), 'D9', 'A');
    state = choose(state, 'D1', 'Z');
    state = setNote(state, 'D1', 'why');
    assert.deepEqual(answersPayload(SHEET, state), { decisions: { D1: { note: 'why' } } });
  });

  it('coupe une note au plafond de Kova', () => {
    const state = setNote(stateFromDraft(undefined), 'D1', 'x'.repeat(9000));
    assert.equal(answersPayload(SHEET, state).decisions['D1']?.note?.length, 8000);
  });
});

describe('Open sur la carte d une question', () => {
  const ask = { id: 'q1', from: 'a', message: 'm', buttons: ['Done'], input: true, askedAtMs: 0, snoozedUntilMs: 0, due: true, waiting: true, sessionId: null, cwd: null };
  it('fiche native d abord, sinon sa page, sinon rien', () => {
    assert.deepEqual(askPanelTarget({ ...ask, kind: 'decision', sheet: true, url: 'https://a.com' }), { kind: 'sheet', target: 'q1' });
    assert.deepEqual(askPanelTarget({ ...ask, kind: 'decision', url: 'https://a.com' }), { kind: 'web', target: 'https://a.com' });
    assert.equal(askPanelTarget(ask), null);
  });
});

describe('ou mene le tap sur une question', () => {
  const base = { from: 'a', message: 'Plan: 3 decisions', buttons: ['Done'], input: true, askedAtMs: 0, snoozedUntilMs: 0, due: true, waiting: true, sessionId: 's', cwd: null };
  const sheet = { ...base, id: 'q-sheet', kind: 'decision', sheet: true, url: null };
  const page = { ...base, id: 'q-page', kind: 'decision', sheet: false, url: 'https://claude.ai/artifact/x' };
  const plain = { ...base, id: 'q-plain', buttons: ['OK', 'KO'] };
  const asks = [sheet, page, plain];

  it('une fiche native va au panneau, en fiche', () => {
    assert.deepEqual(askHref('q-sheet', asks), { pathname: '/panel', params: { kind: 'sheet', target: 'q-sheet' } });
  });

  it('une fiche avec une page va au panneau, en page web', () => {
    assert.deepEqual(askHref('q-page', asks), { pathname: '/panel', params: { kind: 'web', target: 'https://claude.ai/artifact/x' } });
  });

  it('une autre question, ou une question pas encore connue, garde son ecran', () => {
    assert.equal(askHref('q-plain', asks), '/ask/q-plain');
    assert.equal(askHref('q-unknown', asks), '/ask/q-unknown');
    assert.equal(isDecisionAsk(plain), false);
  });

  it('une fiche sans page ni fiche native reste une question', () => {
    assert.equal(isDecisionAsk({ ...base, id: 'q', kind: 'decision', sheet: false, url: null }), false);
  });
});

describe('images d une option de fiche', () => {
  it('montre deux images au plus, et dit pourquoi les autres manquent', () => {
    const plan = planImages([
      { label: "Aujourd'hui", path: '/Users/me/before.PNG' },
      { label: 'Avec la decision', path: '/Users/me/after.webp' },
      { label: 'Third', path: '/Users/me/third.png' },
    ]);
    assert.deepEqual(plan.shown.map((i) => i.path), ['/Users/me/before.PNG', '/Users/me/after.webp']);
    assert.deepEqual(plan.notes, ['1 more image left out: an option shows 2 at most']);
  });

  it('laisse de cote un chemin relatif ou une extension inconnue, avec une note', () => {
    const plan = planImages([
      { label: 'Rel', path: 'shots/a.png' },
      { label: '', path: '/Users/me/doc.svg' },
    ]);
    assert.deepEqual(plan.shown, []);
    assert.deepEqual(plan.notes, [
      'Image Rel not shown: the path is not absolute',
      'Image /Users/me/doc.svg not shown: not a png, jpg, webp or gif file',
    ]);
  });

  it('dit non affichee une entree mal formee au lieu de planter', () => {
    const raw = [null, { path: 3 }] as unknown as Parameters<typeof planImages>[0];
    assert.deepEqual(planImages(raw).notes, [
      'Image image not shown: the path is not absolute',
      'Image image not shown: the path is not absolute',
    ]);
    assert.deepEqual(planImages('a.png' as unknown as Parameters<typeof planImages>[0]), { shown: [], notes: [] });
  });

  it('ne montre rien pour une option sans images', () => {
    assert.deepEqual(planImages(undefined), { shown: [], notes: [] });
  });
});
