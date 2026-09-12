// Rendu Markdown des tours assistant, sur l'arbre de `markdownAst.ts` (markdown-it).
//
// Tableaux GFM : en-tête distinct (fond `bg.overlay`, gras), lignes séparées d'un filet,
// cellules 15 pt qui vont à la ligne, alignement respecté. Un tableau à deux colonnes
// tient en largeur ; au delà, ou si le contenu est long, il vit dans un conteneur à
// défilement horizontal, comme les blocs de code, jamais compressé jusqu'à l'illisible.
// Blocs de code : monospace, langage, bouton `Partager` (aucun module presse-papiers
// natif dans ce build : la feuille de partage d'iOS offre `Copier`). Liens : Safari.
import { Fragment, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { colors, layout, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { parseMarkdown, type Align, type MdBlock, type Span } from './markdownAst';

const CELL_MIN = 96;
const CELL_MAX = 240;
const CELL_FONT = 15;

function openLink(href: string): void {
  void Linking.openURL(href).catch(() => undefined);
}

function Spans({ spans, variant = 'body' }: { spans: Span[]; variant?: 'body' | 'callout' | 'calloutStrong' }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.code) {
          return (
            <Txt key={i} variant="monoCodeInline" color={colors.text.primary} style={styles.code}>
              {s.text}
            </Txt>
          );
        }
        const style = [
          s.italic && styles.italic,
          s.strike && styles.strike,
          s.href && styles.link,
        ];
        return (
          <Txt
            key={i}
            variant={s.bold ? 'bodyStrong' : variant}
            color={s.href ? colors.accent.primary : colors.text.primary}
            style={style}
            {...(s.href ? { onPress: () => openLink(s.href as string) } : {})}
          >
            {s.text}
          </Txt>
        );
      })}
    </>
  );
}

function ListBlock({ block, depth }: { block: Extract<MdBlock, { type: 'list' }>; depth: number }) {
  return (
    <View style={styles.list}>
      {block.items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Txt variant="body" color={colors.text.secondary} style={styles.marker}>
            {block.ordered ? `${block.start + i}.` : depth % 2 === 0 ? '•' : '◦'}
          </Txt>
          <View style={styles.flex}>
            <Blocks blocks={item} depth={depth + 1} />
          </View>
        </View>
      ))}
    </View>
  );
}

function CodeBlock({ block }: { block: Extract<MdBlock, { type: 'code' }> }) {
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeBar}>
        <Txt variant="caption" color={colors.text.tertiary}>
          {block.lang || 'code'}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share this code block"
          hitSlop={8}
          onPress={() => void Share.share({ message: block.code }).catch(() => undefined)}
        >
          <Txt variant="caption" color={colors.accent.primary}>
            Share
          </Txt>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Txt variant="monoCode" color={colors.text.primary} selectable>
          {block.code}
        </Txt>
      </ScrollView>
    </View>
  );
}

function alignStyle(align: Align): { textAlign: 'left' | 'center' | 'right' } {
  return { textAlign: align ?? 'left' };
}

/**
 * Largeur des colonnes : le tableau se partage la largeur de la bulle quand il tient,
 * sinon chaque colonne prend au moins `CELL_MIN` et le tout défile horizontalement.
 */
export function columnWidths(count: number, available: number): number[] {
  const share = Math.floor(available / Math.max(1, count));
  const width = Math.max(CELL_MIN, Math.min(CELL_MAX, share));
  return Array.from({ length: count }, () => width);
}

function TableBlock({ block }: { block: Extract<MdBlock, { type: 'table' }> }) {
  const { width: screen } = useWindowDimensions();
  const available = screen - 2 * layout.screenPaddingH - 2;
  const count = Math.max(block.header.length, ...block.rows.map((r) => r.length));
  const widths = columnWidths(count, available);
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (spans: Span[] | undefined, col: number, header: boolean): ReactNode => (
    <View key={col} style={[styles.cell, { width: widths[col] ?? CELL_MIN }]}>
      <Txt
        variant={header ? 'calloutStrong' : 'callout'}
        color={colors.text.primary}
        style={[styles.cellText, alignStyle(block.align[col] ?? null)]}
      >
        <Spans spans={spans ?? []} variant={header ? 'calloutStrong' : 'callout'} />
      </Txt>
    </View>
  );
  const table = (
    <View style={[styles.table, { width: total }]}>
      <View style={[styles.row, styles.headRow]}>{widths.map((_, c) => cell(block.header[c], c, true))}</View>
      {block.rows.map((r, i) => (
        <View key={i} style={[styles.row, i < block.rows.length - 1 && styles.rowBorder]}>
          {widths.map((_, c) => cell(r[c], c, false))}
        </View>
      ))}
    </View>
  );
  if (total <= available) return table;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
      {table}
    </ScrollView>
  );
}

function Blocks({ blocks, depth }: { blocks: MdBlock[]; depth: number }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'paragraph':
            return (
              <Txt key={i} variant="body" color={colors.text.primary}>
                <Spans spans={b.spans} />
              </Txt>
            );
          case 'heading':
            return (
              <Txt key={i} variant={b.level <= 2 ? 'title2' : 'calloutStrong'} color={colors.text.primary} style={styles.heading}>
                <Spans spans={b.spans} variant="calloutStrong" />
              </Txt>
            );
          case 'list':
            return <ListBlock key={i} block={b} depth={depth} />;
          case 'code':
            return <CodeBlock key={i} block={b} />;
          case 'quote':
            return (
              <View key={i} style={styles.quote}>
                <Blocks blocks={b.blocks} depth={depth} />
              </View>
            );
          case 'hr':
            return <View key={i} style={styles.hr} />;
          case 'table':
            return <TableBlock key={i} block={b} />;
          default:
            return <Fragment key={i} />;
        }
      })}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <View style={styles.block}>
      <Blocks blocks={parseMarkdown(text)} depth={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[3] },
  heading: { marginTop: space[2] },
  list: { gap: space[1] },
  bulletRow: { flexDirection: 'row', gap: space[3] },
  marker: { minWidth: 14 },
  flex: { flex: 1, gap: space[1] },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  code: { backgroundColor: colors.bg.inset, borderRadius: radius.sm },
  codeBlock: {
    borderRadius: radius.md,
    backgroundColor: colors.bg.inset,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    overflow: 'hidden',
  },
  codeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    backgroundColor: colors.bg.overlay,
  },
  codeScroll: { padding: space[4] },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.border.strong,
    paddingLeft: space[4],
    gap: space[2],
  },
  hr: { height: 1, backgroundColor: colors.border.subtle, marginVertical: space[2] },
  tableScroll: { paddingBottom: space[2] },
  table: {
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row' },
  headRow: { backgroundColor: colors.bg.overlay },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  cell: { paddingHorizontal: space[3], paddingVertical: space[2], justifyContent: 'center' },
  cellText: { fontSize: CELL_FONT, lineHeight: 20 },
});
