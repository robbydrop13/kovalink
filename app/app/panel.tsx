// Le panneau : l'equivalent telephone du panneau lateral de Kova. Une feuille a deux
// hauteurs (moitie, plein ecran), qu'un balayage vers le bas ferme. Elle ouvre :
//   - une page web (WebView, cookies partages et magasin de donnees persistant par defaut :
//     une connexion faite une fois reste) ;
//   - un fichier `.md` du Mac, rendu par le Markdown des tours ;
//   - un fichier `.html` du Mac, dans une WebView, par la route de lecture authentifiee ;
//   - une fiche de decisions native de Kova ;
//   - la liste « Recently opened » (`kind=history`).
// Un lien touche DANS le panneau remplace ce qu'il affiche au lieu d'empiler une feuille.
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';

import { TEXT_PREVIEW_TRUNCATED } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, space } from '@/theme';
import { RoundButton } from '@/ui/Button';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { Markdown } from '@/features/chat/Markdown';
import { humanSize } from '@/features/files/format';
import { useFileSource } from '@/features/files/useFileSource';
import { HistoryList } from '@/features/panel/HistoryList';
import { PanelOpener, macHome } from '@/features/panel/open';
import { SheetView } from '@/features/panel/SheetView';
import { baseName, expandHome, hostOf, targetOfParams, type PanelTarget } from '@/features/panel/target';
import { usePanelHistory } from '@/store/panelHistory';

type View_ = PanelTarget | 'history';

export default function PanelScreen() {
  const params = useLocalSearchParams<{ kind?: string; target?: string }>();
  const [view, setView] = useState<View_ | null>(() =>
    params.kind === 'history' ? 'history' : targetOfParams(params),
  );
  // Ce que montrait le panneau avant la liste des recents : la fleche y ramene.
  const [previous, setPrevious] = useState<PanelTarget | null>(null);
  const [title, setTitle] = useState('');
  const [pageUrl, setPageUrl] = useState<string | null>(null);

  const open = useCallback((target: PanelTarget) => {
    setView(target);
    setTitle('');
    setPageUrl(null);
  }, []);

  const showHistory = (): void => {
    if (view !== null && view !== 'history') setPrevious(view);
    setView('history');
  };

  // Une page ou une fiche entre dans l'historique du telephone a l'ouverture ; un fichier
  // y entre une fois son chemin developpe (`~/`), pour se fusionner avec celui de Kova.
  useEffect(() => {
    if (view !== null && view !== 'history' && (view.kind === 'web' || view.kind === 'sheet')) {
      usePanelHistory.getState().record(view, '');
    }
  }, [view]);

  const onSheetTitle = useCallback(
    (sheetTitle: string) => {
      setTitle(sheetTitle);
      if (view !== null && view !== 'history') usePanelHistory.getState().retitle(view.target, sheetTitle);
    },
    [view],
  );

  const heading =
    view === null
      ? t.panelNothing
      : view === 'history'
        ? t.panelHistoryTitle
        : view.kind === 'web'
          ? hostOf(pageUrl ?? view.target)
          : view.kind === 'sheet'
            ? title || t.panelSheetEntry
            : baseName(view.target);

  return (
    <PanelOpener.Provider value={open}>
      <View style={styles.screen}>
        <View style={styles.header}>
          {view === 'history' && previous ? (
            <RoundButton
              icon="chevron-left"
              size={32}
              label={t.panelBackA11y}
              onPress={() => {
                setView(previous);
                setPrevious(null);
              }}
            />
          ) : null}
          <Txt variant="title2" color={colors.text.primary} numberOfLines={1} style={styles.title}>
            {heading}
          </Txt>
          {view !== null && view !== 'history' && view.kind === 'web' ? (
            <RoundButton
              icon="compass"
              size={32}
              label={t.panelSafari}
              onPress={() => void Linking.openURL(pageUrl ?? view.target).catch(() => undefined)}
            />
          ) : null}
          {view !== 'history' ? (
            <RoundButton icon="clock" size={32} label={t.panelHistoryA11y} onPress={showHistory} />
          ) : null}
        </View>

        {view === null ? <EmptyState icon="slash" title={t.panelNothing} body="" /> : null}
        {view === 'history' ? <HistoryList onOpen={open} /> : null}
        {view !== null && view !== 'history' && view.kind === 'web' ? (
          <WebView
            key={view.target}
            style={styles.web}
            source={{ uri: view.target }}
            originWhitelist={['http://*', 'https://*']}
            // Les cookies de la page vivent dans le magasin persistant par defaut (pas
            // `incognito`) et sont partages avec le reste de l'app : une connexion reste.
            sharedCookiesEnabled
            allowsBackForwardNavigationGestures
            allowsInlineMediaPlayback
            onNavigationStateChange={(nav) => {
              setPageUrl(nav.url);
              if (!nav.loading && nav.title) usePanelHistory.getState().retitle(view.target, nav.title);
            }}
          />
        ) : null}
        {view !== null && view !== 'history' && (view.kind === 'markdown' || view.kind === 'html') ? (
          <MacFile key={view.target} target={view} />
        ) : null}
        {view !== null && view !== 'history' && view.kind === 'sheet' ? (
          <SheetView key={view.target} askId={view.target} onTitle={onSheetTitle} />
        ) : null}
      </View>
    </PanelOpener.Provider>
  );
}

/**
 * Un fichier du Mac. Le daemon refuse un chemin relatif et ne developpe pas `~` : le
 * dossier personnel du Mac est lu une fois (`macHome`), puis le chemin absolu sert a la
 * lecture ET a l'historique.
 */
function MacFile({ target }: { target: PanelTarget }) {
  const direct = expandHome(target.target, null);
  const [resolved, setResolved] = useState<{ path: string | null } | null>(direct ? { path: direct } : null);

  useEffect(() => {
    if (direct) return;
    let alive = true;
    void macHome().then((home) => {
      if (alive) setResolved({ path: expandHome(target.target, home) });
    });
    return () => {
      alive = false;
    };
  }, [direct, target.target]);

  useEffect(() => {
    if (resolved?.path) usePanelHistory.getState().record({ kind: target.kind, target: resolved.path }, '');
  }, [resolved, target.kind]);

  if (resolved === null) return <SkeletonList count={5} height={44} />;
  if (resolved.path === null) return <Banner tone="error" text={t.panelNoHome} />;
  return target.kind === 'markdown' ? <MarkdownFile path={resolved.path} /> : <HtmlFile path={resolved.path} />;
}

function MarkdownFile({ path }: { path: string }) {
  const src = useFileSource(path, 'text');
  if (src.error) return <Banner tone="error" text={src.error} actionLabel={t.actionRetry} onAction={src.retry} />;
  if (src.loading || src.text === null) return <SkeletonList count={5} height={44} />;
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.markdown}>
      {src.truncated ? (
        // Annoncee : un fichier coupe en silence ferait croire qu'on a tout lu (CA-99).
        <Banner tone="warn" text={t.previewTruncated(humanSize(src.size), humanSize(TEXT_PREVIEW_TRUNCATED))} />
      ) : null}
      {src.text.length === 0 ? (
        <EmptyState icon="file" title={t.previewEmptyFile} body={t.previewEmptyBody} />
      ) : (
        <Markdown text={src.text} />
      )}
    </ScrollView>
  );
}

/**
 * Une page HTML du Mac, servie par `fsRead` avec le jeton en en-tete, comme le PDF de
 * l'apercu. Ses ressources relatives (images, feuilles de style) partent SANS jeton : le
 * daemon les refuse, la page s'affiche alors sans elles.
 */
function HtmlFile({ path }: { path: string }) {
  const src = useFileSource(path, 'url');
  if (src.error) return <Banner tone="error" text={src.error} actionLabel={t.actionRetry} onAction={src.retry} />;
  if (src.loading || src.remote === null) return <SkeletonList count={5} height={44} />;
  return (
    <WebView
      style={styles.web}
      source={{ uri: src.remote.url, headers: src.remote.headers }}
      originWhitelist={['https://*', 'http://*']}
      allowsInlineMediaPlayback
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  header: {
    height: layout.navBarHeight + space[4],
    paddingTop: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: layout.screenPaddingH,
  },
  title: { flex: 1 },
  flex: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.bg.inset },
  markdown: { padding: layout.screenPaddingH, gap: space[3], paddingBottom: space[8] },
});
