// Cmd+J sur l'iPhone (docs/16) : ce qui est « non lu », l'anneau à parcourir, la cible du
// prochain saut. Pur, testé sous Node.
//
// Non lu = un `Prompt` lisible (`turn_end`, `parsed`, `unparsable`) dont le `promptRef`
// n'est pas la marque de lecture du pane sur ce téléphone. Un pane qui travaille n'est pas
// non lu (rien à lire encore). L'ordre est celui du sélecteur de Kova (fenêtre, onglet,
// pane), les `awaiting` non vus d'abord (P2), en boucle à partir du pane courant.
import type { Pane, Prompt } from '@/protocol';
import type { PaletteEntry } from './tabGroups';

export type ReadMarks = Readonly<Record<number, string>>;

export function readablePrompt(prompt: Prompt | undefined): prompt is Exclude<Prompt, { state: 'none' }> {
  return prompt !== undefined && prompt.state !== 'none';
}

export function isUnread(pane: Pane, prompt: Prompt | undefined, marks: ReadMarks): boolean {
  if (pane.working) return false;
  if (!readablePrompt(prompt)) return false;
  return marks[pane.id] !== prompt.promptRef;
}

/** Session Claude au repos, sans rien à lire : le repli de Kova quand tout est lu. */
export function isIdleClaude(pane: Pane, prompt: Prompt | undefined, marks: ReadMarks): boolean {
  return pane.agent === 'claude' && !pane.working && !pane.awaiting && !isUnread(pane, prompt, marks);
}

/** Les entrées après `currentId` puis celles d'avant : l'anneau tourne à partir du pane courant. */
function rotate(entries: readonly PaletteEntry[], currentId: number | null): PaletteEntry[] {
  const at = currentId === null ? -1 : entries.findIndex((e) => e.pane.id === currentId);
  if (at < 0) return [...entries];
  return [...entries.slice(at + 1), ...entries.slice(0, at)];
}

/**
 * L'anneau des non lus, hors pane courant : d'abord les `awaiting` non vus, puis les
 * autres, chacun dans l'ordre de Kova à partir du pane courant.
 */
export function unreadRing(
  entries: readonly PaletteEntry[],
  prompts: Readonly<Record<number, Prompt>>,
  marks: ReadMarks,
  currentId: number | null,
): PaletteEntry[] {
  const ring = rotate(entries, currentId).filter((e) => e.pane.id !== currentId && isUnread(e.pane, prompts[e.pane.id], marks));
  const urgent = ring.filter((e) => e.pane.awaiting && !e.pane.awaiting_seen);
  const rest = ring.filter((e) => !(e.pane.awaiting && !e.pane.awaiting_seen));
  return [...urgent, ...rest];
}

/** Le repli : les sessions Claude inactives, hors pane courant, dans l'ordre de Kova. */
export function idleRing(
  entries: readonly PaletteEntry[],
  prompts: Readonly<Record<number, Prompt>>,
  marks: ReadMarks,
  currentId: number | null,
): PaletteEntry[] {
  return rotate(entries, currentId).filter((e) => e.pane.id !== currentId && isIdleClaude(e.pane, prompts[e.pane.id], marks));
}

export type NextTarget = { kind: 'unread' | 'idle'; entry: PaletteEntry; others: number } | null;

/** La cible du prochain saut : le premier non lu, sinon la première session inactive, sinon rien. */
export function nextTarget(
  entries: readonly PaletteEntry[],
  prompts: Readonly<Record<number, Prompt>>,
  marks: ReadMarks,
  currentId: number | null,
): NextTarget {
  const unread = unreadRing(entries, prompts, marks, currentId);
  if (unread.length > 0) return { kind: 'unread', entry: unread[0] as PaletteEntry, others: unread.length };
  const idle = idleRing(entries, prompts, marks, currentId);
  if (idle.length > 0) return { kind: 'idle', entry: idle[0] as PaletteEntry, others: idle.length };
  return null;
}

/** Les marques dont le pane n'existe plus : purgées au premier instantané. */
export function staleMarks(marks: ReadMarks, panes: readonly Pane[]): number[] {
  const alive = new Set(panes.map((p) => p.id));
  return Object.keys(marks)
    .map(Number)
    .filter((id) => !alive.has(id));
}
