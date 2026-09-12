// Layout racine : thème sombre en dur (A9), pile unique sans barre d'onglets (P1 : les 88 pt
// du bas sont réservés à la barre de validation et au composer).
//
// RÈGLE STRUCTURELLE, à ne jamais réintroduire à l'envers : ce layout rend TOUJOURS un
// navigateur, dès le premier rendu, quel que soit l'état du démarrage.
//
// Ce qui a causé l'écran blanc : ce fichier renvoyait `<Redirect href="/pair" />` quand
// l'appareil n'était pas appairé. Or `Redirect` rend `null` et déclenche sa navigation dans
// un `useFocusEffect` qui ATTEND que la navigation soit montée. Comme le seul navigateur de
// l'app était précisément ce qui n'était pas rendu, l'effet n'a jamais tourné, rien n'a
// jamais été monté, et rien n'a jamais été levé non plus. D'où un écran blanc parfaitement
// silencieux. Le portillon d'appairage vit donc DANS une route (`app/index.tsx`), à
// l'intérieur du navigateur, jamais au dessus de lui.
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { useBootRunner } from '@/boot';
import { bootLog } from '@/env';
import { ErrorScreen } from '@/ui/ErrorScreen';
import { RootErrorBoundary } from '@/ui/RootErrorBoundary';
import { usePanes, awaitingCount } from '@/store/panes';
import { setBadge } from '@/notifications/register';

/**
 * Frontière d'erreur d'expo-router : elle attrape ce qui est levé par une route enfant et
 * reçoit un `retry` du routeur. La `RootErrorBoundary` ci dessous couvre le reste, y compris
 * les providers.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ErrorScreen
      title="Écran en erreur"
      error={error}
      hint="Cette route a levé une exception au rendu."
      onRetry={() => {
        void retry();
      }}
    />
  );
}

export default function RootLayout() {
  useBootRunner();
  const panes = usePanes((s) => s.panes);

  useEffect(() => {
    bootLog('layout racine monté');
  }, []);

  // Badge d'icône : le nombre de panes en attente, jamais autre chose. Sans effet quand le
  // push n'est pas disponible.
  useEffect(() => {
    void setBadge(awaitingCount(panes));
  }, [panes]);

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg.base },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="pair" options={{ animation: 'fade' }} />
          <Stack.Screen name="session/[paneId]" />
          <Stack.Screen name="prompt/[promptRef]" options={{ animation: 'fade' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
          {/* Les deux palettes de Kova : Cmd+O (projets récents, puis `new-tab` avec
              `claude`, PRD A9) et Cmd+P (tous les panes). Modales : balayage pour fermer. */}
          <Stack.Screen name="new-session" options={{ presentation: 'modal' }} />
          <Stack.Screen name="panes" options={{ presentation: 'modal' }} />
          {/* Session fermée en lecture seule (design 4.11), reprise sur action explicite. */}
          <Stack.Screen name="history/[sessionId]" />
          {/* Bloc C. L'onglet Fichiers ne dépend pas de Kova : il reste utilisable quand
              Kova est quitté (CA-123). */}
          <Stack.Screen name="files/index" />
          <Stack.Screen name="files/preview" options={{ presentation: 'modal' }} />
          <Stack.Screen name="share" options={{ presentation: 'modal' }} />
          <Stack.Screen name="activity" />
        </Stack>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
