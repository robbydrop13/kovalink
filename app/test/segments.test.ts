import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { segmentBlocks } from '@/features/chat/segments';
import { groupState } from '@/features/chat/toolLabel';

const call = (id: string) => ({ type: 'tool_use' as const, id, name: 'Read', input: {}, preview: id });

describe('segmentBlocks', () => {
  it('groupe les appels consécutifs, sépare par le texte, fusionne les textes voisins', () => {
    const segs = segmentBlocks([
      { type: 'text', text: 'Je lis.' },
      call('a'),
      call('b'),
      { type: 'text', text: 'Puis ' },
      { type: 'text', text: 'je modifie.' },
      call('c'),
      { type: 'thinking' },
      { type: 'thinking' },
    ]);
    assert.deepEqual(
      segs.map((s) => (s.kind === 'tools' ? `tools:${s.calls.length}` : s.kind === 'text' ? `text:${s.text}` : 'thinking')),
      ['text:Je lis.', 'tools:2', 'text:Puis\n\nje modifie.', 'tools:1', 'thinking'],
    );
  });
  it('ignore les textes vides et les tool_result inlinés', () => {
    const segs = segmentBlocks([
      { type: 'text', text: '   ' },
      { type: 'tool_result', toolUseId: 'a', isError: false, preview: '', truncated: false, retrievable: false },
    ]);
    assert.deepEqual(segs, []);
  });
});

describe('groupState', () => {
  it('le pire cas l’emporte', () => {
    assert.equal(groupState(['done', 'running', 'failed']), 'failed');
    assert.equal(groupState(['done', 'running']), 'running');
    assert.equal(groupState(['done', 'done']), 'done');
    assert.equal(groupState(['done', 'unknown']), 'unknown');
    assert.equal(groupState([]), 'unknown');
  });
});
