// Relais Apple Watch, côté iPhone. La montre n'a pas Tailscale : elle passe son texte à
// l'iPhone par WatchConnectivity, et le code natif de ce module l'envoie au daemon
// (`POST /v1/sessions/text`), même app fermée et iPhone verrouillé.
//
// Le JS ne fait qu'une chose : tenir le natif à jour de l'adresse du Mac et du jeton, à
// chaque lancement, appairage, rotation de jeton et désappairage. Le natif en garde une copie
// dans son propre trousseau, lisible après le premier déverrouillage : le trousseau de l'app
// (`WHEN_UNLOCKED`) est fermé quand l'iPhone dort dans la poche, précisément le cas d'usage.
//
// Absent dans Expo Go et sur un build antérieur à la montre : tout devient un no-op.
import { requireOptionalNativeModule } from 'expo';

interface WatchRelayNative {
  configure(baseUrl: string, token: string): void;
  clear(): void;
}

const native = requireOptionalNativeModule<WatchRelayNative>('WatchRelay');

export function configureWatchRelay(baseUrl: string, token: string): void {
  native?.configure(baseUrl, token);
}

export function clearWatchRelay(): void {
  native?.clear();
}
