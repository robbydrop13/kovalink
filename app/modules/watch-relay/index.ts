// Relais Apple Watch, côté iPhone. La montre n'a pas Tailscale : elle passe son texte à
// l'iPhone par WatchConnectivity, et le code natif de ce module l'envoie au daemon
// (`POST /v1/sessions/text`), même app fermée et iPhone verrouillé.
//
// Le JS y fait deux choses : tenir le natif à jour de l'adresse du Mac et du jeton, à
// chaque lancement, appairage, rotation de jeton et désappairage, et lui passer les nombres
// du cadran (`setCounts`), que le natif pousse à la montre et garde dans l'App Group pour
// une montre activée plus tard.
//
// Le natif en garde une copie du jeton dans son propre trousseau, lisible après le premier
// déverrouillage : le trousseau de l'app (`WHEN_UNLOCKED`) est fermé quand l'iPhone dort
// dans la poche, précisément le cas d'usage.
//
// Absent dans Expo Go et sur un build antérieur à la montre : tout devient un no-op.
import { requireOptionalNativeModule } from 'expo';

/**
 * Les nombres du cadran. Que des entiers : ni question, ni nom de pane, ni titre.
 * `oldestAt` est l'heure (secondes epoch) de la plus ancienne question ou permission.
 */
export interface WatchCounts {
  asks: number;
  errors: number;
  ended: number;
  oldestAt: number | null;
}

interface WatchRelayNative {
  configure(baseUrl: string, token: string): void;
  clear(): void;
  setCounts(counts: WatchCounts): void;
}

const native = requireOptionalNativeModule<WatchRelayNative>('WatchRelay');

export function configureWatchRelay(baseUrl: string, token: string): void {
  native?.configure(baseUrl, token);
}

export function clearWatchRelay(): void {
  native?.clear();
}

/** Pousse les nombres du cadran. No-op sur Android, le web, les tests et Expo Go. */
export function setCounts(counts: WatchCounts): void {
  native?.setCounts(counts);
}
