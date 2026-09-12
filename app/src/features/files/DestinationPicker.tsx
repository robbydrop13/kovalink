// Sélecteur de destination. Utilisé par l'écran Fichiers et par le flux de partage.
//
// Ordre imposé par le design 4.8 et le PRD S7 : les 3 dernières destinations utilisées,
// puis le `cwd` du pane focalisé et les autres panes, puis les projets récents de Kova,
// puis les dossiers système. Le pane focalisé en tête, c'est littéralement le
// « directement dans le bon dossier » demandé par Robin.
//
// La première ligne est PRÉ-SÉLECTIONNÉE : un seul tap sur `Envoyer` doit suffire.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { QuickDest } from '@/protocol';
import { colors, radius, space } from '@/theme';
import { Banner, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { fetchQuickDests } from '@/net/files';
import { loadRecentDests, type RecentDest } from '@/store/files';
import { describe } from '@/store/transfers';

export interface DestOption {
  path: string;
  label: string;
  badge: string;
  writable: boolean;
}

/** Six lignes au maximum, le reste passe par `Choisir un autre dossier…` (PRD S7). */
const DEST_LIST_MAX = 6;

function mergeDestinations(recents: RecentDest[], quick: QuickDest[]): DestOption[] {
  const out: DestOption[] = [];
  const seen = new Set<string>();
  const push = (o: DestOption): void => {
    if (seen.has(o.path)) return;
    seen.add(o.path);
    out.push(o);
  };

  for (const r of recents) {
    const known = quick.find((q) => q.path === r.path);
    push({
      path: r.path,
      label: r.label,
      badge: 'dernier envoi',
      // Une destination récente peut être devenue non inscriptible entre deux usages :
      // on croit le daemon, pas l'historique local.
      writable: known ? known.writable : true,
    });
  }
  for (const q of quick) {
    push({ path: q.path, label: q.label, badge: q.badge, writable: q.writable });
  }
  return out;
}

interface DestSnapshot {
  options: DestOption[];
  home: string | null;
  error: string | null;
  /** Numéro du chargement qui a produit cet instantané. `loading` s'en déduit. */
  tick: number;
}

/**
 * Charge les destinations.
 *
 * Un SEUL `setState`, et il a lieu après l'attente : l'état de chargement se déduit de la
 * comparaison des numéros de tour, il n'est pas posé à part. Un `setLoading(true)` dans le
 * corps de l'effet déclencherait un rendu en cascade à chaque montage.
 */
export function useDestinations(): {
  options: DestOption[];
  home: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [snapshot, setSnapshot] = useState<DestSnapshot>({
    options: [],
    home: null,
    error: null,
    tick: -1,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [recents, quick] = await Promise.all([loadRecentDests(), fetchQuickDests()]);
        if (!alive) return;
        setSnapshot({
          options: mergeDestinations(recents, quick.dests),
          home: quick.home,
          error: null,
          tick,
        });
      } catch (e) {
        if (!alive) return;
        // Le message du daemon ou du réseau, tel quel : il dit si le Mac est endormi,
        // si le jeton est révoqué, ou si la route a répondu autre chose.
        setSnapshot({ options: [], home: null, error: describe(e), tick });
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  return {
    options: snapshot.options,
    home: snapshot.home,
    loading: snapshot.tick !== tick,
    error: snapshot.error,
    reload: () => setTick((t) => t + 1),
  };
}

export function DestinationPicker({
  options,
  selected,
  onSelect,
  onBrowse,
  loading,
  error,
  onRetry,
  max = DEST_LIST_MAX,
}: {
  options: DestOption[];
  selected: string | null;
  onSelect: (option: DestOption) => void;
  onBrowse?: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  max?: number;
}) {
  if (loading) return <SkeletonList count={4} height={56} />;

  if (error) {
    return (
      <Banner
        tone="error"
        text={`Destinations indisponibles : ${error}`}
        {...(onRetry ? { actionLabel: 'Réessayer', onAction: onRetry } : {})}
      />
    );
  }

  if (options.length === 0) {
    return (
      <Banner
        tone="warn"
        text="Aucune destination proposée. Ouvre un pane dans Kova, ou choisis un dossier à la main."
        {...(onBrowse ? { actionLabel: 'Parcourir', onAction: onBrowse } : {})}
      />
    );
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {options.slice(0, max).map((o) => {
        const active = o.path === selected;
        return (
          <Pressable
            key={o.path}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: !o.writable }}
            accessibilityLabel={`${o.label}, ${o.badge}`}
            disabled={!o.writable}
            onPress={() => onSelect(o)}
            style={({ pressed }) => [
              styles.option,
              active && styles.optionActive,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.radio, active && styles.radioOn]} />
            <View style={styles.body}>
              <Txt
                variant="body"
                color={o.writable ? colors.text.primary : colors.text.disabled}
                numberOfLines={1}
              >
                {o.label}
              </Txt>
              {/* Un dossier de la liste noire reste VISIBLE et barré : « pourquoi il n'est
                  pas là » est une question plus coûteuse que « pourquoi il est grisé ». */}
              <Txt variant="caption" color={colors.text.tertiary} numberOfLines={1}>
                {o.writable ? o.badge : 'écriture refusée sur ce chemin'}
              </Txt>
            </View>
          </Pressable>
        );
      })}

      {onBrowse ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choisir un autre dossier"
          onPress={onBrowse}
          style={({ pressed }) => [styles.browse, pressed && styles.pressed]}
        >
          <Txt variant="callout" color={colors.accent.primary}>
            Choisir un autre dossier…
          </Txt>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  listContent: { gap: space[2] },
  option: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionActive: { borderColor: colors.accent.primary, backgroundColor: colors.accent.subtleBg },
  pressed: { backgroundColor: colors.bg.pressed },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border.strong,
  },
  radioOn: { borderColor: colors.accent.primary, borderWidth: 6 },
  body: { flex: 1, gap: space[1] },
  browse: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
});
