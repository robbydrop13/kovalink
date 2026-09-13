// Presse-papiers (demande du 13 septembre : copier un message du chat).
//
// Ce build natif n'embarque pas `expo-clipboard`, mais React Native 0.86 livre encore son
// module `Clipboard` de base (`RCTClipboard`, dans React-Core), déprécié mais présent :
// il suffit pour écrire du texte, sans nouveau build. On l'atteint par son chemin interne
// pour éviter l'avertissement de dépréciation du getter `react-native`. Si un jour il
// disparaît, `copyText` rend `false` et l'appelant se rabat sur la feuille de partage.
import { Share } from 'react-native';

interface CoreClipboard {
  setString: (text: string) => void;
}

function coreClipboard(): CoreClipboard | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native/Libraries/Components/Clipboard/Clipboard') as { default?: CoreClipboard } & CoreClipboard;
    const cb = mod.default ?? mod;
    return typeof cb?.setString === 'function' ? cb : null;
  } catch {
    return null;
  }
}

/** Copie `text` ; `false` si aucun presse-papiers n'est disponible. */
export function copyText(text: string): boolean {
  const cb = coreClipboard();
  if (!cb) return false;
  try {
    cb.setString(text);
    return true;
  } catch {
    return false;
  }
}

/** Copie, sinon ouvre la feuille de partage d'iOS, qui offre `Copier`. */
export function copyOrShare(text: string): boolean {
  if (copyText(text)) return true;
  void Share.share({ message: text }).catch(() => undefined);
  return false;
}
