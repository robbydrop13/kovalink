// Frontière d'erreur racine.
//
// Elle enveloppe TOUT l'arbre, providers compris. Sans elle, une exception au rendu démonte
// l'arbre React et laisse un écran blanc : c'est exactement ce qui a coûté une session de
// débogage, et c'est un défaut de conception, pas un accident.
//
// Elle journalise aussi l'erreur avec le préfixe `[KovaLink boot]`, pour que le journal Metro
// dise quelque chose au lieu de rester muet.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './ErrorScreen';

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
}

export class RootErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[KovaLink boot] exception au rendu', error?.message ?? error);
    if (info?.componentStack) {
      console.error('[KovaLink boot] pile de composants', info.componentStack.split('\n').slice(0, 12).join('\n'));
    }
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <ErrorScreen
          title="L’app a planté"
          error={this.state.error}
          hint="Le rendu a levé une exception. Réessaie, et si l’erreur revient, la pile ci dessous dit où."
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}
