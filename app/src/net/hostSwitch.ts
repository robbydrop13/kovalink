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
  setFailedOverFrom,
} from '@/store/credentials';
import { dropHostDb, kvClear } from '@/db';
import { usePanes } from '@/store/panes';
import { markUnpaired } from '@/boot';
import { revokeDevice } from './http';
import { startConnection, stopConnection } from './connection';
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

/**
 * `failedOverFrom` : nom du Mac quitté, seulement pour une bascule AUTOMATIQUE. Il porte le
 * bandeau fixe « X unreachable · You are on Y » après le rechargement. Tout autre
 * changement de Mac (retour, choix dans les Réglages) efface ce bandeau.
 */
let switching = false;

/** Vrai entre le début d'un changement de Mac et le rechargement. */
export function isSwitchingHost(): boolean {
  return switching;
}

export async function switchHost(id: string, failedOverFrom: string | null = null): Promise<void> {
  // Un seul changement à la fois : une bascule automatique et un geste qui se croisent
  // mélangeraient l'emplacement actif et le drapeau du bandeau. Le second est ignoré, le
  // rechargement du premier arrive.
  if (switching) return;
  switching = true;
  try {
    // Drapeau du bandeau AVANT l'emplacement actif : un échec ici laisse l'app sur son Mac,
    // liaison intacte, au lieu d'un Mac à moitié changé.
    await setFailedOverFrom(failedOverFrom);
    // Liaison coupée ensuite : une rotation de jeton arrivée pendant la recopie ne peut plus
    // viser le mauvais Mac.
    stopConnection();
    await activateHost(id);
    await reloadApp();
  } catch (error) {
    switching = false;
    // Liaison relancée sur ce que dit l'emplacement actif : l'app ne reste pas sans liaison.
    void startConnection().catch((e: unknown) => bootWarn('restart after failed switch', e));
    throw error;
  }
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
    // Le Mac quitté par une bascule n'a plus de sens sur le Mac suivant.
    await setFailedOverFrom(null).catch(() => undefined);
    stopConnection();
    await reloadApp();
    return 'reloading';
  }
  return 'removed';
}
