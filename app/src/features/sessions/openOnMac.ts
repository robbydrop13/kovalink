// `Ouvrir sur le Mac` (A8, CA-11) : menu contextuel à une seule entrée, sur l'appui long
// d'une ligne de session (design 4.1) et dans le menu `...` de l'écran de session (4.2).
//
// Le daemon exécute `focus-pane`, une commande hors KeyGate qui n'écrit rien dans le pane.
// Aucune confirmation : le geste est sûr, il ne fait que mettre un onglet au premier plan.
import { ActionSheetIOS, Platform } from 'react-native';
import { focusPaneOnMac } from '@/net/connection';
import { ImpactStyle, impact } from '@/utils/haptics';

const OPEN_ON_MAC_LABEL = 'Ouvrir sur le Mac';

/** Envoie la commande. Rend un libellé de compte rendu à afficher, jamais une exception. */
export function openOnMac(paneId: number): string {
  impact(ImpactStyle.Medium);
  return focusPaneOnMac(paneId) ? 'Ouvert sur le Mac' : 'Mac injoignable, réessaie plus tard';
}

/**
 * Menu contextuel. `extra` permet à l'écran de session d'y ajouter ses propres entrées.
 * Sur autre chose qu'iOS il n'existe pas de feuille native : on exécute la première entrée.
 */
export function showPaneMenu(
  paneId: number,
  onNotice: (message: string) => void,
  extra: { label: string; run: () => void }[] = [],
): void {
  const entries = [{ label: OPEN_ON_MAC_LABEL, run: () => onNotice(openOnMac(paneId)) }, ...extra];
  if (Platform.OS !== 'ios') {
    entries[0]?.run();
    return;
  }
  ActionSheetIOS.showActionSheetWithOptions(
    {
      options: [...entries.map((e) => e.label), 'Annuler'],
      cancelButtonIndex: entries.length,
      userInterfaceStyle: 'dark',
    },
    (index) => entries[index]?.run(),
  );
}
