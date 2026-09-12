// Trousseau. Jeton d'appareil, jeton court de la NSE, nom MagicDNS.
//
// Non négociable : tout ce fichier passe par expo-secure-store, jamais par AsyncStorage.
// Accessibilité WHEN_UNLOCKED_THIS_DEVICE_ONLY, jamais iCloud. Groupe de trousseau partagé
// avec la Notification Service Extension, qui lit `nseToken` et `tsDns` et rien d'autre.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_PORT } from '@/protocol';

const SERVICE = 'io.claap.kovalink';

const KEYS = {
  deviceId: 'kl.deviceId',
  token: 'kl.token',
  nseToken: 'kl.nseToken',
  tsDns: 'kl.tsDns',
  port: 'kl.port',
} as const;

/**
 * Groupe de trousseau partagé avec la NSE. Il vaut `<AppIdentifierPrefix>io.claap.kovalink`
 * et n'est connu qu'une fois l'identifiant d'équipe Apple renseigné. Laissé à null, les
 * entrées restent privées à l'app et la NSE retombe sur son état 3 (bannière sans action
 * d'option), qui est un chemin spécifié et sûr.
 */
function readAccessGroup(): string | undefined {
  const raw = (Constants.expoConfig?.extra as { keychainAccessGroup?: unknown } | undefined)
    ?.keychainAccessGroup;
  // `typeof` explicite, jamais une simple vérité : `app.json` portait `{}`, un objet vide.
  // Un objet vide est TRUTHY, il passait donc la garde et descendait tel quel au pont
  // natif, qui levait `ArgumentCastException: The 3rd argument cannot be cast to type
  // SecureStoreOptions`. Exactement le même défaut que `keychainAccessible: undefined`,
  // à une clé près. On n'accepte ici qu'une chaîne non vide.
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

const accessGroup: string | undefined = readAccessGroup();

/**
 * Options du trousseau.
 *
 * Aucun champ `undefined` ne doit figurer dans cet objet : le pont natif convertit
 * l'argument en `SecureStoreOptions` et leve `ArgumentCastException` des qu'une cle porte
 * `undefined`. Or `WHEN_UNLOCKED_THIS_DEVICE_ONLY` n'est pas garantie definie partout,
 * notamment dans Expo Go. On n'ajoute donc chaque option que si elle a une valeur.
 */
function opts(): SecureStore.SecureStoreOptions {
  const o: SecureStore.SecureStoreOptions = { keychainService: SERVICE };
  const accessible = SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
  // Chaque option est vérifiée SUR SON TYPE RÉEL avant d'être posée. Une clé présente
  // avec une valeur du mauvais type fait échouer la conversion de l'objet entier.
  if (typeof accessible === 'number') {
    o.keychainAccessible = accessible;
  }
  if (typeof accessGroup === 'string' && accessGroup.length > 0) {
    o.accessGroup = accessGroup;
  }
  return o;
}

export interface Credentials {
  deviceId: string;
  token: string;
  nseToken: string | null;
  tsDns: string;
  port: number;
}

export async function loadCredentials(): Promise<Credentials | null> {
  const [deviceId, token, nseToken, tsDns, port] = await Promise.all([
    SecureStore.getItemAsync(KEYS.deviceId, opts()),
    SecureStore.getItemAsync(KEYS.token, opts()),
    SecureStore.getItemAsync(KEYS.nseToken, opts()),
    SecureStore.getItemAsync(KEYS.tsDns, opts()),
    SecureStore.getItemAsync(KEYS.port, opts()),
  ]);
  if (!deviceId || !token || !tsDns) return null;
  return { deviceId, token, nseToken, tsDns, port: Number(port ?? DEFAULT_PORT) || DEFAULT_PORT };
}

export async function saveCredentials(c: Credentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.deviceId, c.deviceId, opts()),
    SecureStore.setItemAsync(KEYS.token, c.token, opts()),
    SecureStore.setItemAsync(KEYS.tsDns, c.tsDns, opts()),
    SecureStore.setItemAsync(KEYS.port, String(c.port), opts()),
    c.nseToken
      ? SecureStore.setItemAsync(KEYS.nseToken, c.nseToken, opts())
      : Promise.resolve(),
  ]);

  // Relecture immediate. Une ecriture de trousseau qui echoue en silence produirait un
  // appairage « reussi » cote Mac et une app qui redemande le QR a chaque lancement : le
  // symptome serait incomprehensible. On echoue ici, avec un message qui dit quoi.
  const readBack = await loadCredentials();
  if (!readBack) {
    throw new Error(
      'le trousseau n a pas conserve les identifiants (expo-secure-store a ecrit sans erreur mais la relecture est vide)',
    );
  }
}

/** Renouvellement silencieux du jeton, envoyé par le daemon dans `hello.ok` à J-15. */
export async function rotateToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.token, token, opts());
}

export async function clearCredentials(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k, opts()).catch(() => undefined)),
  );
}
