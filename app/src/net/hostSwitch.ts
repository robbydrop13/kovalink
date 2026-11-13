// Changement de Mac. Recopier l'emplacement du Mac choisi dans `kl.*`, couper la liaison,
// puis RECHARGER l'app : un rechargement d'une seconde vide les stores en mémoire d'un coup,
// et la base locale se rouvre sur celle du nouveau Mac (`db/index.ts`). Réinitialiser chaque
// store à la main ferait le même travail avec autant d'occasions d'oubli, et un état d'un Mac
// pourrait fuir vers l'autre.
import { DevSettings } from 'react-native';
import * as Updates from 'expo-updates';

import {
  activateHost,
  activeHostId,
  clearCredentials,
  loadHostCredentials,
  removeHost,
} from '@/store/credentials';
import { dropHostDb, kvClear } from '@/db';
import { usePanes } from '@/store/panes';
import { markUnpaired } from '@/boot';
import { revokeDevice } from './http';
import { stopConnection } from './connection';
import { bootWarn } from '@/env';

/** Recharge le bundle. `expo-updates` refuse en développement : on retombe sur Metro. */
export async function reloadApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch (error) {
    bootWarn('Updates.reloadAsync', error);
    DevSettings.reload();
  }
}

export async function switchHost(id: string): Promise<void> {
  // Liaison coupée d'abord : une rotation de jeton arrivée pendant la recopie ne peut plus
  // viser le mauvais Mac.
  stopConnection();
  await activateHost(id);
  await reloadApp();
}

/**
 * Retrait d'un Mac : révoquer cet iPhone sur ce Mac, puis l'oublier ici. Rend ce que
 * l'écran doit faire ensuite : `unpaired` (plus aucun Mac, retour à l'appairage),
 * `reloading` (on retirait le Mac actif, l'app repart sur le suivant) ou `removed`.
 */
export async function removeHostFlow(id: string): Promise<'unpaired' | 'reloading' | 'removed'> {
  const creds = await loadHostCredentials(id);
  if (creds) {
    try {
      await revokeDevice(creds.deviceId, creds);
    } catch (error) {
      // Le jeton local part quand même : le Mac est peut être éteint, ou l'iPhone perdu.
      bootWarn('revoke on removed Mac', error);
    }
  }
  const wasActive = (await activeHostId()) === id;
  const { nextActive, removed } = await removeHost(id);

  if (nextActive === null) {
    stopConnection();
    await clearCredentials();
    await kvClear();
    usePanes.getState().reset();
    markUnpaired();
    return 'unpaired';
  }
  if (removed) await dropHostDb(removed.db);
  if (wasActive) {
    stopConnection();
    await reloadApp();
    return 'reloading';
  }
  return 'removed';
}
