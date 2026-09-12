// Markdown des tours assistant : le tableau exact de la capture du 12 septembre (8 lignes,
// 2 colonnes) devient un bloc `table`, et chaque construction que l'assistant produit a
// son bloc. Analyse pure, sans React.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMarkdown, plainText } from '@/features/chat/markdownAst';

const CAPTURE = `Voici ce qui a été corrigé, sans un seul build :

| Retour | Correction |
|---|---|
| Messages collés en bas | Numéros de séquence stables, messages mis en file par Claude Code rendus |
| Message tapé mais pas envoyé | Claude Code avale l'Entrée pendant 300 à 700 ms après un collage d'image : le daemon attend et vérifie |
| Message disparu sans erreur | Le composer vidait le champ avant l'envoi : le texte revient avec la cause |
| Brouillon perdu | Persisté par pane, survit à la fermeture |
| Mauvais noms d'onglets | Jointure sur l'index et non l'identifiant, titres en direct |
| Onglets manquants | Plus aucun filtre, shells et sessions périmées inclus |
| Cmd+O et Cmd+P | Deux palettes plein écran, recherche active d'emblée |
| Ouvrir sur mobile = ouvrir sur Mac | Bascule automatique, réglage pour la couper |

424 tests daemon, 102 tests app.`;

describe('parseMarkdown', () => {
  it('le tableau de la capture donne un bloc table à 2 colonnes et 8 lignes, pas du texte', () => {
    const blocks = parseMarkdown(CAPTURE);
    assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'table', 'paragraph']);
    const table = blocks[1];
    assert.ok(table && table.type === 'table');
    if (table.type !== 'table') return;
    assert.deepEqual(table.header.map(plainText), ['Retour', 'Correction']);
    assert.equal(table.rows.length, 8);
    assert.deepEqual(table.rows[0]?.map(plainText), ['Messages collés en bas', 'Numéros de séquence stables, messages mis en file par Claude Code rendus']);
    assert.deepEqual(table.rows[7]?.map(plainText), ['Ouvrir sur mobile = ouvrir sur Mac', 'Bascule automatique, réglage pour la couper']);
    assert.deepEqual(table.align, [null, null]);
  });

  it('respecte l’alignement des colonnes', () => {
    const [t] = parseMarkdown('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    assert.ok(t && t.type === 'table');
    if (t.type === 'table') assert.deepEqual(t.align, ['left', 'center', 'right']);
  });

  it('gras, italique, code en ligne, barré, lien et URL nue en spans', () => {
    const [p] = parseMarkdown('**gras** *ital* `code` ~~barré~~ [lien](https://kova.app) https://claap.io');
    assert.ok(p && p.type === 'paragraph');
    if (p.type !== 'paragraph') return;
    const find = (text: string) => p.spans.find((s) => s.text === text);
    assert.equal(find('gras')?.bold, true);
    assert.equal(find('ital')?.italic, true);
    assert.equal(find('code')?.code, true);
    assert.equal(find('barré')?.strike, true);
    assert.equal(find('lien')?.href, 'https://kova.app');
    assert.equal(find('https://claap.io')?.href, 'https://claap.io');
  });

  it('titres, listes imbriquées et numérotées, bloc de code avec langage, citation, filet', () => {
    const blocks = parseMarkdown('## Titre\n\n- un\n  - deux\n3. trois\n\n```ts\nconst a = 1;\n```\n\n> citation\n\n---\n');
    assert.deepEqual(blocks.map((b) => b.type), ['heading', 'list', 'list', 'code', 'quote', 'hr']);
    const [h, ul, ol, code] = blocks;
    if (h?.type === 'heading') assert.equal(h.level, 2);
    if (ul?.type === 'list') {
      assert.equal(ul.ordered, false);
      const nested = ul.items[0]?.[1];
      assert.equal(nested?.type, 'list');
      const first = nested?.type === 'list' ? nested.items[0]?.[0] : undefined;
      assert.ok(first && first.type === 'paragraph');
      if (first?.type === 'paragraph') assert.equal(plainText(first.spans), 'deux');
    }
    if (ol?.type === 'list') {
      assert.equal(ol.ordered, true);
      assert.equal(ol.start, 3);
    }
    if (code?.type === 'code') {
      assert.equal(code.lang, 'ts');
      assert.equal(code.code, 'const a = 1;');
    }
  });

  it('un texte brut sans markdown reste un paragraphe, et jamais une exception', () => {
    const blocks = parseMarkdown('OK.');
    assert.deepEqual(blocks, [{ type: 'paragraph', spans: [{ text: 'OK.' }] }]);
    assert.equal(parseMarkdown('').length, 0);
  });
});
