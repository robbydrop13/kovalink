// Ligne de fichier ou de dossier, 60 pt (design 4.7).
//
// Ce composant n'expose AUCUNE action destructrice, et il n'y a rien à retirer : le PRD
// exclut renommer, déplacer, dupliquer et supprimer, et le daemon ne sert aucune route
// qui les rendrait possibles. La seule action secondaire est `Partager`.
import { Pressable, StyleSheet, View } from 'react-native';
import type { FsEntry } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { glyphFor, humanSize, shortDate, truncateMiddle } from './format';

interface Props {
  entry: FsEntry;
  onPress: () => void;
  onShare?: () => void;
  selected?: boolean;
  selecting?: boolean;
}

export function FileRow({ entry, onPress, onShare, selected = false, selecting = false }: Props) {
  const isDir = entry.kind === 'dir';
  // Une entrée que `lstat` n'a pas pu lire reste VISIBLE et grisée : la faire disparaître
  // ferait croire que le dossier est plus vide qu'il ne l'est.
  const tint = entry.readable ? colors.text.primary : colors.text.disabled;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.name}, ${isDir ? 'dossier' : humanSize(entry.size)}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onShare}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {selecting ? (
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected ? (
            <Txt variant="caption" color={colors.text.onFill}>
              ✓
            </Txt>
          ) : null}
        </View>
      ) : (
        <Txt variant="body" color={isDir ? colors.accent.primary : colors.text.tertiary}>
          {glyphFor(entry)}
        </Txt>
      )}

      <View style={styles.body}>
        <Txt variant="body" color={tint} numberOfLines={1}>
          {truncateMiddle(entry.name, 34)}
        </Txt>
        {entry.kind === 'symlink' && entry.linkTarget ? (
          // La cible est affichée, jamais suivie en silence : un lien qui sort du dossier
          // doit se voir.
          <Txt variant="caption" color={colors.text.tertiary} numberOfLines={1}>
            → {truncateMiddle(entry.linkTarget, 38)}
          </Txt>
        ) : null}
        {!entry.readable ? (
          <Txt variant="caption" color={colors.status.error}>
            illisible
          </Txt>
        ) : null}
      </View>

      <View style={styles.meta}>
        <Txt variant="footnote" color={colors.text.tertiary}>
          {isDir ? '--' : humanSize(entry.size)}
        </Txt>
        <Txt variant="caption" color={colors.text.tertiary}>
          {shortDate(entry.mtime)}
        </Txt>
      </View>

      {isDir && !selecting ? (
        <Txt variant="footnote" color={colors.text.tertiary}>
          ›
        </Txt>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  body: { flex: 1, gap: space[1] },
  meta: { alignItems: 'flex-end' },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
});

/** En-tête de tri, 24 pt. Chevron sur la colonne active (design 4.7). */
export function SortHeader({
  sort,
  dir,
  onSort,
}: {
  sort: 'name' | 'size' | 'mtime';
  dir: 'asc' | 'desc';
  onSort: (key: 'name' | 'size' | 'mtime') => void;
}) {
  const arrow = dir === 'asc' ? '↑' : '↓';
  const cell = (key: 'name' | 'size' | 'mtime', label: string, style?: object) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Trier par ${label}`}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={() => onSort(key)}
      style={style}
    >
      <Txt variant="caption" color={sort === key ? colors.accent.primary : colors.text.tertiary}>
        {label}
        {sort === key ? ` ${arrow}` : ''}
      </Txt>
    </Pressable>
  );
  return (
    <View style={headerStyles.row}>
      {cell('name', 'Nom', headerStyles.grow)}
      {cell('size', 'Taille')}
      {cell('mtime', 'Modifié')}
    </View>
  );
}

const headerStyles = StyleSheet.create({
  row: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    paddingHorizontal: layout.screenPaddingH,
  },
  grow: { flex: 1 },
});
