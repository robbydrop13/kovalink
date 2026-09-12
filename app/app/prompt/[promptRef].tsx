// Cible du lien profond `kovalink://prompt/{promptRef}`.
//
// La référence est opaque : elle ne révèle ni le pane, ni le projet, ni le chemin. Cet écran
// la résout auprès du daemon puis remplace la route par la session correspondante.
//
// R3 : la référence reste valable jusqu'à résolution du prompt ou 10 minutes. Elle n'est pas
// à usage unique, sinon la NSE la consommerait avant que Robin n'ait tapé quoi que ce soit.
import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { colors, space } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState, SkeletonList } from '@/ui/States';
import { HttpError, fetchPrompt } from '@/net/http';
import { usePrompts } from '@/store/prompts';
import { bootWarn } from '@/env';
import { t } from '@/i18n/en';

export default function PromptRefScreen() {
  const { promptRef } = useLocalSearchParams<{ promptRef: string }>();
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prompt = await fetchPrompt(String(promptRef));
        if (cancelled) return;
        usePrompts.getState().setPrompt(prompt);
        router.replace(`/session/${prompt.paneId}?focus=awaiting`);
      } catch (e) {
        // La cause exacte, jamais un « introuvable » qui recouvre aussi bien une
        // référence expirée qu'un Mac éteint ou un jeton révoqué.
        const cause =
          e instanceof HttpError
            ? `${e.status} ${e.code} : ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e);
        bootWarn('prompt reference resolution', cause);
        if (!cancelled) setFailed(cause);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [promptRef]);

  if (failed !== null) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title={t.promptNotFoundTitle}
          body={t.promptNotFoundBody(failed)}
        >
          <Button label={t.actionSeeSessions} onPress={() => router.replace('/')} />
        </EmptyState>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SkeletonList count={3} height={80} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base, paddingTop: space[9] },
});
