// Aperçu d'un fichier du Mac. LECTURE SEULE, sans exception.
//
// L'édition de fichiers depuis l'iPhone est hors périmètre (PRD section 6) : aucun champ
// éditable n'existe ici, et aucune route d'écriture ne prend un contenu de fichier. Toute
// modification passe par l'agent.
//
// Rendus couverts (PRD C2) : images, PDF, texte et code, markdown. Tout le reste affiche
// ses métadonnées et propose l'enregistrement, ce qui est un état de premier ordre et non
// un cas limite.
import { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { TEXT_PREVIEW_TRUNCATED } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { Icon } from '@/ui/Icon';
import { fetchText, fileUrl, type DownloadPhase } from '@/net/files';
import { saveToDevice, shareFile } from '@/features/files/pick';
import { humanSize, previewKind, truncateMiddle } from '@/features/files/format';
import { describe } from '@/store/transfers';

interface Meta {
  name: string;
  ext: string;
  mime: string | null;
}

function metaOf(path: string): Meta {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return { name, ext, mime: null };
}

export default function PreviewScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ path?: string; mime?: string }>();
  const path = params.path ?? '';
  const meta = metaOf(path);
  const mime = params.mime ?? null;
  const kind = previewKind({ kind: 'file', mime, ext: meta.ext });

  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const [remote, setRemote] = useState<{ url: string; headers: Record<string, string> } | null>(null);
  // Chemin déjà chargé. `loading` s'en DÉDUIT au lieu d'être posé dans le corps de
  // l'effet, ce qui provoquerait un rendu en cascade à chaque montage.
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savePhase, setSavePhase] = useState<DownloadPhase>('downloading');
  const [saved, setSaved] = useState<{ name: string; verified: boolean } | null>(null);
  const loading = loadedPath !== path && error === null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!path) {
        if (alive) setError(t.previewNoPath);
        return;
      }
      try {
        if (kind === 'text' || kind === 'markdown') {
          const res = await fetchText(path);
          if (!alive) return;
          setText(res.text);
          setTruncated(res.truncated);
          setSize(res.size);
        } else if (kind === 'image' || kind === 'pdf') {
          const r = await fileUrl(path);
          if (!alive) return;
          setRemote(r);
        }
        if (alive) {
          setError(null);
          setLoadedPath(path);
        }
      } catch (e) {
        if (alive) setError(describe(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, kind]);

  /**
   * Enregistrer sur l'iPhone : téléchargement en flux, vérification de l'empreinte
   * SHA-256 contre celle du Mac (CA-101), puis feuille de partage iOS. Une divergence
   * s'affiche telle quelle : le fichier a été supprimé, rien n'est partagé.
   */
  const save = async (): Promise<void> => {
    setSaving(true);
    setSavePhase('downloading');
    setError(null);
    try {
      const { file, verified } = await saveToDevice(path, meta.name, { onPhase: setSavePhase });
      setSaved({ name: file.name, verified });
      await shareFile(file, mime);
    } catch (e) {
      setError(describe(e));
    } finally {
      setSaving(false);
    }
  };
  const savingLabel = savePhase === 'verifying' ? t.previewVerifying : t.filesDownloading;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <LinkAction label={t.previewClose} onPress={() => router.back()} />
        <Txt variant="title2" color={colors.text.primary} numberOfLines={1} style={styles.title}>
          {truncateMiddle(meta.name, 28)}
        </Txt>
        <View style={styles.grow} />
        <LinkAction label={saving ? savingLabel : t.filesShare} disabled={saving} onPress={() => void save()} />
      </View>

      {error ? (
        <Banner tone="error" text={error} actionLabel={t.actionRetry} onAction={() => setError(null)} />
      ) : null}

      {saved ? (
        <Banner
          tone={saved.verified ? 'info' : 'warn'}
          text={
            saved.verified
              ? t.previewSavedVerified(saved.name)
              : t.previewSavedUnverified(saved.name)
          }
        />
      ) : null}

      {truncated ? (
        // La troncature est ANNONCÉE : un fichier coupé en silence ferait croire à Robin
        // qu'il a tout lu (CA-99).
        <Banner
          tone="warn"
          text={t.previewTruncated(humanSize(size), humanSize(TEXT_PREVIEW_TRUNCATED))}
        />
      ) : null}

      {loading ? <SkeletonList count={5} height={44} /> : null}

      {!loading && !error ? (
        <Body
          kind={kind}
          text={text}
          remote={remote}
          meta={meta}
          mime={mime}
          size={size}
          width={width}
          path={path}
        />
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[3] }]}>
        <Button
          label={saving ? savingLabel : t.previewSave}
          disabled={saving}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}

function Body({
  kind,
  text,
  remote,
  meta,
  mime,
  size,
  width,
  path,
}: {
  kind: ReturnType<typeof previewKind>;
  text: string | null;
  remote: { url: string; headers: Record<string, string> } | null;
  meta: Meta;
  mime: string | null;
  size: number | null;
  width: number;
  path: string;
}) {
  if (kind === 'image' && remote) {
    return (
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: remote.url, headers: remote.headers }}
          style={{ width: width - space[8], height: width - space[8] }}
          resizeMode="contain"
          accessibilityLabel={meta.name}
        />
      </View>
    );
  }

  if (kind === 'pdf' && remote) {
    // La visionneuse PDF native d'iOS est celle de la WebView : elle pagine, zoome et
    // rend un document de 50 pages sans qu'on écrive un rendu maison (CA-98).
    if (Platform.OS !== 'ios') {
      return <EmptyState icon="file-text" title={t.previewPdfIosOnly} body={path} />;
    }
    return (
      <WebView
        style={styles.web}
        source={{ uri: remote.url, headers: remote.headers }}
        originWhitelist={['https://*']}
        allowsInlineMediaPlayback
      />
    );
  }

  if ((kind === 'text' || kind === 'markdown') && text !== null) {
    if (text.length === 0) {
      return <EmptyState icon="file" title={t.previewEmptyFile} body={t.previewEmptyBody} />;
    }
    const lines = text.split('\n');
    return (
      <ScrollView style={styles.code} contentContainerStyle={styles.codeContent}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {lines.map((line, i) => (
              <View key={i} style={styles.codeLine}>
                <Txt variant="monoCode" color={colors.text.tertiary} style={styles.gutter}>
                  {String(i + 1).padStart(4, ' ')}
                </Txt>
                <Txt variant="monoCode" color={colors.text.primary}>
                  {line || ' '}
                </Txt>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    );
  }

  // Format non pris en charge : métadonnées et enregistrement (PRD C2). C'est un état
  // spécifié, pas un écran d'erreur.
  return (
    <ScrollView contentContainerStyle={styles.metaBox}>
      <Icon name="file" size={24} color={colors.text.tertiary} />
      <Txt variant="title2" color={colors.text.primary} align="center">
        {t.previewUnavailable}
      </Txt>
      <View style={styles.metaRows}>
        <MetaRow label={t.previewMetaName} value={meta.name} />
        <MetaRow label={t.previewMetaType} value={mime ?? t.previewUnknownType(meta.ext || t.previewNoExtension)} />
        <MetaRow label={t.previewMetaSize} value={size === null ? t.previewUnknownSize : humanSize(size)} />
        <MetaRow label={t.previewMetaPath} value={path} />
      </View>
    </ScrollView>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Txt variant="caption" color={colors.text.tertiary}>
        {label}
      </Txt>
      <Txt variant="monoPath" color={colors.text.secondary}>
        {value}
      </Txt>
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
  title: { flexShrink: 1 },
  grow: { flex: 1 },
  imageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.inset },
  web: { flex: 1, backgroundColor: colors.bg.inset },
  code: { flex: 1, backgroundColor: colors.bg.inset },
  codeContent: { padding: space[4] },
  codeLine: { flexDirection: 'row', gap: space[4] },
  gutter: { opacity: 0.6 },
  metaBox: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], padding: space[6] },
  metaRows: { alignSelf: 'stretch', gap: space[3], marginTop: space[4] },
  metaRow: {
    gap: space[1],
    padding: space[4],
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
