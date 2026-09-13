// Reordonner depuis l'app, comme un glisser sur le Mac : un onglet parmi les onglets de
// sa fenetre, un pane parmi les panes de son onglet. Deux commandes de controle, jamais
// une touche : `KeyGate` reste le seul point d'ecriture dans un pane.
//  - onglet : `move-tab { tab_id, index }`, une commande que Kova n'a qu'apres la 1.11.0.
//    Un Kova plus ancien repond `unknown command`, rendu 501 `KOVA_TOO_OLD` avec la
//    marche a suivre ;
//  - pane : Kova n'a pas de `move-pane`, mais `swap-pane` existe depuis longtemps. Le
//    deplacement est une chaine d'echanges avec le voisin, calculee sur l'ordre de
//    `list-panes` (`PaneStore.inTab`). Une chaine interrompue s'arrete la : la reponse
//    dit combien d'echanges ont ete appliques, l'instantane suivant montre l'ordre reel.
import type { ErrorCode, PaneReorderResponse, TabReorderResponse } from '@kovalink/protocol';
import { audit } from '../audit.js';
import type { Services } from '../server/services.js';
import { IpcError } from './ipc.js';

/** Ce dont ces deux operations ont besoin : une vue etroite des services, facile a simuler. */
export type ReorderServices = Pick<Services, 'ipc' | 'panes' | 'refreshLayout'>;

export type ReorderOutcome<T> =
  | { ok: true; response: T }
  | { ok: false; status: number; code: ErrorCode; message: string };

/** Entier positif ou nul, sinon `null` : le rang vient du client, il se verifie. */
export function parseIndex(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return null;
  return raw;
}

/**
 * Les echanges voisins qui amenent `ids[from]` au rang `to`, dans l'ordre. Chaque paire
 * est `[pane qui bouge, voisin]` : apres un echange le pane occupe la place du voisin, et
 * le voisin suivant est celui qui etait deja la. `to` est borne au dernier rang ; `from`
 * hors de la liste ou egal a `to` ne donne aucun echange.
 */
export function swapChain(ids: number[], from: number, to: number): Array<[number, number]> {
  if (ids.length === 0 || from < 0 || from >= ids.length) return [];
  const target = Math.min(Math.max(to, 0), ids.length - 1);
  const mover = ids[from] as number;
  const out: Array<[number, number]> = [];
  const step = target > from ? 1 : -1;
  for (let i = from + step; step > 0 ? i <= target : i >= target; i += step) {
    out.push([mover, ids[i] as number]);
  }
  return out;
}

function ipcFailure(e: unknown): { code: ErrorCode; message: string } {
  const code: ErrorCode = e instanceof IpcError ? e.code : 'KOVA_DOWN';
  return { code, message: (e as Error).message };
}

/** `POST /v1/kova/tabs/:tabId/reorder` : `move-tab`, l'onglet resolu par l'index du daemon. */
export async function reorderTab(
  services: ReorderServices,
  tabId: number,
  rawIndex: unknown,
  deviceId: string,
): Promise<ReorderOutcome<TabReorderResponse>> {
  const index = parseIndex(rawIndex);
  if (index === null) return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'index must be a non-negative integer' };
  const tab = services.panes.allTabs().find((t) => t.id === tabId);
  if (!tab) {
    audit({ deviceId, action: 'kova.reorder-tab', result: 'denied', detail: `tab=${tabId} inconnu` });
    return { ok: false, status: 404, code: 'TAB_NOT_FOUND', message: 'unknown tab' };
  }
  try {
    const res = await services.ipc.request({ cmd: 'move-tab', tab_id: tabId, index });
    if (!res.ok) {
      const error = res.error ?? 'erreur IPC';
      audit({ deviceId, action: 'kova.reorder-tab', result: 'error', detail: error });
      if (/^unknown command/i.test(error)) {
        return { ok: false, status: 501, code: 'KOVA_TOO_OLD', message: 'update Kova on the Mac to reorder tabs' };
      }
      return { ok: false, status: 502, code: 'KOVA_ERROR', message: `move-tab failed: ${error}` };
    }
  } catch (e) {
    const { code, message } = ipcFailure(e);
    audit({ deviceId, action: 'kova.reorder-tab', result: 'error', detail: message });
    if (code === 'IPC_UNSUPPORTED') {
      return { ok: false, status: 501, code: 'KOVA_TOO_OLD', message: 'update Kova on the Mac to reorder tabs' };
    }
    return { ok: false, status: 502, code, message: `move-tab failed: ${message}` };
  }
  audit({ deviceId, action: 'kova.reorder-tab', result: 'ok', detail: `tab=${tabId} from=${tab.tab_index} to=${index}` });
  await services.refreshLayout?.('tab-reorder');
  return { ok: true, response: { moved: true } };
}

/**
 * `POST /v1/panes/:paneId/reorder` : une chaine de `swap-pane` vers le rang vise, parmi les
 * panes de l'onglet du pane, dans l'ordre de Kova. Le pane ne change jamais d'onglet.
 */
export async function reorderPane(
  services: ReorderServices,
  paneId: number,
  rawIndex: unknown,
  deviceId: string,
): Promise<ReorderOutcome<PaneReorderResponse>> {
  const index = parseIndex(rawIndex);
  if (index === null) return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'index must be a non-negative integer' };
  const pane = services.panes.get(paneId);
  if (!pane) {
    audit({ deviceId, action: 'pane.reorder', paneId, result: 'denied', detail: 'pane_gone' });
    return { ok: false, status: 404, code: 'PANE_NOT_FOUND', message: 'unknown pane' };
  }
  const ids = services.panes.inTab(pane.window, pane.tab).map((p) => p.id);
  const from = ids.indexOf(paneId);
  const chain = swapChain(ids, from, index);
  let swaps = 0;
  for (const [a, b] of chain) {
    try {
      const res = await services.ipc.request({ cmd: 'swap-pane', pane_id_a: a, pane_id_b: b });
      if (!res.ok) {
        const error = res.error ?? 'erreur IPC';
        audit({ deviceId, action: 'pane.reorder', paneId, result: 'error', detail: `swaps=${swaps}/${chain.length} ${error}` });
        await services.refreshLayout?.('pane-reorder');
        return { ok: false, status: 502, code: 'KOVA_ERROR', message: `swap-pane failed after ${swaps} of ${chain.length} swaps: ${error}` };
      }
    } catch (e) {
      const { code, message } = ipcFailure(e);
      audit({ deviceId, action: 'pane.reorder', paneId, result: 'error', detail: `swaps=${swaps}/${chain.length} ${message}` });
      await services.refreshLayout?.('pane-reorder');
      return { ok: false, status: 502, code, message: `swap-pane failed after ${swaps} of ${chain.length} swaps: ${message}` };
    }
    swaps += 1;
  }
  audit({ deviceId, action: 'pane.reorder', paneId, result: 'ok', detail: `from=${from} to=${Math.min(index, Math.max(ids.length - 1, 0))} swaps=${swaps}` });
  await services.refreshLayout?.('pane-reorder');
  return { ok: true, response: { moved: true, swaps } };
}
