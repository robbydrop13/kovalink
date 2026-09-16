// « Lu sur le telephone » remonte au Mac : le SEUL chemin d'ecriture de l'etat de lecture
// d'un pane vers Kova. Une commande et une seule, `set-pane-unread {pane_id, unread:false}`,
// qui ne focalise rien, n'active aucun onglet, ne leve aucune fenetre et ne restaure aucun
// pane minimise (voir `kova/docs/ipc.md`). Aucune touche n'est emise : `KeyGate` reste le
// seul point d'ecriture DANS un pane, et celui-ci n'ecrit que le drapeau de lecture.
//
// Pourquoi pas `dispatch-action toggle-unread` : `dispatch-action` FOCALISE le pane vise
// avant de dispatcher, et un pane focalise compte comme vu. Le basculement le trouvait donc
// lu et le marquait NON LU, exactement l'inverse du geste voulu, en levant au passage la
// fenetre de Kova sur le bureau de Robin.
//
// DEGRADATION : le Kova en cours d'execution peut etre anterieur a la commande et repondre
// `unknown command: set-pane-unread`. Ce n'est pas une panne, c'est un Mac qui n'a pas
// encore relance Kova : journalise UNE FOIS par processus (sinon chaque ouverture de pane
// le repeterait), rendu en `applied:false` avec sa raison, et l'app n'en montre rien.
import type { PaneReadResponse } from '@kovalink/protocol';
import { audit } from '../audit.js';
import { logger } from '../logger.js';
import type { Services } from '../server/services.js';
import { IpcError } from './ipc.js';

/** Vue etroite des services : facile a simuler dans un test. */
export type ReadServices = Pick<Services, 'ipc' | 'panes'>;

/** Un Kova trop ancien le dirait a chaque pane ouvert : une ligne, pas un flot. */
let tooOldLogged = false;

/** Remise a zero du journal unique. Pour les tests seulement. */
export function resetTooOldNotice(): void {
  tooOldLogged = false;
}

function noteTooOld(): void {
  if (tooOldLogged) return;
  tooOldLogged = true;
  logger.info('kova ne connait pas encore set-pane-unread, les marques de lecture du telephone restent locales jusqu au prochain lancement de kova');
}

/**
 * Marque le pane lu sur le Mac. NE LEVE JAMAIS : tout refus devient un `applied:false`
 * motive, parce que l'app a deja pose sa marque locale et ne doit rien afficher pour ca.
 */
export async function markPaneRead(
  services: ReadServices,
  paneId: number,
  deviceId: string,
): Promise<PaneReadResponse> {
  if (!services.panes.get(paneId)) {
    audit({ deviceId, action: 'pane.markRead', paneId, result: 'denied', detail: 'pane_gone' });
    return { applied: false, reason: 'pane_gone' };
  }
  try {
    const res = await services.ipc.request({ cmd: 'set-pane-unread', pane_id: paneId, unread: false });
    if (!res.ok) {
      const error = res.error ?? 'erreur IPC';
      if (/^unknown command/i.test(error)) {
        noteTooOld();
        audit({ deviceId, action: 'pane.markRead', paneId, result: 'denied', detail: 'kova_too_old' });
        return { applied: false, reason: 'kova_too_old' };
      }
      audit({ deviceId, action: 'pane.markRead', paneId, result: 'error', detail: error });
      return { applied: false, reason: 'kova_refused' };
    }
  } catch (e) {
    const message = (e as Error).message;
    if (e instanceof IpcError && e.code === 'IPC_UNSUPPORTED') {
      noteTooOld();
      audit({ deviceId, action: 'pane.markRead', paneId, result: 'denied', detail: 'kova_too_old' });
      return { applied: false, reason: 'kova_too_old' };
    }
    audit({ deviceId, action: 'pane.markRead', paneId, result: 'error', detail: message });
    return { applied: false, reason: 'kova_down' };
  }
  audit({ deviceId, action: 'pane.markRead', paneId, result: 'ok' });
  return { applied: true };
}
