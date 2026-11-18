// Le contrat des gestes que la file (`attn`) et Kova lisent aussi
// (`claude-config/tests/fixtures/gestures-contract.json`) : un nom, une option ou un code
// de sortie change d'un cote casse ce test. Chemin par `KOVALINK_GESTURES_CONTRACT`, sinon
// celui du harnais de Robin s'il existe ; sans fichier, le test le dit et ne verifie rien.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ATTENTION_GESTURES, ATTENTION_UNCERTAIN_WORDS, gestureFilesCard, gestureTakesText } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-contract-'));
process.env['KOVALINK_QUIET'] = '1';

const {
  AttentionError,
  CARD_SEEN,
  EXIT_CARD_CHANGED,
  EXIT_DELIVERED,
  EXIT_NOTED,
  EXIT_REFUSED,
  checkGesture,
  gestureArgv,
  gestureOutcome,
  checkUncertain,
  toAttentionEntry,
  uncertainArgv,
} = await import('../src/attention.js');

const CONTRACT_PATH =
  process.env['KOVALINK_GESTURES_CONTRACT'] ??
  join(homedir(), 'AI directory', 'claude-config', 'tests', 'fixtures', 'gestures-contract.json');
const present = existsSync(CONTRACT_PATH);
if (!present) {
  // Visible dans la sortie de `npm test` : le contrat n'a pas ete verifie.
  console.log(`# contrat des gestes absent (${CONTRACT_PATH}) : test saute`);
}

interface GestureSpec {
  argv: string[];
  text: 'required' | 'optional' | 'none';
  options?: string[];
  closes_card: boolean;
}
interface Contract {
  always: string[];
  gestures: Record<string, GestureSpec>;
  exit_codes: Record<string, string>;
  card_fields: Record<string, unknown>;
  card_seen?: { flag: string; field: string; refused_exit_code: number };
  uncertain?: string;
}

const CARD = 'a-36d0b2';
const CID = '0b5c1c2e-1111-4222-8333-444455556666';
const SEEN = '0123456789abcdef';
const CARD_FP = 'fedcba9876543210';

/** Ce que le daemon accepte pour ce geste, ou `null` s'il le refuse avant de lancer. */
function argvOf(word: string, extra: Record<string, unknown>): string[] | null {
  try {
    return gestureArgv(CARD, { ...checkGesture({ gesture: word, ...extra }), clientId: CID });
  } catch (e) {
    if (e instanceof AttentionError && e.reason === 'bad_request') return null;
    throw e;
  }
}

/** Le code de sortie d'attn -> ce que le daemon en dit. */
function outcomeOf(code: number): string {
  try {
    return gestureOutcome({ code, stdout: '', stderr: 'pourquoi\n' }).outcome;
  } catch (e) {
    return e instanceof AttentionError ? e.reason : 'throw';
  }
}

describe('contrat des gestes de la file', { skip: present ? false : `contrat absent : ${CONTRACT_PATH}` }, () => {
  const contract = (present ? JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) : {}) as Contract;

  it('les sept mots, de part et d autre', () => {
    assert.deepEqual([...ATTENTION_GESTURES].sort(), Object.keys(contract.gestures).sort());
  });

  for (const word of ATTENTION_GESTURES) {
    it(`${word} : argv, texte, options, drapeaux de chaque clic`, () => {
      const spec = contract.gestures[word];
      assert.ok(spec, `${word} est dans le contrat`);
      const options = spec.options ?? [];
      const full = argvOf(word, {
        ...(spec.text === 'none' ? {} : { text: 'un texte' }),
        ...(options.includes('--seen') ? { seen: SEEN } : {}),
        ...(options.includes('--draft') ? { draft: 'un brouillon' } : {}),
        cardSeen: CARD_FP,
      });
      assert.ok(full, `${word} a un argv`);
      // Le verbe, puis la carte et le mot, positionnels, dans l'ordre du contrat ;
      // `--by robin` est l'`act_command` de Kova, sa valeur n'est pas positionnelle.
      const positional = full.filter((a, i) => !a.startsWith('--') && full[i - 1] !== '--by');
      assert.deepEqual(
        positional,
        spec.argv.map((w) => (w === '<card>' ? CARD : w)),
      );
      for (const flag of contract.always) {
        assert.ok(
          full.some((a) => a === flag || a.startsWith(`${flag}=`)),
          `${word} porte ${flag}`,
        );
      }
      const texted = full.some((a) => a.startsWith('--text='));
      if (spec.text === 'none') {
        assert.equal(gestureTakesText(word), false);
        assert.equal(argvOf(word, { text: 'un texte' }), null, `${word} refuse un texte`);
        assert.ok(argvOf(word, {}), `${word} part sans texte`);
      } else if (spec.text === 'optional') {
        assert.ok(texted && gestureTakesText(word), `${word} porte un texte`);
        assert.ok(argvOf(word, {}), `${word} part sans texte`);
      } else if (spec.text === 'required') {
        assert.ok(texted && gestureTakesText(word), `${word} porte un texte`);
        assert.equal(argvOf(word, {}), null, `${word} exige son texte`);
      } else {
        assert.fail(`${word} : texte ${String(spec.text)} inconnu du daemon`);
      }
      // `--seen` et `--draft` seulement sur les gestes qui les listent : ailleurs, refuses.
      for (const [flag, field, value] of [
        ['--seen', 'seen', SEEN],
        ['--draft', 'draft', 'un brouillon'],
      ] as const) {
        const listed = options.includes(flag);
        assert.equal(
          full.some((a) => a.startsWith(`${flag}=`)),
          listed,
          `${word} et ${flag}`,
        );
        if (!listed) assert.equal(argvOf(word, { [field]: value }), null, `${word} refuse ${flag}`);
      }
      assert.equal(gestureFilesCard(word), spec.closes_card, `${word} classe la carte`);
    });
  }

  it('les codes de sortie, chacun lu comme le contrat le dit', () => {
    assert.deepEqual(Object.keys(contract.exit_codes).sort(), ['0', '3', '4', '5']);
    assert.equal(String(EXIT_DELIVERED), '0');
    assert.equal(String(EXIT_NOTED), '3');
    assert.equal(String(EXIT_REFUSED), '4');
    assert.equal(String(EXIT_CARD_CHANGED), '5');
    assert.match(contract.exit_codes['0'] ?? '', /delivered/);
    assert.equal(outcomeOf(0), 'delivered');
    assert.match(contract.exit_codes['3'] ?? '', /pending/);
    assert.equal(outcomeOf(3), 'noted');
    assert.match(contract.exit_codes['4'] ?? '', /refused/);
    assert.equal(outcomeOf(4), 'refused');
    assert.match(contract.exit_codes['5'] ?? '', /card/);
    assert.equal(outcomeOf(5), 'card_changed');
  });

  it('l empreinte de la carte : son drapeau sur chaque geste, son code, son champ', () => {
    const card = contract.card_seen;
    assert.ok(card, 'le contrat nomme card_seen');
    assert.equal(card.flag, CARD_SEEN);
    assert.equal(card.field, 'card_seen');
    assert.equal(card.refused_exit_code, EXIT_CARD_CHANGED);
    for (const word of ATTENTION_GESTURES) {
      const argv = argvOf(word, { ...(word === 'ask' ? { text: 't' } : {}), cardSeen: CARD_FP });
      assert.ok(argv?.includes(`${CARD_SEEN}=${CARD_FP}`), `${word} porte l empreinte`);
    }
    const entry = toAttentionEntry({ id: CARD, ts: '2026-11-05T16:22:48+01:00', level: 'now', title: 't', [card.field]: CARD_FP });
    assert.equal(entry?.cardSeen, CARD_FP);
  });

  it('carte incertaine : aucun geste liste, les deux mots que Kova garde', () => {
    const sentence = contract.uncertain ?? '';
    assert.match(sentence, /gestures is empty/);
    for (const word of ATTENTION_UNCERTAIN_WORDS) {
      // Le contrat les ecrit `act <card> <mot>` : memes positionnels ici.
      assert.ok(sentence.includes(`act <card> ${word}`), `le contrat nomme ${word}`);
      const argv = uncertainArgv(CARD, checkUncertain({ gesture: word }));
      assert.deepEqual(
        argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--by'),
        ['act', CARD, word],
      );
      assert.ok(argv.includes('--exit-codes'));
      assert.equal((ATTENTION_GESTURES as readonly string[]).includes(word), false, 'pas un des sept');
    }
  });

  it('les champs de carte du contrat passent jusqu a l app', () => {
    const fields = contract.card_fields;
    assert.deepEqual(Object.keys(fields).sort(), ['ask', 'gestures', 'go_label', 'waiting']);
    const goLabels = fields['go_label'] as string[];
    const waitings = fields['waiting'] as string[];
    const askFields = (fields['ask'] as { fields: string[] }).fields;
    for (const goLabel of goLabels) {
      for (const waiting of waitings) {
        const ask = Object.fromEntries(askFields.map((f) => [f, f === 'ts' ? '2026-11-05T16:30:00+01:00' : `v-${f}`]));
        const e = toAttentionEntry({
          id: CARD,
          ts: '2026-11-05T16:22:48+01:00',
          level: 'now',
          title: 't',
          gestures: [...ATTENTION_GESTURES],
          go_label: goLabel,
          waiting,
          ask,
        });
        assert.ok(e);
        assert.deepEqual(e.gestures, [...ATTENTION_GESTURES]);
        assert.equal(e.goLabel, goLabel);
        assert.equal(e.waiting, waiting);
        // `ask` est nul sauf quand la carte attend l'agent.
        if (waiting === 'agent') assert.equal(e.ask?.text, 'v-text');
        else assert.equal(e.ask, undefined);
      }
    }
  });
});
