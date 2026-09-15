// Reproduction du cas de la capture du 12 septembre (IMG_5364) sur un transcript JSONL
// de meme forme que celui de la session d'origine, au contenu neutre : trois messages
// envoyes depuis l'app, « Is the rename done? », « Squash it into a single commit » et
// « Can you tell Sam it is done ». Les deux premiers sont des lignes `user` ordinaires ;
// le troisieme a ete absorbe en cours de tour et n'existe que comme `attachment` de type
// `queued_command`.
//
// Deux causes, deux garanties :
//  1. le `seq` d'un tour ne depend pas de la fenetre lue : deux ouvertures de tailles
//     differentes donnent le meme `seq`, egal a l'offset d'octet de la ligne ;
//  2. le message absorbe devient un tour `user`, a sa place dans l'ordre du transcript.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { buildTurns, sortAssistantBlocks } from '../src/transcript/jsonl.js';
import { readTailLines } from '../src/transcript/session.js';
import { openTail } from '../src/transcript/tailer.js';

const FIXTURE = fileURLToPath(new URL('../../test/fixtures/transcript-echo.jsonl', import.meta.url));

const MESSAGES = ['Is the rename done?', 'Squash it into a single commit', 'Can you tell Sam it is done'];
/** `uuid` de la ligne JSONL qui porte chacun des trois messages. */
const LINE_UUIDS = [
  '9ed2d009-e7db-4e53-a37e-7990c3b0b852',
  '9500d7de-7392-4bb3-a928-e603ba9e4209',
  '21761428-42b0-42aa-8b2c-5568dcb44bbe',
];

function textOf(turn: { blocks: { type: string; text?: string }[] }): string {
  return turn.blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n\n');
}

/** Offset d'octet reel de la ligne qui contient `needle`, calcule sans le tailer. */
function byteOffsetOf(needle: string): number {
  const raw = readFileSync(FIXTURE);
  const text = raw.toString('utf8');
  let offset = 0;
  for (const line of text.split('\n')) {
    if (line.includes(needle)) return offset;
    offset += Buffer.byteLength(line, 'utf8') + 1;
  }
  throw new Error(`ligne introuvable : ${needle}`);
}

describe('capture IMG_5364 : bulles locales jamais remplacees', () => {
  it('les trois messages de l utilisateur sont des tours user, dans l ordre du transcript', () => {
    const { lines } = openTail(FIXTURE);
    const turns = buildTurns(sortAssistantBlocks(lines));
    const users = turns.filter((t) => t.kind === 'user').map(textOf);
    assert.deepEqual(users, MESSAGES);
  });

  it('le message absorbe en cours de tour arrive APRES le tool_result qu il accompagne', () => {
    const { lines } = openTail(FIXTURE);
    const turns = buildTurns(sortAssistantBlocks(lines));
    const absorbed = turns.findIndex((t) => t.kind === 'user' && textOf(t) === MESSAGES[2]);
    assert.ok(absorbed > 0);
    assert.equal(turns[absorbed - 1]?.kind, 'tool_result');
    assert.equal(turns[absorbed]?.id, '21761428-42b0-42aa-8b2c-5568dcb44bbe', 'uuid de la ligne attachment');
    assert.equal(turns[absorbed]?.ts, '2026-09-12T13:11:07.885Z');
  });

  it('le seq est l offset d octet de la ligne, identique quelle que soit la fenetre lue', () => {
    // Fenetre large (fichier entier) et fenetre etroite (les derniers octets seulement) :
    // c'est la situation de l'app qui se reconnecte et recoit un nouveau snapshot.
    const wide = buildTurns(sortAssistantBlocks(openTail(FIXTURE, 200).lines));
    const narrow = buildTurns(sortAssistantBlocks(readTailLines(FIXTURE, 6 * 1024)));
    assert.ok(narrow.length < wide.length, 'la fenetre etroite contient moins de tours');
    for (const t of narrow) {
      const same = wide.find((w) => w.id === t.id);
      assert.ok(same, `tour ${t.id} absent de la fenetre large`);
      assert.equal(same.seq, t.seq, `seq different pour ${t.id}`);
    }
    MESSAGES.forEach((text, i) => {
      const turn = wide.find((t) => t.kind === 'user' && textOf(t) === text);
      assert.ok(turn);
      assert.equal(turn.id, LINE_UUIDS[i]);
      assert.equal(turn.seq, byteOffsetOf(`"uuid": "${LINE_UUIDS[i]}"`));
    });
  });

  it('avant le correctif, le compteur repartait de zero a chaque fenetre : le meme tour changeait de seq', () => {
    // Lignes SANS offset : c'est l'ancien comportement, garde comme repli pour les tests.
    const strip = (l: Record<string, unknown>): Record<string, unknown> => ({ ...l, offset: undefined });
    const wide = buildTurns(sortAssistantBlocks(openTail(FIXTURE, 200).lines.map(strip) as never));
    const narrow = buildTurns(sortAssistantBlocks(readTailLines(FIXTURE, 6 * 1024).map(strip) as never));
    const recree = (list: typeof wide) => list.find((t) => t.kind === 'user' && textOf(t) === MESSAGES[1]);
    assert.notEqual(recree(wide)?.seq, recree(narrow)?.seq);
  });

  it('une page d historique bornee par beforeSeq ne contient que des tours anterieurs', () => {
    const all = buildTurns(sortAssistantBlocks(openTail(FIXTURE, 200).lines));
    const pivot = all.find((t) => t.kind === 'user' && textOf(t) === MESSAGES[1]);
    assert.ok(pivot);
    const page = buildTurns(sortAssistantBlocks(readTailLines(FIXTURE, 64 * 1024, pivot.seq)));
    assert.ok(page.length > 0);
    assert.ok(page.every((t) => t.seq < pivot.seq));
    assert.equal(page[page.length - 1]?.kind, 'assistant');
  });
});
