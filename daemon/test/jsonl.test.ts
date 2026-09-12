import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexToolResults } from '@kovalink/protocol';
import {
  analyzeTurnEnd,
  buildTurns,
  permissionModeOf,
  safeParseLine,
  sortAssistantBlocks,
  type RawLine,
} from '../src/transcript/jsonl.js';

function assistant(
  requestId: string,
  apiBlockIndex: number,
  content: unknown[],
  stop: string | null = 'tool_use',
  ts = '2026-09-10T10:00:00.000Z',
): RawLine {
  return {
    type: 'assistant',
    uuid: `${requestId}-${apiBlockIndex}`,
    requestId,
    apiBlockIndex,
    timestamp: ts,
    isSidechain: false,
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: stop,
      content,
      usage: {
        input_tokens: 2,
        output_tokens: 704,
        cache_read_input_tokens: 247_774,
        cache_creation_input_tokens: 4716,
      },
    },
  };
}

function user(content: unknown, uuid = 'u1'): RawLine {
  return {
    type: 'user',
    uuid,
    timestamp: '2026-09-10T09:59:00.000Z',
    isSidechain: false,
    message: { role: 'user', content },
  };
}

describe('parseur JSONL', () => {
  it('ignore une ligne illisible sans lever', () => {
    assert.equal(safeParseLine('{pas du json'), null);
    assert.equal(safeParseLine(''), null);
    assert.equal(safeParseLine('123'), null);
  });

  it('regroupe les lignes assistant par requestId, de 1 a 5 blocs', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const lines = Array.from({ length: n }, (_, i) =>
        assistant('req_A', i, [{ type: 'text', text: `bloc ${i}` }]),
      );
      const turns = buildTurns(sortAssistantBlocks(lines));
      assert.equal(turns.length, 1, `${n} lignes doivent donner une seule bulle`);
      assert.equal(turns[0]?.blocks.length, n);
    }
  });

  it('ordonne par apiBlockIndex, pas par ordre d arrivee ni par timestamp', () => {
    const lines = [
      assistant('req_A', 2, [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
      assistant('req_A', 0, [{ type: 'thinking', thinking: '', signature: 'op' }]),
      assistant('req_A', 1, [{ type: 'text', text: 'je lis le fichier' }]),
    ];
    const turns = buildTurns(sortAssistantBlocks(lines));
    assert.deepEqual(
      turns[0]?.blocks.map((b) => b.type),
      ['thinking', 'text', 'tool_use'],
    );
  });

  it('ne somme jamais usage, repete a l identique sur chaque ligne du groupe', () => {
    const lines = [
      assistant('req_A', 0, [{ type: 'text', text: 'a' }]),
      assistant('req_A', 1, [{ type: 'text', text: 'b' }]),
      assistant('req_A', 2, [{ type: 'text', text: 'c' }]),
    ];
    const turns = buildTurns(sortAssistantBlocks(lines));
    assert.equal(turns[0]?.usage?.output, 704);
    assert.equal(turns[0]?.usage?.cacheRead, 247_774);
  });

  it('discrimine message humain et retour d outil par la forme du contenu', () => {
    const turns = buildTurns([
      user('lance les tests', 'u1'),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }], 'u2'),
    ]);
    assert.equal(turns[0]?.kind, 'user');
    assert.equal(turns[1]?.kind, 'tool_result');
  });

  /**
   * Contrat F1 : le daemon emet les resultats dans des turns `tool_result` separes,
   * chacun portant `toolUseId`, et l'app fait la jointure avec `indexToolResults`.
   * Symptome a faire disparaitre : bloc d'outil deplie vide et « en cours » permanent.
   */
  describe('rattachement des tool_result (contrat F1)', () => {
    const lines = [
      user('lance les tests', 'u1'),
      assistant('req_A', 0, [{ type: 'text', text: 'Je lance.' }]),
      assistant('req_A', 1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }]),
      assistant('req_A', 2, [{ type: 'tool_use', id: 't2', name: 'Read', input: { file: 'a.ts' } }]),
      user([{ type: 'tool_result', tool_use_id: 't1', content: '221 pass', is_error: false }], 'u2'),
      user([{ type: 'tool_result', tool_use_id: 't2', content: 'ENOENT', is_error: true }], 'u3'),
      assistant('req_B', 0, [{ type: 'text', text: 'Fait.' }], 'end_turn'),
    ];

    it('un turn assistant ne contient jamais de tool_result, meme si le JSONL en glisse un', () => {
      const polluted = [
        assistant('req_X', 0, [
          { type: 'tool_use', id: 't9', name: 'Bash', input: {} },
          { type: 'tool_result', tool_use_id: 't9', content: 'inattendu' },
        ]),
      ];
      const turns = buildTurns(sortAssistantBlocks(polluted));
      assert.equal(turns.length, 1);
      assert.deepEqual(
        turns[0]?.blocks.map((b) => b.type),
        ['tool_use'],
      );
    });

    it('chaque tool_use trouve son resultat par toolUseId, avec is_error', () => {
      const turns = buildTurns(sortAssistantBlocks(lines));
      const results = indexToolResults(turns);
      const calls = turns.flatMap((t) =>
        t.kind === 'assistant' ? t.blocks.filter((b) => b.type === 'tool_use') : [],
      );
      assert.equal(calls.length, 2);
      const r1 = results.get('t1');
      const r2 = results.get('t2');
      assert.ok(r1 && r2, 'les deux resultats doivent etre joints');
      assert.equal(r1.preview, '221 pass');
      assert.equal(r1.isError, false);
      assert.equal(r2.preview, 'ENOENT');
      assert.equal(r2.isError, true);
    });

    it('un tool_use sans resultat reste absent de l index : c est lui qui est en cours', () => {
      const turns = buildTurns(sortAssistantBlocks(lines.slice(0, 5)));
      const results = indexToolResults(turns);
      assert.ok(results.has('t1'));
      assert.equal(results.has('t2'), false);
    });

    it('la jointure ne depend pas de l ordre des turns ni des reprises partielles', () => {
      const turns = buildTurns(sortAssistantBlocks(lines));
      const shuffled = [...turns].reverse();
      assert.equal(indexToolResults(shuffled).get('t2')?.isError, true);
    });
  });

  it('ignore queue-operation et tout type inconnu, sans erreur', () => {
    const turns = buildTurns([
      { type: 'queue-operation', operation: 'add', content: null } as RawLine,
      { type: 'attachment' } as RawLine,
      { type: 'un-type-du-futur', payload: 42 } as RawLine,
      { type: 'system', subtype: 'turn_duration', durationMs: 1000 } as RawLine,
      user('bonjour'),
    ]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.kind, 'user');
  });

  it('un message absorbe en cours de tour (attachment queued_command) est un tour user', () => {
    const turns = buildTurns([
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], 'r1'),
      {
        type: 'attachment',
        uuid: 'q1',
        timestamp: '2026-09-12T13:11:07.885Z',
        attachment: {
          type: 'queued_command',
          prompt: 'Tu peux envoyer le message',
          commandMode: 'prompt',
          origin: { kind: 'human' },
          timestamp: '2026-09-12T13:11:07.885Z',
        },
      } as RawLine,
      // Retour de sous-agent : pas un message de Robin.
      {
        type: 'attachment',
        uuid: 'q2',
        attachment: { type: 'queued_command', prompt: '<task-notification>x</task-notification>', commandMode: 'task-notification' },
      } as RawLine,
      // Un autre attachment : ignore comme avant.
      { type: 'attachment', uuid: 'q3', attachment: { type: 'total_tokens_reminder' } } as RawLine,
    ]);
    assert.deepEqual(
      turns.map((t) => [t.kind, t.id]),
      [
        ['tool_result', 'r1'],
        ['user', 'q1'],
      ],
    );
    assert.deepEqual(turns[1]?.blocks, [{ type: 'text', text: 'Tu peux envoyer le message' }]);
  });

  it('un message absorbe avec image garde son texte et la presence de l image', () => {
    const turns = buildTurns([
      {
        type: 'attachment',
        uuid: 'q4',
        attachment: {
          type: 'queued_command',
          prompt: [
            { type: 'text', text: '[Image #1]' },
            { type: 'image', source: { type: 'base64', data: 'xxxx' } },
          ],
          origin: { kind: 'human' },
        },
      } as RawLine,
    ]);
    assert.deepEqual(turns[0]?.blocks, [{ type: 'text', text: '[Image #1]' }, { type: 'image', mediaType: null }]);
  });

  it('le seq est l offset de la ligne quand le lecteur l a pose, un compteur sinon', () => {
    const withOffsets = buildTurns([
      { ...user('a', 'u1'), offset: 1200 },
      { ...assistant('req_Z', 0, [{ type: 'text', text: 'b' }]), offset: 1800 },
    ]);
    assert.deepEqual(withOffsets.map((t) => t.seq), [1200, 1800]);
    const counted = buildTurns([user('a', 'u1'), user('b', 'u2')], 7);
    assert.deepEqual(counted.map((t) => t.seq), [7, 8]);
  });

  it('une image collee devient un bloc image sans octets, le tour reste user (19:09, IMG_5369)', () => {
    const turns = buildTurns([
      user(
        [
          { type: 'text', text: '[Image #4]Affiche les tableaux dans le chat' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'x'.repeat(1000) } },
        ],
        'u-img',
      ),
    ]);
    assert.equal(turns[0]?.kind, 'user');
    assert.deepEqual(turns[0]?.blocks, [
      { type: 'text', text: '[Image #4]Affiche les tableaux dans le chat' },
      { type: 'image', mediaType: 'image/jpeg' },
    ]);
    assert.equal(JSON.stringify(turns).includes('xxxx'), false, 'jamais les octets');
  });

  it('les blocs thinking ne transportent aucun texte', () => {
    const turns = buildTurns([
      assistant('req_A', 0, [{ type: 'thinking', thinking: 'secret', signature: 'x' }]),
    ]);
    assert.deepEqual(turns[0]?.blocks, [{ type: 'thinking' }]);
  });

  it('un tool_result tronque n est jamais annonce comme recuperable (V12)', () => {
    const turns = buildTurns([
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000) }], 'u9'),
    ]);
    const block = turns[0]?.blocks[0];
    assert.equal(block?.type, 'tool_result');
    if (block?.type === 'tool_result') {
      assert.equal(block.truncated, true);
      assert.equal(block.retrievable, false);
    }
  });

  it('lit le dernier permissionMode pour le badge bypass', () => {
    const mode = permissionModeOf([
      { type: 'permission-mode', permissionMode: 'default' } as RawLine,
      { type: 'permission-mode', permissionMode: 'bypassPermissions' } as RawLine,
    ]);
    assert.equal(mode, 'bypassPermissions');
  });
});

describe('confirmation de fin de tour par le JSONL (D1)', () => {
  it('tour clos : stop_reason end_turn et aucun tool_use en attente', () => {
    const a = analyzeTurnEnd([
      user('corrige les tests'),
      assistant('req_A', 0, [{ type: 'text', text: 'Tout passe.' }], 'end_turn'),
    ]);
    assert.equal(a.closed, true);
    assert.equal(a.summary, 'Tout passe.');
  });

  it('tour non clos : le dernier bloc est un tool_use sans resultat', () => {
    const a = analyzeTurnEnd([
      user('corrige les tests'),
      assistant('req_A', 0, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], 'tool_use'),
    ]);
    assert.equal(a.closed, false);
  });

  it('un outil long qui rend la main brievement ne compte pas comme une fin de tour', () => {
    const a = analyzeTurnEnd([
      user('lance la suite'),
      assistant('req_A', 0, [{ type: 'text', text: 'je lance' }], 'tool_use'),
      assistant('req_A', 1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], 'tool_use'),
    ]);
    assert.equal(a.closed, false, 'le front descendant seul ne suffit pas');
  });

  it('un tool_use resolu puis un end_turn donne bien un tour clos', () => {
    const a = analyzeTurnEnd([
      user('lance la suite'),
      assistant('req_A', 0, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], 'tool_use'),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], 'u2'),
      assistant('req_B', 0, [{ type: 'text', text: '11 tests passent.' }], 'end_turn'),
    ]);
    assert.equal(a.closed, true);
    assert.equal(a.toolCount, 1);
    assert.equal(a.summary, '11 tests passent.');
  });

  it('tronque le resume a 140 caracteres', () => {
    const a = analyzeTurnEnd([
      user('vas-y'),
      assistant('req_A', 0, [{ type: 'text', text: 'x'.repeat(500) }], 'end_turn'),
    ]);
    assert.equal(a.summary.length, 140);
  });
});
