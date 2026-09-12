// Markdown de base, lot 1 : gras, italique, code en ligne, liens, listes, titres.
//
// Le rendu enrichi du contenu déplié (coloration syntaxique, diffs teintés) est en lot 2.
// Une dépendance de rendu Markdown complète est également en lot 2 : ici, un rendu minimal
// suffit et évite d'embarquer une bibliothèque pour six règles.
import { Fragment, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';

type Segment =
  | { kind: 'plain'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;

function parseInline(input: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of input.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: 'plain', text: input.slice(last, idx) });
    const token = m[0];
    if (token.startsWith('`')) out.push({ kind: 'code', text: token.slice(1, -1) });
    else if (token.startsWith('**')) out.push({ kind: 'bold', text: token.slice(2, -2) });
    else if (token.startsWith('[')) {
      const sep = token.indexOf('](');
      out.push({
        kind: 'link',
        text: token.slice(1, sep),
        href: token.slice(sep + 2, -1),
      });
    } else out.push({ kind: 'italic', text: token.slice(1, -1) });
    last = idx + token.length;
  }
  if (last < input.length) out.push({ kind: 'plain', text: input.slice(last) });
  return out;
}

function Inline({ text }: { text: string }): ReactNode {
  return (
    <>
      {parseInline(text).map((seg, i) => {
        if (seg.kind === 'code') {
          return (
            <Txt key={i} variant="monoCodeInline" color={colors.text.primary} style={styles.code}>
              {seg.text}
            </Txt>
          );
        }
        if (seg.kind === 'link') {
          return (
            <Txt
              key={i}
              color={colors.accent.primary}
              style={styles.link}
              onPress={() => void Linking.openURL(seg.href).catch(() => undefined)}
            >
              {seg.text}
            </Txt>
          );
        }
        return (
          <Txt
            key={i}
            variant={seg.kind === 'bold' ? 'bodyStrong' : 'body'}
            color={colors.text.primary}
            style={seg.kind === 'italic' ? styles.italic : undefined}
          >
            {seg.text}
          </Txt>
        );
      })}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return (
    <View style={styles.block}>
      {lines.map((line, i) => {
        if (line.trim() === '') return <View key={i} style={styles.gap} />;
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <Txt key={i} variant="calloutStrong" color={colors.text.primary}>
              {heading[2] ?? ''}
            </Txt>
          );
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <View key={i} style={styles.bulletRow}>
              <Txt variant="body" color={colors.text.secondary}>
                •
              </Txt>
              <Txt variant="body" color={colors.text.primary} style={styles.flex}>
                <Inline text={bullet[1] ?? ''} />
              </Txt>
            </View>
          );
        }
        const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
        if (ordered) {
          return (
            <View key={i} style={styles.bulletRow}>
              <Txt variant="body" color={colors.text.secondary}>
                {ordered[1]}.
              </Txt>
              <Txt variant="body" color={colors.text.primary} style={styles.flex}>
                <Inline text={ordered[2] ?? ''} />
              </Txt>
            </View>
          );
        }
        return (
          <Fragment key={i}>
            <Txt variant="body" color={colors.text.primary}>
              <Inline text={line} />
            </Txt>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[1] },
  gap: { height: space[4] },
  bulletRow: { flexDirection: 'row', gap: space[3] },
  flex: { flex: 1 },
  italic: { fontStyle: 'italic' },
  link: { textDecorationLine: 'underline' },
  code: {
    backgroundColor: colors.bg.inset,
    borderRadius: radius.sm,
  },
});
