// Face ID avant la saisie terminal. La logique du verrou vit dans `terminalLock.ts` (pure) ;
// ici, quitter l'écran, quitter la vue Term, changer de pane ou passer en arrière-plan
// reverrouille. On ne reverrouille que sur `background` : la feuille Face ID elle-même fait
// passer l'app en `inactive`, ce qui annulerait le déverrouillage qu'elle vient d'accorder.
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { confirmWithFaceId } from '@/actions/faceId';
import { t } from '@/i18n/en';
import { LOCKED, isTerminalUnlocked, nextLock, unlockPane, type TerminalLock } from './terminalLock';

/** Rend une fonction qui vaut `true` si la saisie peut partir sur ce pane. */
export function useTerminalUnlock(paneId: number, termOpen: boolean): () => Promise<boolean> {
  const lock = useRef<TerminalLock>(LOCKED);
  const pending = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    lock.current = nextLock(lock.current, { paneId, termOpen, focused: true, appActive: true });
  }, [paneId, termOpen]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        lock.current = nextLock(lock.current, { paneId, termOpen, focused: false, appActive: true });
      };
    }, [paneId, termOpen]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'background') lock.current = LOCKED;
    });
    return () => sub.remove();
  }, []);

  return useCallback(async () => {
    if (isTerminalUnlocked(lock.current, paneId)) return true;
    // Deux touches rapprochées ne lancent qu'une seule feuille Face ID.
    if (!pending.current) {
      pending.current = confirmWithFaceId(t.terminalFaceIdPrompt).finally(() => {
        pending.current = null;
      });
    }
    const ok = await pending.current;
    if (ok) lock.current = unlockPane(paneId);
    return ok;
  }, [paneId]);
}
