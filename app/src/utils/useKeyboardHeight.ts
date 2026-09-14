// La hauteur du clavier iOS, lue dans `keyboardWillShow` et `keyboardWillHide`. Le
// pourquoi (et le calcul du padding qui en découle) est dans `keyboard.ts`. Séparé pour
// que le calcul reste pur et testable sans React Native.
import { useEffect, useRef, useState } from 'react';
import { Keyboard, type KeyboardEvent, LayoutAnimation, Platform } from 'react-native';

/** Suit le clavier avec la courbe et la durée qu'iOS annonce, comme `KeyboardAvoidingView`. */
function follow(e: KeyboardEvent): void {
  const duration = e.duration > 10 ? e.duration : 10;
  LayoutAnimation.configureNext({
    duration,
    update: { duration, type: LayoutAnimation.Types[e.easing] ?? LayoutAnimation.Types.keyboard },
  });
}

/**
 * Hauteur du clavier logiciel, 0 quand il est fermé. iOS seulement : sur Android la
 * fenêtre se redimensionne d'elle même (`adjustResize`), rien à retrancher.
 */
export function useKeyboardHeight(): number {
  // Écran monté clavier déjà ouvert : on part de sa hauteur connue, pas de 0.
  const [height, setHeight] = useState(() =>
    Platform.OS === 'ios' && Keyboard.isVisible() ? Math.round(Keyboard.metrics()?.height ?? 0) : 0,
  );
  const last = useRef(height);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const apply = (e: KeyboardEvent, next: number): void => {
      if (last.current === next) return;
      last.current = next;
      follow(e);
      setHeight(next);
    };
    // `keyboardWillShow` est aussi envoyé quand le clavier change de taille en restant
    // ouvert (barre de prédiction, autre disposition) : la hauteur suit à chaque fois.
    const show = Keyboard.addListener('keyboardWillShow', (e) => apply(e, Math.round(e.endCoordinates.height)));
    const hide = Keyboard.addListener('keyboardWillHide', (e) => apply(e, 0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
