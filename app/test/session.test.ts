// `withoutEchoed` et `merge` : deux fonctions pures qui ont chacune porté un bug visible.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexToolResults, type Turn } from '@kovalink/protocol';
import {
  cacheSlice,
  EXCHANGES_KEPT,
  recentExchanges,
  merge,
  toolCallIds,
  unconfirmed,
  withoutEchoed,
  type PendingMessage,
} from '@/store/session';

function turn(partial: Partial<Turn> & { id: string; seq: number }): Turn {
  return {
    kind: 'user',
    ts: '2026-09-10T10:00:00.000Z',
    uuids: [],
    blocks: [{ type: 'text', text: 'bonjour' }],
    isSidechain: false,
    ...partial,
  };
}

function pendingMsg(partial: Partial<PendingMessage> & { nonce: string }): PendingMessage {
  return {
    text: 'bonjour',
    state: 'sent',
    ts: '2026-09-10T10:00:00.000Z',
    afterSeq: 4,
    sessionId: 's1',
    ...partial,
  };
}

describe('withoutEchoed', () => {
  it("reproduit le doublon d'hier : l'écho arrive, la bulle locale disparaît", () => {
    // La bulle « en cours d'envoi » restait affichée pour toujours, et le transcript rendait
    // le même message quelques centaines de millisecondes plus tard : deux bulles identiques.
    const local = [pendingMsg({ nonce: 'n1', text: 'lance les tests' })];
    const before = [turn({ id: 'u1', seq: 4, blocks: [{ type: 'text', text: 'salut' }] })];
    assert.deepEqual(withoutEchoed(local, before, 's1'), local, 'sans écho, la bulle reste');

    const echoed = [...before, turn({ id: 'u2', seq: 5, blocks: [{ type: 'text', text: 'lance les tests' }] })];
    assert.deepEqual(withoutEchoed(local, echoed, 's1'), [], "l'écho consomme la bulle");
  });

  it('ne confond pas un message identique envoyé plus tôt dans la session', () => {
    const local = [pendingMsg({ nonce: 'n1', text: 'oui', afterSeq: 7, ts: '2026-09-10T10:00:00.000Z' })];
    const older = [
      turn({ id: 'u1', seq: 3, ts: '2026-09-10T09:58:00.000Z', blocks: [{ type: 'text', text: 'oui' }] }),
    ];
    assert.equal(withoutEchoed(local, older, 's1').length, 1, 'un tour antérieur à afterSeq ne compte pas');
  });

  describe('capture du 12 septembre : trois bulles jamais remplacées', () => {
    // Les trois messages, tels que Claude Code les a enregistrés (texte identique octet
    // pour octet, apostrophe typographique comprise). Le daemon d'alors renumérotait les
    // tours à chaque `session.attach` : après quatre reconnexions, l'écho de chaque
    // message portait un `seq` INFÉRIEUR au `afterSeq` noté à l'envoi, et le troisième,
    // absorbé en cours de tour, n'existait même pas comme tour `user`.
    const bubbles = [
      pendingMsg({ nonce: 'b1', text: 'C’est nettoyé ?', state: 'queued', ts: '2026-09-12T12:48:10.000Z', afterSeq: 195 }),
      pendingMsg({ nonce: 'b2', text: 'Recrée un unique commit', ts: '2026-09-12T13:10:26.234Z', afterSeq: 197 }),
      pendingMsg({ nonce: 'b3', text: 'Tu peux envoyer le message à Thomas ok', ts: '2026-09-12T13:11:07.884Z', afterSeq: 203 }),
    ];
    // Le snapshot reçu à 13:14:42 par l'ancien daemon : numérotation repartie de zéro,
    // d'où des `seq` sous les bornes.
    const oldNumbering = [
      turn({ id: '9ed2d009', seq: 186, ts: '2026-09-12T12:50:34.559Z', blocks: [{ type: 'text', text: 'C’est nettoyé ?' }] }),
      turn({ id: 'a1', seq: 187, kind: 'assistant', ts: '2026-09-12T12:51:10.325Z', blocks: [{ type: 'text', text: 'Oui.' }] }),
      turn({ id: '9500d7de', seq: 190, ts: '2026-09-12T13:10:26.974Z', blocks: [{ type: 'text', text: 'Recrée un unique commit' }] }),
      turn({ id: 'a2', seq: 191, kind: 'assistant', ts: '2026-09-12T13:11:40.000Z', blocks: [{ type: 'text', text: 'Fait.' }] }),
    ];

    it('avec la numérotation instable, les deux premiers échos sont reconnus par l’heure', () => {
      const kept = withoutEchoed(bubbles, oldNumbering, 's1');
      assert.deepEqual(kept.map((m) => m.nonce), ['b3'], 'seul le message absorbé, sans tour, reste');
    });

    it('avec le daemon corrigé, le message absorbé arrive comme tour user et la dernière bulle disparaît', () => {
      const fixed = [
        ...oldNumbering,
        turn({ id: '21761428', seq: 9415554, ts: '2026-09-12T13:11:07.885Z', blocks: [{ type: 'text', text: 'Tu peux envoyer le message à Thomas ok' }] }),
      ];
      assert.deepEqual(withoutEchoed(bubbles, fixed, 's1'), []);
    });

    it('une bulle mise en file pendant le sommeil du Mac reconnaît son écho envoyé deux minutes plus tard', () => {
      const queued = [pendingMsg({ nonce: 'q', text: 'C’est nettoyé ?', state: 'queued', ts: '2026-09-12T12:48:10.000Z', afterSeq: 9_000_000 })];
      const echo = [turn({ id: 'u', seq: 9376640, ts: '2026-09-12T12:50:34.559Z', blocks: [{ type: 'text', text: 'C’est nettoyé ?' }] })];
      assert.deepEqual(withoutEchoed(queued, echo, 's1'), []);
    });
  });

  describe('capture du 12 septembre à 19:09 : doublon avec pièce jointe', () => {
    // Ligne `user` réelle (uuid et image anonymisés) : Claude Code a REMPLACÉ la ligne de
    // chemin envoyée par l'app par un bloc `image`, et préfixé le texte de `[Image #4]`
    // sans espace. L'app avait envoyé (audit, len=97) le texte, un saut de ligne, et
    // `/tmp/kovalink/attachments/18567852/20260912-190911-IMG_5369.png`.
    const realTurn = turn({
      id: '7d1f1c1e',
      seq: 9_990_000,
      ts: '2026-09-12T17:09:13.256Z',
      blocks: [
        { type: 'text', text: '[Image #4]Affiche les tableaux dans le chat' },
        { type: 'image', mediaType: 'image/jpeg' },
      ],
    });
    const piece = {
      id: 'a1',
      uri: 'file:///var/mobile/IMG_5369.png',
      name: 'IMG_5369.png',
      size: 335_541,
      mime: 'image/png',
      path: '/tmp/kovalink/attachments/18567852/20260912-190911-IMG_5369.png',
    };
    const bubble = pendingMsg({
      nonce: 'p1',
      text: 'Affiche les tableaux dans le chat',
      ts: '2026-09-12T17:09:13.295Z',
      afterSeq: 9_980_000,
      attachments: [piece],
    });

    it('la bulle locale est retirée quand le tour réel porte le texte préfixé et un bloc image', () => {
      assert.deepEqual(withoutEchoed([bubble], [realTurn], 's1'), []);
    });

    it('un tour au même texte SANS image ne vaut pas écho d’un message avec pièce', () => {
      const noImage = turn({ id: 'x', seq: 9_990_001, ts: '2026-09-12T17:09:13.256Z', blocks: [{ type: 'text', text: 'Affiche les tableaux dans le chat' }] });
      assert.equal(withoutEchoed([bubble], [noImage], 's1').length, 1);
    });

    it('une photo seule, sans légende, se reconnaît par le compte de pièces et la borne temporelle', () => {
      const photoOnly = pendingMsg({ nonce: 'p2', text: '', ts: '2026-09-12T17:20:00.000Z', afterSeq: 9_990_000, attachments: [piece] });
      const echo = turn({ id: 'y', seq: 9_995_000, ts: '2026-09-12T17:20:01.000Z', blocks: [{ type: 'text', text: '[Image #5]' }, { type: 'image', mediaType: 'image/png' }] });
      assert.deepEqual(withoutEchoed([photoOnly], [echo], 's1'), []);
      // Mais pas un tour antérieur à l'envoi, même avec une image.
      const before = turn({ id: 'z', seq: 9_985_000, ts: '2026-09-12T17:00:00.000Z', blocks: [{ type: 'text', text: '[Image #3]' }, { type: 'image', mediaType: 'image/png' }] });
      assert.equal(withoutEchoed([photoOnly], [before], 's1').length, 1);
    });

    it('un fichier non image garde sa ligne de chemin : elle doit être celle de la pièce', () => {
      const doc = { ...piece, id: 'd1', name: 'notes.pdf', mime: 'application/pdf', path: '/tmp/kovalink/attachments/18567852/20260912-190911-notes.pdf' };
      const msg = pendingMsg({ nonce: 'p3', text: 'lis ça', ts: '2026-09-12T17:30:00.000Z', afterSeq: 1, attachments: [doc] });
      const good = turn({ id: 'g', seq: 2, ts: '2026-09-12T17:30:01.000Z', blocks: [{ type: 'text', text: `lis ça\n${doc.path}` }] });
      const other = turn({ id: 'o', seq: 2, ts: '2026-09-12T17:30:01.000Z', blocks: [{ type: 'text', text: 'lis ça\n/tmp/kovalink/attachments/18567852/autre.pdf' }] });
      assert.deepEqual(withoutEchoed([msg], [good], 's1'), []);
      assert.equal(withoutEchoed([msg], [other], 's1').length, 1);
    });
  });

  it('compare une forme canonique : NFC, retours à la ligne, espaces multiples, marqueur d’image', () => {
    const local = [pendingMsg({ nonce: 'n1', text: 'Recre\u0301e  un unique\r\ncommit ' })];
    const echo = [turn({ id: 'u1', seq: 9, blocks: [{ type: 'text', text: '[Image #1]Recrée un unique\ncommit' }] })];
    assert.deepEqual(withoutEchoed(local, echo, 's1'), []);
  });

  it('seconde passe : un tour postérieur qui CONTIENT le texte de Robin vaut écho', () => {
    const local = [pendingMsg({ nonce: 'n1', text: 'regarde ce fichier' })];
    const echo = [
      turn({ id: 'u1', seq: 9, blocks: [{ type: 'text', text: 'regarde ce fichier\n[Image: source: /tmp/kovalink/a.png]' }] }),
    ];
    assert.deepEqual(withoutEchoed(local, echo, 's1'), []);
    // Mais jamais un tour ANTÉRIEUR à l'envoi.
    const before = [
      turn({ id: 'u0', seq: 1, ts: '2026-09-10T09:00:00.000Z', blocks: [{ type: 'text', text: 'regarde ce fichier stp' }] }),
    ];
    assert.equal(withoutEchoed(local, before, 's1').length, 1);
  });

  it('la passe exacte a priorité : deux bulles, un écho exact et un écho élargi, chacune la sienne', () => {
    const local = [
      pendingMsg({ nonce: 'n1', text: 'ok' }),
      pendingMsg({ nonce: 'n2', text: 'ok pour moi' }),
    ];
    const turns = [
      turn({ id: 'u1', seq: 8, blocks: [{ type: 'text', text: 'ok pour moi' }] }),
    ];
    // Un seul tour : il revient à la bulle dont le texte est EXACT, pas à la première.
    assert.deepEqual(withoutEchoed(local, turns, 's1').map((m) => m.nonce), ['n1']);
  });

  it("deux envois identiques d'affilée ne disparaissent pas ensemble sur le premier écho", () => {
    const local = [
      pendingMsg({ nonce: 'n1', text: 'continue' }),
      pendingMsg({ nonce: 'n2', text: 'continue' }),
    ];
    const one = [turn({ id: 'u5', seq: 5, blocks: [{ type: 'text', text: 'continue' }] })];
    const kept = withoutEchoed(local, one, 's1');
    assert.deepEqual(kept.map((m) => m.nonce), ['n2']);

    const two = [...one, turn({ id: 'u6', seq: 6, blocks: [{ type: 'text', text: 'continue' }] })];
    assert.deepEqual(withoutEchoed(local, two, 's1'), []);
  });

  it("compare le texte visible, espaces de bord ignorés, et jamais un tour d'assistant", () => {
    const local = [pendingMsg({ nonce: 'n1', text: '  ok  ' })];
    const assistant = [turn({ id: 'a1', seq: 5, kind: 'assistant', blocks: [{ type: 'text', text: 'ok' }] })];
    assert.equal(withoutEchoed(local, assistant, 's1').length, 1);
    const user = [turn({ id: 'u1', seq: 5, blocks: [{ type: 'text', text: 'ok' }] })];
    assert.equal(withoutEchoed(local, user, 's1').length, 0);
  });

  it("jette une bulle héritée d'une autre session : aucun tour ne pourra la reconnaître", () => {
    const local = [pendingMsg({ nonce: 'n1', sessionId: 'ancienne' })];
    assert.deepEqual(withoutEchoed(local, [], 's1'), []);
  });

  it('rend la même référence quand rien ne change, pour ne pas faire re-rendre', () => {
    const local = [pendingMsg({ nonce: 'n1' })];
    assert.equal(withoutEchoed(local, [], 's1'), local);
    assert.equal(withoutEchoed([], [], 's1').length, 0);
  });
});

describe('merge', () => {
  it('remplace un turn connu au lieu de le dupliquer (A16, V6)', () => {
    const existing = [turn({ id: 'a', seq: 1 }), turn({ id: 'b', seq: 2, blocks: [] })];
    const incoming = [turn({ id: 'b', seq: 2, blocks: [{ type: 'text', text: 'complet' }] })];
    const out = merge(existing, incoming, ['b']);
    assert.deepEqual(out.map((t) => t.id), ['a', 'b']);
    assert.deepEqual(out[1]?.blocks, [{ type: 'text', text: 'complet' }]);
  });

  it('remplace aussi sans replaceIds, par identité de `id`', () => {
    const existing = [turn({ id: 'a', seq: 1 })];
    const out = merge(existing, [turn({ id: 'a', seq: 1, blocks: [] })], []);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0]?.blocks, []);
  });

  it('trie par seq quel que soit l’ordre d’arrivée', () => {
    const out = merge([turn({ id: 'c', seq: 3 })], [turn({ id: 'a', seq: 1 }), turn({ id: 'b', seq: 2 })], []);
    assert.deepEqual(out.map((t) => t.seq), [1, 2, 3]);
  });

  it('un append vide ne perd rien : le transcript existant reste intact', () => {
    const existing = [turn({ id: 'a', seq: 1 }), turn({ id: 'b', seq: 2 })];
    assert.deepEqual(merge(existing, [], []), existing);
  });

  it('retire un id de replaceIds absent de l’append', () => {
    const existing = [turn({ id: 'a', seq: 1 }), turn({ id: 'b', seq: 2 })];
    assert.deepEqual(merge(existing, [], ['b']).map((t) => t.id), ['a']);
  });
});

describe('recentExchanges (docs/13, points 7 et 8)', () => {
  const exchange = (n: number, seq: number): Turn[] => [
    turn({ id: `u${n}`, seq }),
    turn({ id: `a${n}`, seq: seq + 1, kind: 'assistant' }),
    turn({ id: `r${n}`, seq: seq + 2, kind: 'tool_result' }),
  ];
  const five = [1, 2, 3, 4, 5].flatMap((n) => exchange(n, n * 10));

  it('garde les TROIS derniers échanges, chacun du message utilisateur à ce qui le suit', () => {
    assert.equal(EXCHANGES_KEPT, 3);
    const kept = recentExchanges(five);
    assert.deepEqual(
      kept.map((t) => t.id),
      ['u3', 'a3', 'r3', 'u4', 'a4', 'r4', 'u5', 'a5', 'r5'],
    );
  });

  it("un nouvel envoi n'en retire aucun : la fenêtre s'étend, elle ne replie pas le précédent", () => {
    // Le bug de Robin : après « tu replies trop vite l'historique », chaque envoi cachait
    // l'échange qu'il était en train de relire. Les trois derniers restent, et le plus
    // récent s'ajoute en bas.
    const before = recentExchanges(five).map((t) => t.id);
    const after = recentExchanges([...five, ...exchange(6, 60)]).map((t) => t.id);
    assert.ok(after.includes('u5') && after.includes('a5') && after.includes('r5'), 'le précédent reste');
    assert.ok(after.includes('u4') && after.includes('u6'));
    for (const id of before.slice(3)) assert.ok(after.includes(id), `${id} ne doit pas disparaître`);
  });

  it("moins de trois échanges : tout est rendu, et un début sans message utilisateur n'est pas coupé", () => {
    assert.deepEqual(recentExchanges(exchange(1, 10)).map((t) => t.id), ['u1', 'a1', 'r1']);
    const headless = [turn({ id: 'a0', seq: 1, kind: 'assistant' }), ...exchange(1, 10), ...exchange(2, 20)];
    assert.deepEqual(recentExchanges(headless).map((t) => t.id), ['a0', 'u1', 'a1', 'r1', 'u2', 'a2', 'r2']);
    assert.deepEqual(recentExchanges([]), []);
  });

  it('un seul échange demandé rend exactement le dernier', () => {
    assert.deepEqual(recentExchanges(five, 1).map((t) => t.id), ['u5', 'a5', 'r5']);
  });
});

describe('unconfirmed (CA-48)', () => {
  const t0 = Date.parse('2026-09-10T10:00:00.000Z');
  it('un message parti depuis 20 s sans écho est non confirmé', () => {
    const local = [pendingMsg({ nonce: 'n1', ts: new Date(t0).toISOString() })];
    assert.equal(unconfirmed(local, t0 + 19_999).length, 0);
    assert.equal(unconfirmed(local, t0 + 20_000).length, 1);
  });
  it('un message en file ou en échec ne compte pas', () => {
    const local = [
      pendingMsg({ nonce: 'q', state: 'queued', ts: new Date(t0).toISOString() }),
      pendingMsg({ nonce: 'f', state: 'failed', ts: new Date(t0).toISOString() }),
    ];
    assert.equal(unconfirmed(local, t0 + 60_000).length, 0);
  });
});

describe('jointure des tool_result (F1, contrat du protocole)', () => {
  it("rattache un tool_result émis dans un tour séparé à son tool_use par toolUseId", () => {
    const turns = [
      turn({
        id: 'a1',
        seq: 2,
        kind: 'assistant',
        blocks: [
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {}, preview: 'a.ts' },
          { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {}, preview: 'ls' },
        ],
      }),
      turn({
        id: 'r1',
        seq: 3,
        kind: 'tool_result',
        blocks: [
          { type: 'tool_result', toolUseId: 'toolu_1', isError: false, preview: '12 lignes', truncated: false, retrievable: false },
        ],
      }),
      turn({
        id: 'r2',
        seq: 4,
        kind: 'tool_result',
        blocks: [
          { type: 'tool_result', toolUseId: 'toolu_2', isError: true, preview: 'exit 1', truncated: true, retrievable: false },
        ],
      }),
    ];
    const results = indexToolResults(turns);
    assert.equal(results.get('toolu_1')?.preview, '12 lignes');
    assert.equal(results.get('toolu_2')?.isError, true, "l'échec est rattaché au bon appel (CA-39)");
    assert.equal(results.has('toolu_3'), false);
    assert.deepEqual([...toolCallIds(turns)], ['toolu_1', 'toolu_2']);
  });

});

describe('cacheSlice (CA-120, cache hors ligne du dernier échange)', () => {
  const many = Array.from({ length: 100 }, (_, i) => turn({ id: `t${i}`, seq: i }));

  it('garde les derniers tours et annonce de l historique au dessus quand il a coupé', () => {
    const out = cacheSlice(many, false, 60);
    assert.equal(out.turns.length, 60);
    assert.equal(out.turns[0]?.seq, 40);
    assert.equal(out.turns[59]?.seq, 99);
    assert.equal(out.hasMoreBefore, true);
  });

  it('ne touche à rien sous la limite et conserve hasMoreBefore tel quel', () => {
    const few = many.slice(0, 10);
    assert.deepEqual(cacheSlice(few, false, 60), { turns: few, hasMoreBefore: false });
    assert.deepEqual(cacheSlice(few, true, 60), { turns: few, hasMoreBefore: true });
  });
});
