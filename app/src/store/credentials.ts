// Trousseau. Jeton d'appareil, jeton court de la NSE, nom MagicDNS.
//
// Non négociable : tout ce fichier passe par expo-secure-store, jamais par AsyncStorage.
// Accessibilité WHEN_UNLOCKED_THIS_DEVICE_ONLY, jamais iCloud. Groupe de trousseau partagé
// avec la Notification Service Extension, qui lit `nseToken` et `tsDns` et rien d'autre.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_PORT } from '@/protocol';
import { clearWatchRelay, configureWatchRelay } from '../../modules/watch-relay';
import {
  dbNameFor,
  defaultHostName,
  hostKeys,
  migrateRegistry,
  parseHosts,
  removeEntry,
  upsertHost,
  withHostInfo,
  type HostEntry,
  type HostRole,
} from './hosts';

const SERVICE = 'io.claap.kovalink';

const KEYS = {
  deviceId: 'kl.deviceId',
  token: 'kl.token',
  nseToken: 'kl.nseToken',
  tsDns: 'kl.tsDns',
  port: 'kl.port',
} as const;

/** Registre des Macs appairés (`hosts.ts`). Hors de `KEYS` : ce n'est pas l'emplacement actif. */
const HOSTS_KEY = 'kl.hosts';

/**
 * Bascule entre Macs (`net/failover.ts`). Réglages globaux, pas par Mac : ils survivent au
 * rechargement qui suit une bascule, alors que la base locale, elle, change de Mac.
 * `auto` vaut `0` quand Robin a coupé la bascule seule (absent : active). `from` porte le
 * nom du Mac quitté par une bascule automatique, jusqu'au retour.
 */
const FAILOVER_KEYS = { auto: 'kl.failover.auto', from: 'kl.failover.from' } as const;

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

async function writeActive(c: Credentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.deviceId, c.deviceId, opts()),
    SecureStore.setItemAsync(KEYS.token, c.token, opts()),
    SecureStore.setItemAsync(KEYS.tsDns, c.tsDns, opts()),
    SecureStore.setItemAsync(KEYS.port, String(c.port), opts()),
    // Un Mac sans jeton NSE ne doit pas hériter de celui du Mac précédent.
    c.nseToken
      ? SecureStore.setItemAsync(KEYS.nseToken, c.nseToken, opts())
      : SecureStore.deleteItemAsync(KEYS.nseToken, opts()).catch(() => undefined),
  ]);
}

/**
 * Premier appairage : écrit l'emplacement actif ET inscrit ce Mac comme premier hôte du
 * registre. Un Mac de plus passe par `addHost`, jamais par ici.
 */
export async function saveCredentials(c: Credentials, name?: string): Promise<void> {
  await writeActive(c);
  await writeHostSlot(c);
  await writeHosts(upsertHost((await readHosts()) ?? [], hostInput(c, name)));

  // Relecture immediate. Une ecriture de trousseau qui echoue en silence produirait un
  // appairage « reussi » cote Mac et une app qui redemande le QR a chaque lancement : le
  // symptome serait incomprehensible. On echoue ici, avec un message qui dit quoi.
  const readBack = await loadCredentials();
  if (!readBack) {
    throw new Error(
      'keychain did not keep the credentials (expo-secure-store wrote without error but the read-back is empty)',
    );
  }
  syncWatchRelay(readBack);
}

/**
 * Copie l'adresse du Mac et le jeton au relais natif de la montre (`modules/watch-relay`).
 * Appelé au démarrage, à l'appairage et à chaque rotation : le relais garde toujours le
 * jeton en cours. Jamais bloquant, un échec natif ne doit pas casser l'app.
 */
export function syncWatchRelay(c: Credentials): void {
  try {
    configureWatchRelay(`https://${c.tsDns}:${c.port}`, c.token);
  } catch {
    /* build sans montre, ou trousseau natif indisponible : la montre dira d'ouvrir l'app */
  }
}

/**
 * Renouvellement silencieux du jeton, envoyé par le daemon dans `hello.ok` à J-15. Écrit
 * aussi l'emplacement du Mac qui l'a émis : sinon revenir sur ce Mac plus tard recopierait
 * l'ancien jeton, expiré. `hostId` est le Mac de la liaison, jamais relu dans `kl.*` : un
 * changement de Mac en cours ne doit pas recevoir le jeton de l'autre.
 */
export async function rotateToken(token: string, hostId: string): Promise<void> {
  await SecureStore.setItemAsync(hostKeys(hostId).token, token, opts());
  if ((await activeHostId()) !== hostId) return;
  await SecureStore.setItemAsync(KEYS.token, token, opts());
  const c = await loadCredentials();
  if (c) syncWatchRelay(c);
}

/** Tout effacer : emplacement actif, registre et emplacement de chaque Mac. */
export async function clearCredentials(): Promise<void> {
  const hosts = (await readHosts()) ?? [];
  const keys = [
    ...Object.values(KEYS),
    HOSTS_KEY,
    ...Object.values(FAILOVER_KEYS),
    ...hosts.flatMap((h) => Object.values(hostKeys(h.id))),
  ];
  await Promise.all(
    keys.map((k) => SecureStore.deleteItemAsync(k, opts()).catch(() => undefined)),
  );
  try {
    clearWatchRelay();
  } catch {
    /* idem syncWatchRelay */
  }
}

// --- Registre des Macs -------------------------------------------------------

export type { HostEntry, HostRole };

function hostInput(c: Credentials, name?: string, role?: HostRole) {
  const trimmed = name?.trim();
  return {
    id: c.tsDns,
    name: trimmed && trimmed.length > 0 ? trimmed : defaultHostName(c.tsDns),
    port: c.port,
    ...(role ? { role } : {}),
  };
}

async function readHosts(): Promise<HostEntry[] | null> {
  return parseHosts(await SecureStore.getItemAsync(HOSTS_KEY, opts()));
}

async function writeHosts(hosts: HostEntry[]): Promise<void> {
  await SecureStore.setItemAsync(HOSTS_KEY, JSON.stringify(hosts), opts());
}

async function writeHostSlot(c: Credentials): Promise<void> {
  const k = hostKeys(c.tsDns);
  await Promise.all([
    SecureStore.setItemAsync(k.deviceId, c.deviceId, opts()),
    SecureStore.setItemAsync(k.token, c.token, opts()),
    c.nseToken
      ? SecureStore.setItemAsync(k.nseToken, c.nseToken, opts())
      : SecureStore.deleteItemAsync(k.nseToken, opts()).catch(() => undefined),
  ]);
}

/** Identifiants rangés pour un Mac du registre, actif ou non. */
export async function loadHostCredentials(id: string): Promise<Credentials | null> {
  const hosts = await listHosts();
  const host = hosts.find((h) => h.id === id);
  if (!host) return null;
  const k = hostKeys(id);
  const [deviceId, token, nseToken] = await Promise.all([
    SecureStore.getItemAsync(k.deviceId, opts()),
    SecureStore.getItemAsync(k.token, opts()),
    SecureStore.getItemAsync(k.nseToken, opts()),
  ]);
  if (!deviceId || !token) return null;
  return { deviceId, token, nseToken, tsDns: id, port: host.port || DEFAULT_PORT };
}

/**
 * Le registre, migré au premier appel : un appareil appairé avant cette version a ses
 * clés `kl.*` et pas de `kl.hosts`. Son Mac devient le premier hôte, base historique.
 */
export async function listHosts(): Promise<HostEntry[]> {
  const hosts = await readHosts();
  if (hosts) return hosts;
  const active = await loadCredentials();
  const migrated = migrateRegistry(null, active);
  if (!migrated || !active) return [];
  await writeHostSlot(active);
  await writeHosts(migrated);
  return migrated;
}

/** Nom MagicDNS du Mac actif, `null` si l'appareil n'est pas appairé. */
export async function activeHostId(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.tsDns, opts());
}

/** Base SQLite du Mac actif, lue à l'ouverture de `db/index.ts`. */
export async function activeDbName(): Promise<string> {
  const [activeId, hosts] = await Promise.all([activeHostId(), readHosts()]);
  return dbNameFor(activeId, hosts);
}

/**
 * Un Mac de plus, depuis « Ajouter un Mac ». Le Mac actif ne change pas, sauf si c'est
 * lui qu'on réappaire : son emplacement actif prend alors le nouveau jeton.
 */
export async function addHost(c: Credentials, name?: string): Promise<HostEntry[]> {
  const hosts = await listHosts();
  await writeHostSlot(c);
  const next = upsertHost(hosts, hostInput(c, name));
  await writeHosts(next);
  if ((await activeHostId()) === c.tsDns) {
    await writeActive(c);
    syncWatchRelay(c);
  }
  // Même relecture que `saveCredentials` : un appairage accepté par le Mac et perdu par
  // le trousseau doit échouer ici, avec un message, pas plus tard sans explication.
  if (!(await loadHostCredentials(c.tsDns))) {
    throw new Error('keychain did not keep the new Mac (read-back of its slot is empty)');
  }
  return next;
}

/**
 * Recopie l'emplacement d'un Mac dans `kl.*`. L'appelant arrête ensuite la liaison et
 * recharge l'app (`net/hostSwitch.ts`) : aucun état d'un Mac ne survit en mémoire.
 */
export async function activateHost(id: string): Promise<void> {
  const c = await loadHostCredentials(id);
  if (!c) throw new Error(`no credentials stored for ${id}`);
  await writeActive(c);
  syncWatchRelay(c);
}

/**
 * Retire un Mac du registre et efface son emplacement. Rend le Mac à activer quand on
 * retire l'actif (ou l'actif inchangé), `null` quand il n'en reste aucun : l'appelant
 * efface alors tout (`clearCredentials`) et retourne à l'appairage.
 */
export async function removeHost(
  id: string,
): Promise<{ nextActive: string | null; removed: HostEntry | null }> {
  const hosts = await listHosts();
  const activeId = await activeHostId();
  const { hosts: rest, removed, nextActive } = removeEntry(hosts, id, activeId);
  if (rest.length === 0) return { nextActive: null, removed };
  // Activer le suivant AVANT de toucher au registre : un échec ici laisse tout intact.
  if (nextActive && nextActive !== activeId) await activateHost(nextActive);
  await writeHosts(rest);
  await Promise.all(
    Object.values(hostKeys(id)).map((k) =>
      SecureStore.deleteItemAsync(k, opts()).catch(() => undefined),
    ),
  );
  return { nextActive, removed };
}

/** Nom et rôle annoncés par le daemon dans `hello.ok`. Écrit seulement s'ils changent. */
export async function updateHostInfo(
  id: string,
  info: { name: string; role: HostRole },
): Promise<HostEntry[] | null> {
  const next = withHostInfo(await listHosts(), id, info);
  if (next) await writeHosts(next);
  return next;
}

// --- Bascule -----------------------------------------------------------------

/** « Switch on my own if the Mac does not respond », active par défaut (décision D6). */
export async function loadAutoFailover(): Promise<boolean> {
  return (await SecureStore.getItemAsync(FAILOVER_KEYS.auto, opts())) !== '0';
}

export async function setAutoFailover(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(FAILOVER_KEYS.auto, on ? '1' : '0', opts());
}

/** Nom du Mac quitté par une bascule automatique, `null` hors bascule. */
export async function loadFailedOverFrom(): Promise<string | null> {
  return SecureStore.getItemAsync(FAILOVER_KEYS.from, opts());
}

export async function setFailedOverFrom(name: string | null): Promise<void> {
  if (name) await SecureStore.setItemAsync(FAILOVER_KEYS.from, name, opts());
  else await SecureStore.deleteItemAsync(FAILOVER_KEYS.from, opts()).catch(() => undefined);
}
