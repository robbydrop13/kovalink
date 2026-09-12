// Écran Fichiers. Lecture, téléchargement et envoi. RIEN D'AUTRE.
//
// Il n'existe ici ni `Nouveau dossier`, ni `Renommer`, ni `Dupliquer`, ni `Supprimer`, ni
// `Coller` : le PRD les exclut sans exception, et le daemon ne sert aucune route qui les
// rendrait possibles. Un balayage accidentel dans le métro est irréparable, pour un bloc
// qui pèse 4 % des ouvertures.
//
// La lecture, elle, est TOTALE sur tout le disque : c'est le choix arrêté de Robin. Seule
// l'écriture est refusée sur les chemins de démarrage et d'authentification du Mac, et ce
// refus s'affiche alors comme une règle, pas comme une panne.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FsEntry } from '@/protocol';
import { TRANSFER_SELECTION_MAX } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { Breadcrumb } from '@/features/files/Breadcrumb';
import { FileRow, SortHeader } from '@/features/files/FileRow';
import { TransferList } from '@/features/files/TransferList';
import { pickFromFiles, pickFromPhotos, saveToDevice, shareFile } from '@/features/files/pick';
import { fetchQuickDests } from '@/net/files';
import { applyFilter, rememberDest, useFiles, usePickedDir } from '@/store/files';
import { describe, queueUpload } from '@/store/transfers';
import { useConnection, isDegraded } from '@/store/connection';
import { clockTime } from '@/utils/time';
import { ImpactStyle, impact } from '@/utils/haptics';

export default function FilesScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ path?: string; pick?: string }>();
  // Mode « choisir un dossier » : ouvert par le flux de partage, il ne rend que la
  // navigation et un bouton de validation.
  const picking = params.pick === 'dir';

  const store = useFiles();
  const link = useConnection((s) => s.link);
  const degraded = isDegraded(link);

  const [selection, setSelection] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);

  const wanted = params.path ?? null;

  useEffect(() => {
    void (async () => {
      await useFiles.getState().hydrate();
      if (wanted) {
        await useFiles.getState().open(wanted);
        return;
      }
      // Racine par défaut `~` (PRD C1). C'est le DAEMON qui donne le chemin du dossier
      // personnel : l'app ne le devine pas, et surtout ne le code pas en dur.
      try {
        const quick = await fetchQuickDests();
        setHome(quick.home);
        const current = useFiles.getState().path;
        await useFiles.getState().open(current ?? quick.home);
      } catch (e) {
        setActionError(describe(e));
      }
    })();
    // Une seule initialisation par chemin demandé : le store est lu par `getState()`
    // plutôt que capturé, pour que l'effet ne dépende que de `wanted`.
  }, [wanted]);

  // Le dossier personnel sert uniquement à abréger le fil d'Ariane en `~`. Son absence
  // affiche des chemins entiers : moins joli, jamais cassé.
  useEffect(() => {
    if (home) return;
    let alive = true;
    void fetchQuickDests()
      .then((q) => {
        if (alive) setHome(q.home);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [home]);

  const entries = useMemo(
    () => applyFilter(store.entries, store.filter),
    [store.entries, store.filter],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await store.reload();
    } finally {
      setRefreshing(false);
    }
  }, [store]);

  const openEntry = (entry: FsEntry): void => {
    if (selecting) {
      if (entry.kind === 'dir') return;
      setSelection((s) =>
        s.includes(entry.path)
          ? s.filter((p) => p !== entry.path)
          : s.length >= TRANSFER_SELECTION_MAX
            ? s
            : [...s, entry.path],
      );
      return;
    }
    if (entry.kind === 'dir') {
      void store.open(entry.path);
      return;
    }
    router.push({
      pathname: '/files/preview',
      // Le type MIME vient du daemon : le redeviner ici, à partir de la seule extension,
      // serait une seconde source de vérité pour le choix de l'aperçu.
      params: { path: entry.path, ...(entry.mime ? { mime: entry.mime } : {}) },
    });
  };

  /**
   * Mac vers iPhone. Téléchargement en flux, empreinte vérifiée contre celle du Mac
   * (CA-101), puis feuille de partage iOS (PRD C3). Une divergence s'affiche telle quelle.
   */
  const share = async (entry: FsEntry): Promise<void> => {
    setBusy(entry.path);
    setActionError(null);
    try {
      const { file } = await saveToDevice(entry.path, entry.name);
      await shareFile(file, entry.mime);
    } catch (e) {
      setActionError(describe(e));
    } finally {
      setBusy(null);
    }
  };

  /** Sélection multiple : transfert SÉQUENTIEL, jamais 20 requêtes en parallèle. */
  const shareSelection = async (): Promise<void> => {
    setBusy('selection');
    setActionError(null);
    try {
      for (const path of selection) {
        const entry = store.entries.find((e) => e.path === path);
        if (!entry) continue;
        const { file } = await saveToDevice(entry.path, entry.name);
        await shareFile(file, entry.mime);
      }
      setSelecting(false);
      setSelection([]);
    } catch (e) {
      setActionError(describe(e));
    } finally {
      setBusy(null);
    }
  };

  /** iPhone vers Mac, dans le dossier COURANT : c'est le « Send here » du design. */
  const sendHere = (source: 'files' | 'photos'): void => {
    const destDir = store.path;
    if (!destDir) return;
    void (async () => {
      setActionError(null);
      try {
        const picked = source === 'files' ? await pickFromFiles() : await pickFromPhotos();
        if (picked.length === 0) return;
        await rememberDest(destDir, destDir.split('/').slice(-2).join(' / '));
        for (const c of picked) {
          await queueUpload({
            id: `${Date.now()}-${c.name}-${Math.random().toString(36).slice(2, 8)}`,
            uri: c.uri,
            filename: c.name,
            size: c.size,
            destDir,
            destLabel: destDir.split('/').slice(-2).join(' / '),
          });
        }
        impact(ImpactStyle.Light);
      } catch (e) {
        setActionError(describe(e));
      }
    })();
  };

  /**
   * Menu contextuel d'une ligne (design 4.7).
   *
   * `Preview` et `Share`, RIEN d'autre. Ni `Renommer`, ni `Dupliquer`, ni `Supprimer` :
   * ces actions n'existent nulle part dans le produit, et aucune route du daemon ne
   * permettrait de les servir.
   */
  const openMenu = (entry: FsEntry): void => {
    if (entry.kind !== 'file') return;
    Alert.alert(entry.name, store.path ?? '', [
      { text: t.filesPreview, onPress: () => router.push({ pathname: '/files/preview', params: { path: entry.path, ...(entry.mime ? { mime: entry.mime } : {}) } }) },
      { text: t.filesShare, onPress: () => void share(entry) },
      { text: t.actionCancel, style: 'cancel' },
    ]);
  };

  const askSource = (): void => {
    Alert.alert(t.filesSendHere, store.path ?? '', [
      { text: t.filesFromPhotos, onPress: () => sendHere('photos') },
      { text: t.filesFromFiles, onPress: () => sendHere('files') },
      { text: t.actionCancel, style: 'cancel' },
    ]);
  };

  // --- États dégradés, réellement implémentés -----------------------------

  if (!store.path && store.loading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Nav title={t.filesTitle} onBack={() => router.back()} />
        <SkeletonList count={6} height={60} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Nav
        title={selecting ? t.filesSelectedCount(selection.length) : t.filesTitle}
        onBack={() => (selecting ? (setSelecting(false), setSelection([])) : router.back())}
        right={
          picking ? null : (
            <LinkAction
              label={selecting ? t.actionCancel : t.filesSelect}
              onPress={() => {
                setSelecting((v) => !v);
                setSelection([]);
              }}
            />
          )
        }
      />

      {store.path ? (
        <Breadcrumb path={store.path} home={home} onNavigate={(p) => void store.open(p)} />
      ) : null}

      {/* Hors ligne : les dossiers déjà visités restent lisibles, les écritures sont
          désactivées, jamais mises en file. Écrire à l'aveugle sur un disque distant est
          trop risqué (design 4.7). */}
      {store.servedFromCacheAt !== null ? (
        <Banner
          tone="offline"
          // L'HEURE du dernier rafraîchissement, pas un âge relatif : `Date.now()` pendant
          // le rendu est une fonction impure, et l'heure se lit aussi bien.
          text={t.filesCachedBanner(clockTime(store.servedFromCacheAt))}
          actionLabel={t.actionRetry}
          onAction={() => void store.reload()}
        />
      ) : null}

      {actionError ? (
        <Banner tone="error" text={actionError} actionLabel={t.actionDismiss} onAction={() => setActionError(null)} />
      ) : null}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder={t.filesFilterPlaceholder}
          placeholderTextColor={colors.text.tertiary}
          value={store.filter}
          onChangeText={store.setFilter}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={t.filesFilterA11y}
        />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: store.showHidden }}
          accessibilityLabel={t.filesShowHiddenA11y}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={store.toggleHidden}
        >
          <Txt variant="caption" color={store.showHidden ? colors.accent.primary : colors.text.tertiary}>
            {t.filesHiddenToggle}
          </Txt>
        </Pressable>
      </View>

      <SortHeader sort={store.sort} dir={store.dir} onSort={store.setSort} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.text.secondary} />
        }
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 200) {
            void store.loadMore();
          }
        }}
        scrollEventThrottle={200}
      >
        {store.loading ? <SkeletonList count={6} height={60} /> : null}

        {/* Erreur de lecture : le message du daemon dit POURQUOI, et il est affiché tel
            quel. « Accès refusé par macOS » et « ce dossier n'existe pas » appellent deux
            gestes différents. */}
        {!store.loading && store.error ? (
          <EmptyState
            icon={store.errorCode === 'READ_DENIED' ? 'slash' : 'alert-triangle'}
            title={titleForError(store.errorCode)}
            body={store.error}
          >
            <Button label={t.actionRetry} onPress={() => void store.reload()} />
            {store.parent ? (
              <Button label={t.filesGoUp} kind="secondary" onPress={() => void store.open(store.parent as string)} />
            ) : null}
          </EmptyState>
        ) : null}

        {!store.loading && !store.error && entries.length === 0 ? (
          <EmptyState
            icon="folder"
            title={store.filter ? t.filesNoResults : t.filesEmptyFolder}
            body={store.filter ? t.filesFilterHint : undefined}
          >
            {!store.filter && !picking && !degraded ? (
              <Button label={t.filesSendHere} onPress={askSource} />
            ) : null}
          </EmptyState>
        ) : null}

        {entries.map((entry) => (
          <FileRow
            key={entry.path}
            entry={entry}
            selecting={selecting}
            selected={selection.includes(entry.path)}
            onPress={() => openEntry(entry)}
            onShare={
              entry.kind === 'file' && !selecting && busy !== entry.path
                ? () => openMenu(entry)
                : undefined
            }
          />
        ))}

        {store.loadingMore ? <SkeletonList count={2} height={60} /> : null}
        {store.hasMore && !store.loadingMore ? (
          <Pressable onPress={() => void store.loadMore()} style={styles.more}>
            <Txt variant="footnote" color={colors.accent.primary}>
              {t.filesLoadMore(store.entries.length, store.total)}
            </Txt>
          </Pressable>
        ) : null}

        <TransferList destDir={store.path ?? undefined} />
      </ScrollView>

      {/* --- Barre d'action basse ------------------------------------------ */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[3] }]}>
        {picking ? (
          <Button
            label={t.filesChooseFolder}
            onPress={() => {
              if (!store.path) return;
              // Le chemin choisi repasse par un petit état partagé plutôt que par les
              // paramètres de route : `router.back()` ne transporte rien, et un chemin
              // Unix dans une URL se fait écorcher par l'encodage.
              usePickedDir.getState().pick(store.path);
              router.back();
            }}
          />
        ) : selecting ? (
          <Button
            label={busy === 'selection' ? t.filesDownloading : t.filesShareCount(selection.length)}
            disabled={selection.length === 0 || busy !== null}
            onPress={() => void shareSelection()}
          />
        ) : (
          <Button
            label={degraded ? t.filesMacUnreachableSend : t.filesSendHere}
            disabled={degraded || !store.path}
            onPress={askSource}
          />
        )}
      </View>
    </View>
  );
}

function titleForError(code: string | null): string {
  switch (code) {
    case 'READ_DENIED':
      return t.filesErrReadDenied;
    case 'PATH_NOT_FOUND':
      return t.filesErrNotFound;
    case 'NOT_A_DIRECTORY':
      return t.filesErrNotDir;
    case 'NETWORK':
      return t.filesErrNetwork;
    default:
      return t.filesErrRead;
  }
}

function Nav({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.nav}>
      <LinkAction icon="chevron-left" label={t.filesBack} onPress={onBack} />
      <Txt variant="title2" color={colors.text.primary} numberOfLines={1}>
        {title}
      </Txt>
      <View style={styles.grow} />
      {right}
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: space[3],
  },
  search: {
    flex: 1,
    height: 36,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.raised,
    color: colors.text.primary,
    fontSize: 15,
  },
  content: { paddingHorizontal: space[2] },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  bottom: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.base,
  },
});
