// Pièces jointes du chat, la partie ÉCRAN (docs/15).
//
// Deux rendus, un seul vocabulaire : dans le composer, des vignettes retirables d'un tap
// avec la progression du transfert ; dans la bulle utilisateur, les mêmes vignettes, le
// chemin masqué, et un tap qui ouvre l'aperçu existant du bloc Fichiers. Aucune image
// n'est chargée en mémoire par ce module : la vignette locale est lue par iOS depuis
// l'`uri`, la vignette du Mac par `fileUrl`, comme l'aperçu.
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { colors, radius, space } from '@/theme';
import { Txt } from '@/ui/Txt';
import { fileUrl } from '@/net/files';
import { humanSize, truncateMiddle } from '@/features/files/format';
import { pickFromCamera, pickFromFiles, pickFromPhotos, type Candidate } from '@/features/files/pick';
import { progressOf, useTransfers } from '@/store/transfers';
import { displayNameOf, isImageMime, mimeOfName, type Attachment } from './attachments';

const THUMB = 64;

/** Le sélecteur du « + » : Photos, Appareil photo, Fichiers. Ceux du bloc Fichiers. */
export function askAttachmentSource(onPicked: (items: Attachment[]) => void, onError: (message: string) => void): void {
  const run = (pick: () => Promise<Candidate[]>): void => {
    void pick()
      .then((picked) => {
        if (picked.length === 0) return;
        onPicked(
          picked.map((c) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            uri: c.uri,
            name: c.name,
            size: c.size,
            mime: mimeOfName(c.name),
            path: null,
          })),
        );
      })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };
  Alert.alert('Ajouter une pièce jointe', undefined, [
    { text: 'Photos', onPress: () => run(pickFromPhotos) },
    { text: 'Appareil photo', onPress: () => run(pickFromCamera) },
    { text: 'Fichiers', onPress: () => run(pickFromFiles) },
    { text: 'Annuler', style: 'cancel' },
  ]);
}

/**
 * A4 : au delà de 100 Mo en données cellulaires, l'envoi attend un choix explicite. Une
 * seule question pour tout le message, pas une par pièce.
 */
export function confirmCellularSend(bytes: number): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Envoi en données cellulaires',
      `${humanSize(bytes)} de pièces jointes partiraient en cellulaire. Envoyer maintenant ?`,
      [
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Envoyer maintenant', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Vignettes du composer, avant envoi. Retirables tant que rien ne part. */
export function AttachmentStrip({
  items,
  sending,
  onRemove,
}: {
  items: Attachment[];
  sending: boolean;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      keyboardShouldPersistTaps="handled"
    >
      {items.map((a) => (
        <StripThumb key={a.id} item={a} sending={sending} onRemove={() => onRemove(a.id)} />
      ))}
    </ScrollView>
  );
}

function StripThumb({ item, sending, onRemove }: { item: Attachment; sending: boolean; onRemove: () => void }) {
  // Le transfert de cette pièce, s'il est en cours : même file que l'écran Fichiers.
  const transfer = useTransfers((s) => s.items.find((t) => t.id.startsWith(`${item.id}-`)));
  const ratio = transfer ? progressOf(transfer) : item.path ? 1 : 0;
  const label = item.path
    ? 'arrivée'
    : transfer?.phase === 'hashing'
      ? 'empreinte…'
      : transfer?.state === 'paused'
        ? 'reprise…'
        : transfer
          ? `${Math.round(ratio * 100)} %`
          : null;
  return (
    <View style={styles.thumbWrap}>
      <LocalThumb item={item} />
      {sending && label ? (
        <View style={styles.progressOverlay}>
          <View style={[styles.progressBar, { width: `${Math.max(4, Math.round(ratio * 100))}%` }]} />
          <Txt variant="caption" color={colors.text.onFill}>
            {label}
          </Txt>
        </View>
      ) : null}
      {!sending ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retirer ${item.name}`}
          hitSlop={8}
          onPress={onRemove}
          style={styles.remove}
        >
          <Txt variant="caption" color={colors.text.onFill}>
            ×
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Vignette d'un fichier de l'iPhone : image, ou glyphe et nom. */
function LocalThumb({ item }: { item: Attachment }) {
  if (isImageMime(item.mime)) {
    return <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" accessibilityLabel={item.name} />;
  }
  return <FileTile name={item.name} size={item.size} />;
}

function FileTile({ name, size }: { name: string; size: number | null }) {
  return (
    <View style={[styles.thumb, styles.fileTile]}>
      <Txt variant="title2" color={colors.text.tertiary}>
        ▫
      </Txt>
      <Txt variant="caption" color={colors.text.secondary} numberOfLines={1}>
        {truncateMiddle(name, 12)}
      </Txt>
      {size !== null ? (
        <Txt variant="caption" color={colors.text.tertiary}>
          {humanSize(size)}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * Pièces d'une bulle utilisateur. Deux origines : une bulle locale (le fichier est sur
 * l'iPhone, `local`), ou un tour du transcript (seul le chemin sur le Mac est connu,
 * `paths`). Un tap ouvre l'aperçu du bloc Fichiers, sur le Mac, dans les deux cas dès
 * que le chemin est connu.
 */
/**
 * Vignettes d'une bulle. `images` : photos collées dont le transcript ne garde qu'un bloc
 * `image` sans chemin (Claude Code a remplacé la ligne de chemin) : une tuile « photo »,
 * non ouvrable, pour que le tour réel garde la silhouette de la bulle locale.
 */
export function AttachmentChips({
  local,
  paths,
  images = 0,
}: {
  local?: Attachment[];
  paths?: string[];
  images?: number;
}) {
  const items: { key: string; path: string | null; local: Attachment | null }[] = [
    ...(local ?? []).map((a) => ({ key: a.id, path: a.path, local: a })),
    ...(paths ?? []).map((p) => ({ key: p, path: p, local: null })),
    ...Array.from({ length: images }, (_, i) => ({ key: `image-${i}`, path: null, local: null })),
  ];
  if (items.length === 0) return null;
  return (
    <View style={styles.chips}>
      {items.map((it) => (
        <Pressable
          key={it.key}
          accessibilityRole={it.path ? 'button' : undefined}
          accessibilityLabel={it.local?.name ?? (it.path ? displayNameOf(it.path) : 'photo')}
          disabled={!it.path}
          onPress={() => {
            if (!it.path) return;
            const mime = it.local?.mime ?? mimeOfName(it.path);
            router.push({ pathname: '/files/preview', params: { path: it.path, ...(mime ? { mime } : {}) } });
          }}
          style={styles.thumbWrap}
        >
          {it.local ? (
            <LocalThumb item={it.local} />
          ) : it.path ? (
            <RemoteThumb path={it.path} />
          ) : (
            <FileTile name="photo" size={null} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

/** Vignette d'une pièce déjà sur le Mac, lue par `fs/read` avec le jeton en en-tête. */
function RemoteThumb({ path }: { path: string }) {
  const name = displayNameOf(path);
  const mime = mimeOfName(path);
  const [remote, setRemote] = useState<{ url: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!isImageMime(mime)) return;
    let alive = true;
    void fileUrl(path)
      .then((r) => {
        if (alive) setRemote(r);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path, mime]);
  if (isImageMime(mime) && remote) {
    return (
      <Image
        source={{ uri: remote.url, headers: remote.headers }}
        style={styles.thumb}
        resizeMode="cover"
        accessibilityLabel={name}
      />
    );
  }
  return <FileTile name={name} size={null} />;
}

const styles = StyleSheet.create({
  strip: { gap: space[3], paddingHorizontal: space[5], paddingTop: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], justifyContent: 'flex-end' },
  thumbWrap: { width: THUMB, height: THUMB, borderRadius: radius.md, overflow: 'hidden' },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md, backgroundColor: colors.bg.inset },
  fileTile: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[2],
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  remove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.scrim,
  },
  progressOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: colors.bg.scrim,
    paddingBottom: space[2],
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 3,
    backgroundColor: colors.accent.primary,
  },
});
