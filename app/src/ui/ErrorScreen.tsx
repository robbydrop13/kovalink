// Écran d'erreur fatale.
//
// Le design spécifie un état d'erreur pour chaque écran, mais aucun pour l'erreur qui casse
// le rendu lui même. C'est le trou que ce composant bouche : une exception au rendu ou au
// démarrage doit produire un écran LISIBLE, jamais un écran blanc. Un écran blanc ne dit rien,
// ni à Robin, ni à celui qui débogue.
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, layout, radius, space } from '@/theme';
import { Button } from './Button';
import { Txt } from './Txt';

const STACK_LINES = 12;

export function ErrorScreen({
  title,
  error,
  onRetry,
  retryLabel = 'Réessayer',
  hint,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  hint?: string;
}) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const stack =
    error instanceof Error && error.stack
      ? error.stack.split('\n').slice(0, STACK_LINES).join('\n')
      : null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Txt variant="display" color={colors.status.error}>
          {title}
        </Txt>
        <Txt variant="body" color={colors.text.primary}>
          {message || 'Erreur sans message.'}
        </Txt>
        {hint ? (
          <Txt variant="callout" color={colors.text.secondary}>
            {hint}
          </Txt>
        ) : null}
        {stack ? (
          <View style={styles.stack}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <Txt variant="monoCode" color={colors.text.tertiary} selectable>
                {stack}
              </Txt>
            </ScrollView>
          </View>
        ) : null}
        {onRetry ? <Button label={retryLabel} onPress={onRetry} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: space[5],
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: space[9],
  },
  stack: {
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.bg.inset,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
});
