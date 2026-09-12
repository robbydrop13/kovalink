// Découpage d'un tour assistant en segments de rendu, dans l'ordre du JSONL :
// un texte, un groupe d'actions consécutives, une réflexion. Pur, testé sous Node.
import type { Block, ToolUseBlock } from '@/protocol';

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; calls: ToolUseBlock[] }
  | { kind: 'thinking' };

export function segmentBlocks(blocks: readonly Block[]): Segment[] {
  const out: Segment[] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      const text = b.text.trim();
      if (text.length === 0) continue;
      const last = out[out.length - 1];
      // Deux textes d'affilée (lignes JSONL successives) forment un seul paragraphe.
      if (last?.kind === 'text') last.text = `${last.text}\n\n${text}`;
      else out.push({ kind: 'text', text });
    } else if (b.type === 'tool_use') {
      const last = out[out.length - 1];
      if (last?.kind === 'tools') last.calls.push(b);
      else out.push({ kind: 'tools', calls: [b] });
    } else if (b.type === 'thinking') {
      const last = out[out.length - 1];
      if (last?.kind !== 'thinking') out.push({ kind: 'thinking' });
    }
    // `tool_result` inliné : jamais rendu ici, la jointure le porte dans sa ligne d'action.
  }
  return out;
}
