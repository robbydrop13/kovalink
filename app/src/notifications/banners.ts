// Une seule bannière vivante par pane (PRD 4.4, CA-14), moitié app.
//
// Le daemon envoie un `collapseId` par pane, donc iOS REMPLACE une bannière par la suivante
// tant qu'elle est encore dans le centre de notifications. Cette moitié ci retire ce qui
// reste quand la bannière a servi : Robin ouvre la session du pane, ou le pane n'a plus
// rien à demander (`prompt.state === 'none'`). Sans elle, une bannière lue restait dans le
// centre de notifications à côté de la suivante.
//
// La charge utile ne porte pas de `paneId` (A14, C24) : on reconnaît le pane par le
// `promptRef` du prompt courant, par le `paneId` écrit par la NSE quand il existe, et à
// défaut par le couple (projet, onglet), qui est ce que la bannière affiche.
import * as Notifications from 'expo-notifications';
import type { PushPayload } from '@/protocol';
import { pushAvailable } from '@/env';
import { bannerBelongsTo, type PaneIdentity } from './bannerMatch';

export { paneIdentity } from './bannerMatch';

/** Retire du centre de notifications toutes les bannières livrées pour ce pane. */
export async function dismissBannersForPane(pane: PaneIdentity, promptRefs: readonly string[]): Promise<void> {
  if (!pushAvailable) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      const data = n.request.content.data as Partial<PushPayload> | undefined;
      if (bannerBelongsTo(data, pane, promptRefs)) {
        await Notifications.dismissNotificationAsync(n.request.identifier);
      }
    }
  } catch {
    // Le centre de notifications est un confort : une bannière de trop ne casse rien.
  }
}
