// Face ID à l'entrée du miroir. La logique du verrou vit dans `unlockGate.ts` (pure) ;
// ici, le passage en arrière-plan verrouille, et l'entrée demande Face ID si besoin.
import { AppState } from 'react-native';
import { confirmWithFaceId } from '@/actions/faceId';
import { t } from '@/i18n/en';
import { gate, isUnlocked, lock, markUnlocked } from './unlockGate';

AppState.addEventListener('change', (status) => {
  if (status !== 'active') lock();
});

/** Vrai si le miroir peut s'ouvrir : déjà déverrouillé, ou Face ID vient de réussir. */
export async function unlockMirror(): Promise<boolean> {
  if (isUnlocked(gate.unlockedAt, Date.now())) return true;
  const ok = await confirmWithFaceId(t.browserFaceIdPrompt);
  if (ok) markUnlocked(Date.now());
  return ok;
}
