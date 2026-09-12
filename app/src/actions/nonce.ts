// Nonce d'idempotence. Le daemon déduplique sur 10 minutes : rejouer le même nonce répond
// `{applied:false, reason:'duplicate'}` et n'envoie rien au pane.
import * as Crypto from 'expo-crypto';

export function nonce(): string {
  return Crypto.randomUUID();
}
