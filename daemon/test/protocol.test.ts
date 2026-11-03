import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  answerActionId,
  categoryForPrompt,
  DEFAULT_PORT,
  isKeyName,
  KEY_NAMES,
  NOTIFICATION_ACTION,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_ACTIONS,
  parseAnswerActionId,
  type Prompt,
} from '@kovalink/protocol';

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

const parsed = (n: number): Prompt => ({
  state: 'parsed',
  paneId: 1,
  awaitingSince: '2026-09-10T10:00:00.000Z',
  question: 'q',
  detail: [],
  options: Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    label: `opt${i + 1}`,
    kind: 'neutral' as const,
  })),
  freeTextAllowed: false,
  promptHash: 'h',
  promptRef: 'r',
});

describe('catalogue des categories de notification (R1)', () => {
  it('porte le vocabulaire du PRD, qui fait foi', () => {
    assert.deepEqual(
      [...NOTIFICATION_CATEGORIES],
      [
        'KL_TURN_END',
        'KL_AWAITING_2',
        'KL_AWAITING_3',
        'KL_AWAITING_BLIND',
        'KL_DONE',
        'KL_CLOSED',
        'KL_RECONNECT',
        'KL_AGGREGATE',
        'KL_ASK',
      ],
    );
  });

  it('une question d agent n a que Ouvrir : ses boutons viennent de l agent', () => {
    assert.deepEqual(
      NOTIFICATION_CATEGORY_ACTIONS[NOTIFICATION_CATEGORY.ASK].map((a) => a.identifier),
      [NOTIFICATION_ACTION.open],
    );
  });

  it('n est redeclare nulle part dans le daemon', () => {
    for (const file of sourceFiles(SRC_DIR)) {
      const src = readFileSync(file, 'utf8');
      assert.equal(
        /['"]KL_(TURN_END|AWAITING_2|AWAITING_3|AWAITING_BLIND|DONE|CLOSED|RECONNECT|ASK)['"]/.test(src),
        false,
        `${file} redeclare un identifiant de categorie`,
      );
    }
  });

  it('une fin de tour donne KL_TURN_END', () => {
    const prompt: Prompt = {
      state: 'turn_end',
      paneId: 1,
      sessionId: 's',
      endedAt: '2026-09-10T10:00:00.000Z',
      summary: 'fini',
      subtitle: '1 min 00 s, 3 outils',
      toolCount: 3,
      durationMs: 1000,
      promptRef: 'r',
    };
    assert.equal(categoryForPrompt(prompt), 'KL_TURN_END');
  });

  it('2 et 3 options donnent les categories a chiffres, au dela on retombe aveugle', () => {
    assert.equal(categoryForPrompt(parsed(2)), 'KL_AWAITING_2');
    assert.equal(categoryForPrompt(parsed(3)), 'KL_AWAITING_3');
    assert.equal(categoryForPrompt(parsed(4)), 'KL_AWAITING_BLIND');
    assert.equal(categoryForPrompt(parsed(5)), 'KL_AWAITING_BLIND');
  });

  it('un prompt illisible ne propose jamais de bouton d option', () => {
    const prompt: Prompt = {
      state: 'unparsable',
      paneId: 1,
      awaitingSince: '2026-09-10T10:00:00.000Z',
      rawScreen: 'ecran',
      cols: 221,
      rows: 64,
      promptRef: 'r',
    };
    const category = categoryForPrompt(prompt);
    assert.equal(category, 'KL_AWAITING_BLIND');
    assert.deepEqual(
      NOTIFICATION_CATEGORY_ACTIONS[category].map((a) => a.identifier),
      [NOTIFICATION_ACTION.interrupt, NOTIFICATION_ACTION.open],
    );
  });

  it('l identifiant d action numerotee a un encodage unique et reversible', () => {
    for (const n of [1, 2, 3, 10]) {
      assert.equal(answerActionId(n), `answer:${n}`);
      assert.equal(parseAnswerActionId(answerActionId(n)), n);
    }
    // Tout ce qui n'est pas une action numerotee doit etre refuse, sans exception.
    for (const bad of ['open', 'interrupt', 'answer:', 'answer:0', 'answer:-1', 'answer:1x', '']) {
      assert.equal(parseAnswerActionId(bad), null, bad);
    }
  });

  it('Interrompre n est jamais retire et ne demande jamais d authentification', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      const actions = NOTIFICATION_CATEGORY_ACTIONS[category];
      assert.ok(actions.length <= 4, `${category} depasse le budget iOS de 4 actions`);
      const interrupt = actions.find((a) => a.identifier === 'interrupt');
      if (category.startsWith('KL_AWAITING') || category === 'KL_TURN_END') {
        assert.ok(interrupt, `${category} doit garder Interrompre`);
        assert.equal(interrupt?.authenticationRequired, false);
      }
    }
  });

  it('toute action qui repond exige Face ID', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const action of NOTIFICATION_CATEGORY_ACTIONS[category]) {
        if (parseAnswerActionId(action.identifier) !== null) {
          assert.equal(action.authenticationRequired, true, `${category}/${action.identifier}`);
        }
      }
    }
  });

  it('aucune action de saisie de texte libre depuis une banniere (C26)', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const action of NOTIFICATION_CATEGORY_ACTIONS[category]) {
        const known =
          action.identifier === NOTIFICATION_ACTION.open ||
          action.identifier === NOTIFICATION_ACTION.interrupt ||
          parseAnswerActionId(action.identifier) !== null;
        assert.equal(known, true, `action inattendue : ${action.identifier}`);
      }
    }
  });
});

describe('table de touches fermee', () => {
  it('refuse tout ce qui n est pas un KeyName', () => {
    assert.equal(isKeyName('esc'), true);
    assert.equal(isKeyName('rm -rf'), false);
    assert.equal(isKeyName('toString'), false);
    assert.equal(isKeyName(42), false);
  });

  it('la table n est declaree qu une fois, dans le protocole', () => {
    for (const file of sourceFiles(SRC_DIR)) {
      const src = readFileSync(file, 'utf8');
      assert.equal(/KEY_TABLE\s*=/.test(src), false, `${file} redeclare KEY_TABLE`);
    }
    assert.ok(KEY_NAMES.includes('esc'));
  });
});

describe('constantes partagees avec les cibles Swift', () => {
  const NSE_DIR = resolve(fileURLToPath(new URL('../../../app/targets/notification-service', import.meta.url)));

  it('le port de repli de la NSE est GENERE depuis DEFAULT_PORT, jamais ecrit en dur', () => {
    const generated = readFileSync(join(NSE_DIR, 'ProtocolConstants.swift'), 'utf8');
    assert.match(generated, new RegExp(`static let defaultPort = ${DEFAULT_PORT}\\b`));
    const nse = readFileSync(join(NSE_DIR, 'NotificationService.swift'), 'utf8');
    assert.ok(nse.includes('KovaLinkProtocol.defaultPort'), 'la NSE lit la constante generee');
    // Aucun nombre a 4 ou 5 chiffres dans la NSE : un port fantome ecrit en dur a deja
    // bloque un appairage, et il ne doit plus pouvoir revenir.
    assert.doesNotMatch(nse, /\b\d{4,5}\b/);
  });
});

// Import dynamique impose : le test compile depuis daemon/test (deux niveaux jusqu'a
// la racine) mais tourne depuis daemon/dist/test (trois niveaux). Un import statique
// ne peut pas resoudre les deux chemins a la fois.
type GeneratedTokens = {
  colors: Record<string, { dark: string; light: string }>;
  tagDots: Record<string, { dark: string; light: string }>;
};

const tokenGenerator = (await import(
  new URL('../../../packages/protocol/scripts/gen-tokens.mjs', import.meta.url).href
)) as {
  renderTs: (tokens: GeneratedTokens) => string;
  renderSwift: (tokens: GeneratedTokens) => string;
};

const generatedTokens = JSON.parse(
  readFileSync(new URL('../../../packages/protocol/tokens/ds.json', import.meta.url), 'utf8'),
) as GeneratedTokens;

describe('tokens de design generes depuis ds.json', () => {
  it('ds.ts et DSTokens.swift sur disque sont exactement le rendu de ds.json', () => {
    assert.equal(
      readFileSync(new URL('../../../app/src/theme/ds.ts', import.meta.url), 'utf8'),
      tokenGenerator.renderTs(generatedTokens),
    );
    assert.equal(
      readFileSync(new URL('../../../app/targets/watch/DSTokens.swift', import.meta.url), 'utf8'),
      tokenGenerator.renderSwift(generatedTokens),
    );
  });

  it('chaque couleur de ds.json est un hex opaque ou un rgba', () => {
    const pattern = /^#[0-9A-Fa-f]{6}$|^rgba\(/;
    for (const [name, color] of Object.entries(generatedTokens.colors)) {
      assert.match(color.dark, pattern, `${name} (dark)`);
      assert.match(color.light, pattern, `${name} (light)`);
    }
    for (const [name, color] of Object.entries(generatedTokens.tagDots)) {
      assert.match(color.dark, pattern, `${name} (dark)`);
      assert.match(color.light, pattern, `${name} (light)`);
    }
  });
});
