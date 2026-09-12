import { claimRawChannel, type KovaIpc } from './ipc.js';

/**
 * ECRITURE BRUTE VERS UN PANE.
 *
 * Ce module est interdit d'import partout sauf dans `keygate.ts` :
 * - regle de lint `no-restricted-imports` (voir `eslint.config.js`) ;
 * - test `keygate.test.ts` qui compte les appelants dans tout `src/`, par analyse
 *   syntaxique, quels que soient les guillemets ou les gabarits.
 *
 * Le canal brut vers la file IPC est reclame ICI, une seule fois pour tout le processus :
 * `KovaIpc` n'expose aucune methode publique sans garde. Aucun appelant supplementaire
 * ne doit apparaitre. Si vous avez besoin d'ecrire dans un pane, ajoutez une operation a
 * `KeyGate`, avec sa garde d'etat.
 */
const raw = claimRawChannel();

export async function sendKeys(ipc: KovaIpc, paneId: number, text: string): Promise<void> {
  const res = await raw(ipc, { cmd: 'send-keys', pane_id: paneId, text });
  if (!res.ok) throw new Error(res.error ?? 'send-keys a echoue');
}
