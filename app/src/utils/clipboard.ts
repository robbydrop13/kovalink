// Presse-papiers (demande du 13 septembre : copier un message du chat).
//
// Depuis le build natif 1.1.0, `expo-clipboard` est embarqué : c'est lui qui écrit. Son API
// est asynchrone, d'où les promesses ici. Le module `Clipboard` de React Native, déprécié,
// n'est plus utilisé. Si le module natif manque (Expo Go, ancien build), `copyText` rend
// `false` et l'appelant se rabat sur la feuille de partage d'iOS, qui offre `Copier`.
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

/** Copie `text` ; `false` si aucun presse-papiers n'est disponible. */
export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}

/** Copie, sinon ouvre la feuille de partage d'iOS, qui offre `Copier`. */
export async function copyOrShare(text: string): Promise<boolean> {
  if (await copyText(text)) return true;
  void Share.share({ message: text }).catch(() => undefined);
  return false;
}
