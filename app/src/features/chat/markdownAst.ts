// Markdown des tours assistant : de la chaîne à un arbre de rendu SIMPLE, par markdown-it
// (analyseur éprouvé, CommonMark plus tableaux GFM et texte barré). Aucun React ici :
// module pur, testé sous Node. Le rendu vit dans `Markdown.tsx`.
//
// Ce que produit réellement Claude Code, relevé sur les trente derniers tours de Robin
// (12 septembre) : gras, code en ligne, listes, tableaux, liens et URL nues. Le reste
// (titres, listes imbriquées, blocs de code, citations, filets, barré) est couvert par
// le même analyseur, sans code maison.
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}

export type Align = 'left' | 'center' | 'right' | null;

export type MdBlock =
  | { type: 'paragraph'; spans: Span[] }
  | { type: 'heading'; level: number; spans: Span[] }
  | { type: 'list'; ordered: boolean; start: number; items: MdBlock[][] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'quote'; blocks: MdBlock[] }
  | { type: 'hr' }
  | { type: 'table'; align: Align[]; header: Span[][]; rows: Span[][][] };

const md = new MarkdownIt({ linkify: true, breaks: false, html: false }).enable(['table', 'strikethrough']);

interface Style {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  href: string | null;
}

/** Aplatit les enfants d'un `inline` en spans stylés : une pile de styles, pas d'arbre. */
export function spansOf(children: readonly Token[] | null | undefined): Span[] {
  const out: Span[] = [];
  const style: Style = { bold: false, italic: false, strike: false, href: null };
  const push = (text: string, code = false): void => {
    if (text.length === 0) return;
    const span: Span = { text };
    if (style.bold) span.bold = true;
    if (style.italic) span.italic = true;
    if (style.strike) span.strike = true;
    if (code) span.code = true;
    if (style.href) span.href = style.href;
    out.push(span);
  };
  for (const t of children ?? []) {
    switch (t.type) {
      case 'text':
        push(t.content);
        break;
      case 'softbreak':
        push(' ');
        break;
      case 'hardbreak':
        push('\n');
        break;
      case 'code_inline':
        push(t.content, true);
        break;
      case 'strong_open':
        style.bold = true;
        break;
      case 'strong_close':
        style.bold = false;
        break;
      case 'em_open':
        style.italic = true;
        break;
      case 'em_close':
        style.italic = false;
        break;
      case 's_open':
        style.strike = true;
        break;
      case 's_close':
        style.strike = false;
        break;
      case 'link_open':
        style.href = t.attrGet('href') ?? null;
        break;
      case 'link_close':
        style.href = null;
        break;
      case 'image':
        // Une image en ligne n'a rien à montrer dans une bulle : son texte alternatif.
        push(t.content);
        break;
      default:
        if (t.content) push(t.content);
        break;
    }
  }
  // Deux spans voisins de même style fusionnent : moins de nœuds Text.
  const merged: Span[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && sameStyle(last, s)) last.text += s.text;
    else merged.push({ ...s });
  }
  return merged;
}

function sameStyle(a: Span, b: Span): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && !!a.code === !!b.code && a.href === b.href;
}

function alignOf(token: Token): Align {
  const style = token.attrGet('style') ?? '';
  if (style.includes('center')) return 'center';
  if (style.includes('right')) return 'right';
  if (style.includes('left')) return 'left';
  return null;
}

/** Marche récursive : `tokens[i]` jusqu'au jeton de fermeture `close`, rend les blocs. */
function walk(tokens: readonly Token[], start: number, close: string | null): { blocks: MdBlock[]; next: number } {
  const blocks: MdBlock[] = [];
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i] as Token;
    if (close !== null && t.type === close) return { blocks, next: i + 1 };
    switch (t.type) {
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        blocks.push({ type: 'paragraph', spans: spansOf(inline?.type === 'inline' ? inline.children : null) });
        i += 3;
        break;
      }
      case 'heading_open': {
        const inline = tokens[i + 1];
        blocks.push({
          type: 'heading',
          level: Number(t.tag.slice(1)) || 1,
          spans: spansOf(inline?.type === 'inline' ? inline.children : null),
        });
        i += 3;
        break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const ordered = t.type === 'ordered_list_open';
        const closeType = ordered ? 'ordered_list_close' : 'bullet_list_close';
        const start = Number(t.attrGet('start') ?? '1') || 1;
        const items: MdBlock[][] = [];
        i += 1;
        while (i < tokens.length && (tokens[i] as Token).type !== closeType) {
          if ((tokens[i] as Token).type === 'list_item_open') {
            const item = walk(tokens, i + 1, 'list_item_close');
            items.push(item.blocks);
            i = item.next;
          } else i += 1;
        }
        blocks.push({ type: 'list', ordered, start, items });
        i += 1;
        break;
      }
      case 'fence':
      case 'code_block':
        blocks.push({ type: 'code', lang: (t.info ?? '').trim().split(/\s+/)[0] ?? '', code: t.content.replace(/\n$/, '') });
        i += 1;
        break;
      case 'blockquote_open': {
        const inner = walk(tokens, i + 1, 'blockquote_close');
        blocks.push({ type: 'quote', blocks: inner.blocks });
        i = inner.next;
        break;
      }
      case 'hr':
        blocks.push({ type: 'hr' });
        i += 1;
        break;
      case 'table_open': {
        const table = readTable(tokens, i + 1);
        blocks.push(table.block);
        i = table.next;
        break;
      }
      default:
        i += 1;
        break;
    }
  }
  return { blocks, next: i };
}

function readTable(tokens: readonly Token[], start: number): { block: Extract<MdBlock, { type: 'table' }>; next: number } {
  const align: Align[] = [];
  const header: Span[][] = [];
  const rows: Span[][][] = [];
  let current: Span[][] | null = null;
  let inHead = false;
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i] as Token;
    if (t.type === 'table_close') return { block: { type: 'table', align, header, rows }, next: i + 1 };
    switch (t.type) {
      case 'thead_open':
        inHead = true;
        break;
      case 'thead_close':
        inHead = false;
        break;
      case 'tr_open':
        current = [];
        break;
      case 'tr_close':
        if (current) {
          if (inHead) header.push(...current);
          else rows.push(current);
        }
        current = null;
        break;
      case 'th_open':
      case 'td_open': {
        if (t.type === 'th_open') align.push(alignOf(t));
        const inline = tokens[i + 1];
        current?.push(spansOf(inline?.type === 'inline' ? inline.children : null));
        i += 2;
        break;
      }
      default:
        break;
    }
    i += 1;
  }
  return { block: { type: 'table', align, header, rows }, next: i };
}

/** Le texte d'un tour assistant, en blocs. Jamais une exception : au pire un paragraphe brut. */
export function parseMarkdown(text: string): MdBlock[] {
  try {
    const tokens = md.parse(text.replace(/\r\n?/g, '\n'), {});
    return walk(tokens, 0, null).blocks;
  } catch {
    return [{ type: 'paragraph', spans: [{ text }] }];
  }
}

/** Texte brut d'un bloc, pour les tests et VoiceOver. */
export function plainText(spans: readonly Span[]): string {
  return spans.map((s) => s.text).join('');
}
