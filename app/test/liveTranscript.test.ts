// Dictée en direct : l'état pur des tours AssemblyAI et le niveau du PCM.
import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { LEVEL_DB_FLOOR, applyMessage, emptyLiveState, finalText, levelDb, render, reveal, wordCount } from '@/features/chat/liveTranscript';

/** Un `Turn` comme le service les envoie, avec des mots facultatifs. */
function turn(order: number, transcript: string, fields: Record<string, unknown> = {}) {
  return { type: 'Turn', turn_order: order, transcript, end_of_turn: false, turn_is_formatted: false, words: [], ...fields };
}

function finalTurn(order: number, transcript: string) {
  return turn(order, transcript, { end_of_turn: true, turn_is_formatted: true });
}

/** PCM 16 bits little endian à partir d'échantillons. */
function pcm(...values: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return buffer;
}

describe('applyMessage', () => {
  it('ignore Begin, Termination, un type inconnu et un corps illisible', () => {
    let state = emptyLiveState();
    state = applyMessage(state, turn(0, 'hello'));
    for (const msg of [
      { type: 'Begin' },
      { type: 'Termination' },
      { type: 'Word', text: 'hello' },
      { error: 'quota' },
      { type: 'Turn' },
      { type: 'Turn', turn_order: 'x' },
      '{"type":"Turn"',
      'pas du json',
      null,
      42,
    ]) {
      assert.equal(applyMessage(state, msg), state);
    }
  });

  it('un tour ouvert remplace celui du même turn_order', () => {
    let state = applyMessage(
      emptyLiveState(),
      turn(0, 'hello wor', { words: [{ text: 'hello', word_is_final: true }, { text: 'wor', word_is_final: false }] }),
    );
    assert.deepEqual(render(state), { settled: 'hello', pending: 'wor' });
    state = applyMessage(
      state,
      turn(0, 'Hello world', { words: [{ text: 'Hello', word_is_final: true }, { text: 'world', word_is_final: false }] }),
    );
    assert.deepEqual(render(state), { settled: 'Hello', pending: 'world' });
    assert.equal(finalText(state), 'Hello world');
  });

  it('un tour finalisé remplace le tour ouvert, fige le texte et ouvre le suivant', () => {
    let state = applyMessage(emptyLiveState(), turn(0, 'Hello', { words: [{ text: 'Hello', word_is_final: true }] }));
    state = applyMessage(state, finalTurn(0, 'Hello world.'));
    assert.deepEqual(render(state), { settled: 'Hello world.', pending: '' });
    assert.equal(finalText(state), 'Hello world.');
    state = applyMessage(
      state,
      turn(1, 'and then', { words: [{ text: 'and', word_is_final: false }, { text: 'then', word_is_final: false }] }),
    );
    assert.deepEqual(render(state), { settled: 'Hello world.', pending: 'and then' });
  });

  it('range les tours finalisés par turn_order et remplace une version plus récente', () => {
    let state = applyMessage(emptyLiveState(), finalTurn(1, 'Second.'));
    state = applyMessage(state, finalTurn(0, 'First.'));
    assert.equal(finalText(state), 'First. Second.');
    state = applyMessage(state, finalTurn(1, 'Second, formatted.'));
    assert.equal(finalText(state), 'First. Second, formatted.');
  });

  it("un tour ouvert plus ancien qu'un tour finalisé est ignoré", () => {
    const state = applyMessage(emptyLiveState(), finalTurn(0, 'One.'));
    assert.equal(applyMessage(state, turn(0, 'stale')), state);
    assert.equal(applyMessage(state, turn(-1, 'stale')), state);
  });

  it('un tour sans mots affiche son transcrit en suspens, jamais perdu', () => {
    const state = applyMessage(emptyLiveState(), turn(0, 'no words here'));
    assert.deepEqual(render(state), { settled: '', pending: 'no words here' });
    assert.equal(finalText(state), 'no words here');
  });
});

describe('finalText', () => {
  it('garde le dernier tour jamais finalisé, même partiel', () => {
    let state = applyMessage(emptyLiveState(), finalTurn(0, 'One.'));
    state = applyMessage(state, turn(1, 'Two', { words: [{ text: 'Two', word_is_final: false }] }));
    assert.equal(finalText(state), 'One. Two');
    state = applyMessage(state, finalTurn(1, 'Two.'));
    assert.equal(finalText(state), 'One. Two.');
  });
});

describe('levelDb', () => {
  it('le silence vaut le plancher, sans dB infinies', () => {
    assert.equal(levelDb(pcm(0, 0, 0, 0)), LEVEL_DB_FLOOR);
    assert.equal(levelDb(new ArrayBuffer(0)), LEVEL_DB_FLOOR);
  });

  it('la pleine échelle vaut 0 dB', () => {
    assert.ok(Math.abs(levelDb(pcm(32767, -32768, 32767, -32768))) < 0.01);
  });

  it('une demi échelle vaut -6 dB', () => {
    assert.ok(Math.abs(levelDb(pcm(16384, -16384, 16384, -16384)) + 6.02) < 0.01);
  });

  it('ignore un octet final impair', () => {
    const buffer = new Uint8Array([0, 0, 7]).buffer;
    assert.equal(levelDb(buffer), LEVEL_DB_FLOOR);
  });
});

test('reveal shows settled words first, then pending ones, never more than given', () => {
  const r = { settled: 'Salut Francisco,', pending: 'peux-tu relire' };
  assert.equal(wordCount(r), 4);
  assert.deepEqual(reveal(r, 0), { settled: '', pending: '' });
  assert.deepEqual(reveal(r, 1), { settled: 'Salut', pending: '' });
  assert.deepEqual(reveal(r, 3), { settled: 'Salut Francisco,', pending: 'peux-tu' });
  assert.equal(reveal(r, 9), r);
});

test('finalText keeps the unconfirmed tail of an open turn when transcript lags behind words', () => {
  const s = applyMessage(emptyLiveState(), {
    type: 'Turn',
    turn_order: 0,
    end_of_turn: false,
    transcript: 'je vais',
    words: [
      { text: 'je', word_is_final: true },
      { text: 'vais', word_is_final: true },
      { text: 'au', word_is_final: false },
      { text: 'bureau', word_is_final: false },
    ],
  });
  assert.equal(finalText(s), 'je vais au bureau');
});
