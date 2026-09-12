// Cible du partage iOS : « envoyer ça sur le Mac, dans le bon dossier ».
//
// C'est le cœur de la demande de Robin, celle qu'il a formulée par « un peu comme AirDrop ».
// Trois taps au maximum, et un seul dans le cas courant, puisque la dernière destination
// utilisée est PRÉ-SÉLECTIONNÉE.
//
// Architecture du flux, et pourquoi : l'extension Swift ne fait que copier les pièces
// jointes dans le conteneur du groupe d'app puis ouvrir `kovalink://share`. Tout le reste
// (choix de destination, envoi par morceaux, reprise) vit ICI, dans l'app hôte, où le code
// existe déjà et où la limite mémoire de 120 Mo d'une extension ne s'applique pas. Écrire
// une seconde interface dans le processus de l'extension coûterait beaucoup pour un confort
// marginal.
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Directory, File, Paths } from 'expo-file-system';

import { TRANSFER_SELECTION_MAX } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner, EmptyState } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { DestinationPicker, useDestinations, type DestOption } from '@/features/files/DestinationPicker';
import { TransferList } from '@/features/files/TransferList';
import { humanSize, truncateMiddle } from '@/features/files/format';
import { pickFromFiles, pickFromPhotos } from '@/features/files/pick';
import { rememberDest, usePickedDir } from '@/store/files';
import { describe, queueUpload, useTransfers } from '@/store/transfers';
import { SHARE_EXTENSION_UNAVAILABLE_LABEL, shareExtensionAvailable } from '@/env';

interface Incoming {
  uri: string;
  name: string;
  size: number;
}

/**
 * Lit les pièces jointes déposées par l'extension.
 *
 * `root` est le chemin ABSOLU du conteneur du groupe d'app, transmis par l'extension dans
 * l'URL. Les deux processus partagent ce conteneur, donc le même chemin y désigne le même
 * fichier : c'est ce qui évite d'écrire un module natif juste pour retrouver ce dossier.
 *
 * Le fichier est COPIÉ hors du conteneur avant l'envoi : iOS purge ce dossier sans
 * prévenir, et un transfert de plusieurs minutes n'y survivrait pas.
 */
async function readIncoming(root: string): Promise<Incoming[]> {
  const dir = new Directory(root.startsWith('file://') ? root : `file://${root}`);
  if (!dir.exists) return [];
  // Hors du conteneur partagé, dans le sandbox de l'app : iOS purge le conteneur de
  // partage sans prévenir, et un transfert de plusieurs minutes n'y survivrait pas.
  const staging = new Directory(Paths.document, 'kovalink-outgoing');
  const out: Incoming[] = [];
  for (const item of dir.list()) {
    if (!(item instanceof File)) continue;
    if (item.name === 'manifest.json') continue;
    try {
      if (!staging.exists) staging.create({ intermediates: true });
      const copy = new File(staging, item.name);
      if (copy.exists) copy.delete();
      item.copy(copy);
      out.push({ uri: copy.uri, name: copy.name, size: copy.size });
    } catch {
      // Une pièce jointe illisible ne doit pas faire tomber les autres.
    }
  }
  return out.slice(0, TRANSFER_SELECTION_MAX);
}

export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ root?: string }>();
  const { options, loading, error, reload } = useDestinations();
  const transfers = useTransfers((s) => s.items);

  const [items, setItems] = useState<Incoming[]>([]);
  const [chosen, setChosen] = useState<DestOption | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Les pièces jointes n'arrivent que dans un vrai build. Dans Expo Go, l'écran reste
  // utilisable : on choisit un fichier à la main et le flux d'envoi est identique.
  //
  // La lecture est asynchrone parce qu'elle COPIE les fichiers hors du conteneur de
  // partage : plusieurs mégaoctets n'ont rien à faire sur le chemin du premier rendu.
  useEffect(() => {
    const root = params.root;
    if (!root) return;
    let alive = true;
    void (async () => {
      try {
        const found = await readIncoming(root);
        if (alive) setItems(found);
      } catch (e) {
        if (alive) setSendError(describe(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.root]);

  // Le dossier choisi à la main revient du mini navigateur par un état partagé, et il est
  // DÉRIVÉ ici plutôt que recopié dans un état local : une copie devrait être synchronisée,
  // et c'est précisément ce genre d'effet qui déclenche des rendus en cascade.
  const pickedPath = usePickedDir((s) => s.path);
  const custom: DestOption | null = pickedPath
    ? { path: pickedPath, label: pickedPath, badge: t.destPickedByHand, writable: true }
    : null;

  // Pré-sélection : le dossier choisi à la main, sinon la première destination
  // inscriptible. C'est le chemin à un tap du design 4.8.
  const selected: DestOption | null =
    chosen ?? custom ?? options.find((o) => o.writable) ?? null;
  const setSelected = setChosen;

  const total = useMemo(() => items.reduce((n, i) => n + i.size, 0), [items]);

  const addManually = (source: 'files' | 'photos'): void => {
    void (async () => {
      setSendError(null);
      try {
        const picked = source === 'files' ? await pickFromFiles() : await pickFromPhotos();
        setItems((s) => [...s, ...picked].slice(0, TRANSFER_SELECTION_MAX));
      } catch (e) {
        setSendError(describe(e));
      }
    })();
  };

  const send = (): void => {
    const dest = selected;
    if (!dest || items.length === 0) return;
    void (async () => {
      setSendError(null);
      try {
        await rememberDest(dest.path, dest.label);
        for (const item of items) {
          // `queueUpload` pose lui même la question cellulaire au delà de 100 Mo (A4) :
          // elle n'est pas dupliquée ici, sans quoi les deux seuils divergeraient.
          await queueUpload({
            id: `${Date.now()}-${item.name}-${Math.random().toString(36).slice(2, 8)}`,
            uri: item.uri,
            filename: item.name,
            size: item.size,
            destDir: dest.path,
            destLabel: dest.label,
          });
        }
        setSent(true);
      } catch (e) {
        setSendError(describe(e));
      }
    })();
  };

  const done = sent && transfers.length > 0 && transfers.every((t) => t.state === 'done');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <LinkAction label={t.actionCancel} onPress={() => router.back()} />
        <Txt variant="title2" color={colors.text.primary}>
          {t.shareTitle}
        </Txt>
        <View style={styles.grow} />
      </View>

      {/* Dégradation propre, comme `pushAvailable` le fait déjà pour les notifications :
          on prévient, on n'empêche pas. */}
      {!shareExtensionAvailable ? <Banner tone="warn" text={SHARE_EXTENSION_UNAVAILABLE_LABEL} /> : null}
      {sendError ? <Banner tone="error" text={sendError} actionLabel={t.actionDismiss} onAction={() => setSendError(null)} /> : null}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}>
        {items.length === 0 ? (
          <EmptyState
            glyph="▢"
            title={t.shareEmptyTitle}
            body={t.shareEmptyBody}
          >
            <Button label={t.sharePickPhotos} onPress={() => addManually('photos')} />
            <Button label={t.sharePickFiles} kind="secondary" onPress={() => addManually('files')} />
          </EmptyState>
        ) : (
          <>
            <View style={styles.files}>
              <Txt variant="caption" color={colors.text.tertiary}>
                {items.length === 1
                  ? humanSize(items[0]?.size ?? 0)
                  : t.shareFilesCount(items.length, humanSize(total))}
              </Txt>
              {items.map((item) => (
                <View key={item.uri} style={styles.file}>
                  <Txt variant="body" color={colors.text.primary} numberOfLines={1}>
                    {truncateMiddle(item.name, 30)}
                  </Txt>
                  <View style={styles.grow} />
                  <Txt variant="caption" color={colors.text.tertiary}>
                    {humanSize(item.size)}
                  </Txt>
                </View>
              ))}
            </View>

            <Txt variant="caption" color={colors.text.tertiary} style={styles.section}>
              {t.shareDestination}
            </Txt>
            <DestinationPicker
              options={custom ? [custom, ...options] : options}
              selected={selected?.path ?? null}
              onSelect={setSelected}
              onBrowse={() => router.push({ pathname: '/files', params: { pick: 'dir' } })}
              loading={loading}
              error={error}
              onRetry={reload}
            />
          </>
        )}

        <TransferList />
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[3] }]}>
        {done ? (
          <Button label={t.shareDone} onPress={() => router.back()} />
        ) : (
          <Button
            label={selected ? t.shareSendTo(truncateMiddle(selected.label, 22)) : t.shareChooseDest}
            disabled={!selected || items.length === 0}
            onPress={send}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  nav: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: layout.screenPaddingH,
  },
  grow: { flex: 1 },
  content: { paddingHorizontal: layout.screenPaddingH, gap: space[4] },
  section: { marginTop: space[4] },
  files: { gap: space[2] },
  file: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
  },
  bottom: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
});
