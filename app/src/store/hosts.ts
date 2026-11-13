// Registre des Macs appairés. Fonctions PURES : `credentials.ts` lit et écrit le trousseau,
// ce module décide seulement de la forme du registre, de sa migration et du nom de la base
// locale de chaque Mac. Testé sous Node (`test/hosts.test.ts`).
//
// Le modèle « un hôte actif » ne change pas : les cinq clés `kl.*` restent l'emplacement
// actif, lu par tous les appels existants. Le registre vit à côté (`kl.hosts`), avec un
// emplacement par Mac (`kl.h.<tsDns>.*`). Changer de Mac recopie son emplacement dans `kl.*`.
import { sha256Hex } from '@/utils/sha256';

export type HostRole = 'primary' | 'secondary';

export interface HostEntry {
  /** Nom MagicDNS du Mac, identifiant stable. */
  id: string;
  /** Nom affiché (QR d'appairage, puis `hello.ok`). */
  name: string;
  port: number;
  role: HostRole;
  /**
   * Base SQLite locale de ce Mac, fixée à l'ajout et jamais recalculée. Le premier Mac
   * garde `kovalink.db` : aucune migration de données pour l'installation existante.
   */
  db: string;
}

/** Base historique, celle du premier Mac appairé. */
export const LEGACY_DB = 'kovalink.db';

/** Clés de trousseau propres à un Mac. Caractères admis par SecureStore : `[A-Za-z0-9._-]`. */
export function hostKeys(id: string): { deviceId: string; token: string; nseToken: string } {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return {
    deviceId: `kl.h.${safe}.deviceId`,
    token: `kl.h.${safe}.token`,
    nseToken: `kl.h.${safe}.nseToken`,
  };
}

/** Premier label du nom MagicDNS : `robins-mbp.tail1234.ts.net` donne `robins-mbp`. */
export function defaultHostName(tsDns: string): string {
  const first = tsDns.split('.')[0];
  return first && first.length > 0 ? first : tsDns;
}

function isRole(v: unknown): v is HostRole {
  return v === 'primary' || v === 'secondary';
}

/** Lecture tolérante de `kl.hosts` : une entrée illisible est ignorée, jamais fatale. */
export function parseHosts(raw: string | null | undefined): HostEntry[] | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const out: HostEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Partial<HostEntry>;
    if (typeof e.id !== 'string' || e.id.length === 0) continue;
    if (typeof e.db !== 'string' || e.db.length === 0) continue;
    if (out.some((h) => h.id === e.id)) continue;
    out.push({
      id: e.id,
      name: typeof e.name === 'string' && e.name.trim().length > 0 ? e.name : defaultHostName(e.id),
      port: typeof e.port === 'number' && Number.isFinite(e.port) ? e.port : 0,
      role: isRole(e.role) ? e.role : 'primary',
      db: e.db,
    });
  }
  return out;
}

/**
 * Migration au premier lancement de cette version : `kl.token` existe, `kl.hosts` non.
 * Le Mac actuel devient le premier hôte, rôle principal, base historique. Rend `null`
 * quand il n'y a rien à faire (registre déjà là, ou appareil pas appairé).
 */
export function migrateRegistry(
  hosts: HostEntry[] | null,
  active: { tsDns: string; port: number } | null,
): HostEntry[] | null {
  if (hosts !== null || !active) return null;
  return [
    {
      id: active.tsDns,
      name: defaultHostName(active.tsDns),
      port: active.port,
      role: 'primary',
      db: LEGACY_DB,
    },
  ];
}

/** Nom de base d'un Mac qu'on ajoute : la base historique si le registre est vide. */
export function newDbName(id: string, hosts: HostEntry[]): string {
  if (hosts.length === 0) return LEGACY_DB;
  const bytes = Uint8Array.from(id, (c) => c.charCodeAt(0) & 0xff);
  return `kovalink-${sha256Hex(bytes).slice(0, 12)}.db`;
}

/** Base à ouvrir pour le Mac actif. Sans registre, ou Mac inconnu : la base historique. */
export function dbNameFor(activeId: string | null, hosts: HostEntry[] | null): string {
  if (!activeId || !hosts) return LEGACY_DB;
  return hosts.find((h) => h.id === activeId)?.db ?? LEGACY_DB;
}

/**
 * Ajout ou remise à jour d'un Mac. Un Mac déjà connu (réappairage) garde sa place et sa
 * base ; un nouveau va à la fin, l'ordre étant l'ordre de préférence.
 */
export function upsertHost(
  hosts: HostEntry[],
  added: { id: string; name: string; port: number; role?: HostRole },
): HostEntry[] {
  const existing = hosts.find((h) => h.id === added.id);
  if (existing) {
    return hosts.map((h) =>
      h.id === added.id
        ? { ...h, name: added.name, port: added.port, role: added.role ?? h.role }
        : h,
    );
  }
  return [
    ...hosts,
    {
      id: added.id,
      name: added.name,
      port: added.port,
      // Le premier Mac est le principal ; les suivants sont des secours tant que le daemon
      // n'a pas dit son rôle dans `hello.ok`.
      role: added.role ?? (hosts.length === 0 ? 'primary' : 'secondary'),
      db: newDbName(added.id, hosts),
    },
  ];
}

/**
 * Retrait d'un Mac. `nextActive` est le Mac à activer quand on retire l'actif : le premier
 * qui reste, dans l'ordre de préférence ; `null` quand il n'en reste aucun.
 */
export function removeEntry(
  hosts: HostEntry[],
  id: string,
  activeId: string | null,
): { hosts: HostEntry[]; removed: HostEntry | null; nextActive: string | null } {
  const removed = hosts.find((h) => h.id === id) ?? null;
  const rest = hosts.filter((h) => h.id !== id);
  const nextActive = activeId !== null && activeId !== id ? activeId : (rest[0]?.id ?? null);
  return { hosts: rest, removed, nextActive };
}

/** Mise à jour du nom et du rôle annoncés par `hello.ok`. Rend `null` si rien ne change. */
export function withHostInfo(
  hosts: HostEntry[],
  id: string,
  info: { name: string; role: HostRole },
): HostEntry[] | null {
  const h = hosts.find((x) => x.id === id);
  const name = info.name.trim();
  if (!h || name.length === 0) return null;
  if (h.name === name && h.role === info.role) return null;
  return hosts.map((x) => (x.id === id ? { ...x, name, role: info.role } : x));
}

/**
 * Libellé de la pastille de liaison. Le nom du Mac passe devant l'état dès qu'il y a plus
 * d'un Mac : c'est du texte, la couleur seule ne dit pas lequel répond.
 */
export function linkLabelWithHost(label: string, hostName: string | null, hostCount: number): string {
  return hostCount > 1 && hostName ? `${hostName} · ${label}` : label;
}
