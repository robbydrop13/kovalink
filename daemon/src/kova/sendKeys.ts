import { claimRawChannel, type KovaIpc } from './ipc.js';
import { isUnknownSigField, sigFor } from './sendSig.js';
import { logger } from '../logger.js';

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

/**
 * Un Kova trop ancien pour la signature : on ne la retente qu'apres ce delai, le temps
 * que Robin relance Kova, plutot que de payer un aller-retour refuse a chaque envoi.
 */
const SIG_RETRY_MS = 60_000;
let sigUnsupportedUntil = 0;

/**
 * Tout ce qui passe ici est un geste de Robin via `KeyGate` (texte, reponse, touches,
 * interruption, lancement), donc tout est signe quand la cle est lisible.
 */
export async function sendKeys(ipc: KovaIpc, paneId: number, text: string): Promise<void> {
  const now = Date.now();
  const sig = now >= sigUnsupportedUntil ? sigFor(paneId, text, now) : null;
  let res = await raw(ipc, sig ? { cmd: 'send-keys', pane_id: paneId, text, sig } : { cmd: 'send-keys', pane_id: paneId, text });
  if (!res.ok && sig && isUnknownSigField(res.error)) {
    // Kova anterieur a 748bded : rien n'a ete tape, on renvoie sans signature.
    sigUnsupportedUntil = Date.now() + SIG_RETRY_MS;
    logger.info('kova ne connait pas encore la signature de send-keys, envoi sans signature', { paneId });
    res = await raw(ipc, { cmd: 'send-keys', pane_id: paneId, text });
  }
  if (!res.ok) throw new Error(res.error ?? 'send-keys a echoue');
}
