// Palette de commande, le gabarit des deux raccourcis de Kova sur l'iPhone : Cmd+P (les
// panes) et Cmd+O (les projets récents). Recherche en haut avec le clavier ouvert
// d'emblée, lignes compactes dessous, fermeture par balayage vers le bas (présentation
// modale) ou par le lien `Fermer`. Le même composant sert aux deux : seules les lignes
// et l'action au tap changent.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, radius, space } from '@/theme';
import { LinkAction } from '@/ui/Button';
import { EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { SwipeRow, type SwipeActions } from '@/features/sessions/SwipeRow';

/** Une ligne de palette. Tout est du texte déjà formaté : la palette ne calcule rien. */
export interface PaletteRow {
  key: string;
  /** Pastille de couleur à gauche (couleur d'onglet Kova), `null` pour un point neutre. */
  tint: string | null;
  /** Texte discret AVANT le titre, comme le nom d'onglet dans le sélecteur de Kova. */
  prefix?: string;
  title: string;
  subtitle: string;
  /** Badge à droite : état d'un pane, ancienneté d'un projet. */
  badge?: string;
  badgeColor?: string;
  /** Ligne mise en avant (projet d'une session à relancer). */
  highlighted?: boolean;
  disabled?: boolean;
  /** Ligne en retrait sous la précédente (session fermée d'un projet). */
  indent?: boolean;
  /** Intertitre de section, rendu en légende et non en ligne. */
  section?: boolean;
  /** Balayage : fermer, favori, renommer (panes ouverts seulement). */
  swipe?: SwipeActions;
  /** Étoile : session en favori dans Kova, en tête de liste. */
  starred?: boolean;
}

interface Props {
  title: string;
  placeholder: string;
  hint?: string;
  /** `null` tant que les lignes chargent : squelettes. */
  rows: PaletteRow[] | null;
  query: string;
  onQuery: (q: string) => void;
  onPick: (row: PaletteRow) => void;
  /** Appui long : action secondaire (lire une session fermée sans la reprendre). */
  onLongPress?: (row: PaletteRow) => void;
  emptyTitle: string;
  emptyBody: string;
  /** Bandeaux au dessus de la recherche (liaison, erreur). */
  banners?: ReactNode;
  accessibilityLabel: string;
}

export function Palette({
  title,
  placeholder,
  hint,
  rows,
  query,
  onQuery,
  onPick,
  onLongPress,
  emptyTitle,
  emptyBody,
  banners,
  accessibilityLabel,
}: Props) {
  const insets = useSafeAreaInsets();
  const input = useRef<TextInput>(null);
  const [ready, setReady] = useState(false);

  // Le clavier s'ouvre d'emblée, comme la palette de Kova prend le focus. `autoFocus`
  // seul arrive parfois avant la fin de l'animation modale sur iOS : on insiste après.
  useEffect(() => {
    const timer = setTimeout(() => {
      input.current?.focus();
      setReady(true);
    }, 250);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[3] }]}>
      <View style={styles.nav}>
        <View style={styles.grabber} accessibilityElementsHidden />
      </View>
      <View style={styles.header}>
        <Txt variant='title2' color={colors.text.primary}>
          {title}
        </Txt>
        <View style={styles.grow} />
        <LinkAction label='Fermer' onPress={() => router.back()} />
      </View>

      {banners}

      <View style={styles.searchRow}>
        <TextInput
          ref={input}
          style={styles.search}
          placeholder={placeholder}
          placeholderTextColor={colors.text.tertiary}
          value={query}
          onChangeText={onQuery}
          autoFocus
          autoCorrect={false}
          autoCapitalize='none'
          clearButtonMode='while-editing'
          keyboardAppearance='dark'
          returnKeyType='search'
          accessibilityLabel={accessibilityLabel}
        />
      </View>
      {hint ? (
        <Txt variant='caption' color={colors.text.tertiary} style={styles.hint}>
          {hint}
        </Txt>
      ) : null}

      <ScrollView
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space[8] },
        ]}
      >
        {rows === null ? <SkeletonList count={6} height={52} /> : null}
        {rows !== null && rows.length === 0 && ready ? (
          <EmptyState title={emptyTitle} body={emptyBody} />
        ) : null}
        <View style={styles.stack}>
          {(rows ?? []).map((row) => {
            if (row.section) {
              return (
                <Txt key={row.key} variant='caption' color={colors.text.tertiary} style={styles.section}>
                  {row.title}
                </Txt>
              );
            }
            const line = (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={`${row.prefix ? `${row.prefix}, ` : ''}${row.title}, ${row.subtitle}${row.badge ? `, ${row.badge}` : ''}`}
                accessibilityState={{ disabled: row.disabled === true }}
                disabled={row.disabled === true}
                onPress={() => onPick(row)}
                onLongPress={onLongPress ? () => onLongPress(row) : undefined}
                style={({ pressed }) => [
                  styles.row,
                  row.indent && styles.indent,
                  row.highlighted && styles.highlighted,
                  pressed && styles.pressed,
                  row.disabled && styles.dim,
                ]}
              >
                <View style={[styles.dot, { backgroundColor: row.tint ?? colors.tabNone }]} />
                <View style={styles.body}>
                  <View style={styles.line}>
                    {row.starred ? (
                      <Txt variant='callout' color={colors.status.awaiting} accessibilityLabel='bookmarked'>
                        ★
                      </Txt>
                    ) : null}
                    {row.prefix ? (
                      <Txt variant='callout' color={colors.text.secondary} numberOfLines={1} style={styles.prefix}>
                        {row.prefix}
                      </Txt>
                    ) : null}
                    <Txt variant='calloutStrong' color={colors.text.primary} numberOfLines={1} style={styles.title}>
                      {row.title}
                    </Txt>
                  </View>
                  <Txt variant='footnote' color={colors.text.tertiary} numberOfLines={1}>
                    {row.subtitle}
                  </Txt>
                </View>
                {row.badge ? (
                  <Txt variant='caption' color={row.badgeColor ?? colors.text.tertiary} numberOfLines={1}>
                    {row.badge}
                  </Txt>
                ) : null}
              </Pressable>
            );
            return row.swipe ? (
              <SwipeRow key={row.key} actions={row.swipe}>
                {line}
              </SwipeRow>
            ) : (
              <Fragment key={row.key}>{line}</Fragment>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  nav: { alignItems: 'center', height: 10 },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border.strong,
  },
  header: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingH,
  },
  grow: { flex: 1 },
  searchRow: {
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: space[3],
  },
  search: {
    height: 40,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.focus,
    color: colors.text.primary,
    fontSize: 16,
  },
  hint: { paddingHorizontal: layout.screenPaddingH, marginBottom: space[2] },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: space[2] },
  stack: { gap: space[2] },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
  },
  highlighted: { borderWidth: 1, borderColor: colors.accent.primary },
  indent: { marginLeft: space[6], minHeight: 44 },
  section: { marginTop: space[4], marginBottom: space[1], letterSpacing: 0.6 },
  pressed: { backgroundColor: colors.bg.pressed },
  dim: { opacity: 0.5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  body: { flex: 1, gap: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  prefix: { flexShrink: 0, maxWidth: '45%' },
  title: { flexShrink: 1 },
});
