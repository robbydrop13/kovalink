// Notification d'un Mac qui n'est pas le Mac actif (étape 5 du plan M1). Fonctions PURES,
// testées sous Node (`test/hostRoute.test.ts`) : `quickAction.ts` et `register.ts` lisent
// le trousseau, ce module décide seulement.
//
// La charge porte `host`, le `tsDns` du daemon émetteur. Un `paneId` ou un `promptRef`
// n'a de sens que sur ce Mac : les ouvrir ou y répondre depuis un autre Mac viserait un
// autre pane, ou rien.

/** Geste de Robin sur la bannière : l'ouvrir (tap, bouton Open) ou une action rapide. */
export type NotificationGesture = 'open' | 'action';

export type HostRoute =
  /** Charge du Mac actif, ou sans `host` (daemon d'avant ce champ) : comportement inchangé. */
  | { kind: 'here' }
  /** Ouverture d'une bannière d'un autre Mac connu : changer de Mac, puis ouvrir le pane. */
  | { kind: 'switch'; hostId: string }
  /** Ouverture d'une bannière d'un Mac retiré du registre : l'app, sans viser de pane. */
  | { kind: 'openRoot' }
  /** Action rapide pour un autre Mac : ne rien faire, dire d'ouvrir l'app. */
  | { kind: 'openApp'; hostName: string | null };

export interface KnownHost {
  id: string;
  name: string;
}

export function routeForHost(input: {
  payloadHost: unknown;
  activeId: string | null;
  hosts: readonly KnownHost[];
  gesture: NotificationGesture;
}): HostRoute {
  const { payloadHost, activeId, hosts, gesture } = input;
  if (typeof payloadHost !== 'string' || payloadHost.length === 0) return { kind: 'here' };
  // Pas de Mac actif lisible : appareil pas appairé, ou trousseau verrouillé (Stop ne
  // demande pas Face ID). Une ouverture garde le chemin d'origine ; une action rapide
  // n'agit pas, car `interruptPane` mettrait en file le `paneId` d'un autre Mac, vidée
  // vers le Mac actif au déverrouillage.
  if (!activeId) return gesture === 'action' ? { kind: 'openApp', hostName: null } : { kind: 'here' };
  if (payloadHost === activeId) return { kind: 'here' };
  const known = hosts.find((h) => h.id === payloadHost) ?? null;
  // Une action rapide n'agit jamais sur un autre Mac : elle partirait avec le jeton du Mac
  // actif, vers le Mac actif, pour un prompt qui n'y existe pas.
  if (gesture === 'action') return { kind: 'openApp', hostName: known?.name ?? null };
  return known ? { kind: 'switch', hostId: known.id } : { kind: 'openRoot' };
}

/**
 * Au premier plan, l'app remplace la bannière système par son bandeau interne, qui ne
 * connaît que le Mac actif. Une bannière d'un autre Mac s'affiche donc, sinon elle se perd.
 */
export function showSystemBannerInForeground(payloadHost: unknown, activeId: string | null): boolean {
  return (
    typeof payloadHost === 'string' &&
    payloadHost.length > 0 &&
    activeId !== null &&
    payloadHost !== activeId
  );
}

// --- Route en attente --------------------------------------------------------
//
// Changer de Mac recharge l'app (`net/hostSwitch.ts`) : le pane à ouvrir doit survivre au
// rechargement. Il est rangé au trousseau avant, et lu une fois l'app prête sur le bon Mac.

export interface PendingRoute {
  host: string;
  path: string;
  at: number;
}

/** Au delà, la route est oubliée : un rechargement prend une à deux secondes. */
export const PENDING_ROUTE_TTL_MS = 60_000;

export function serializePendingRoute(route: PendingRoute): string {
  return JSON.stringify(route);
}

export function parsePendingRoute(raw: string | null | undefined): PendingRoute | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingRoute> | null;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.host !== 'string' || typeof v.path !== 'string' || typeof v.at !== 'number') {
      return null;
    }
    return { host: v.host, path: v.path, at: v.at };
  } catch {
    return null;
  }
}

/**
 * Chemin à ouvrir après le rechargement, ou `null`. Seulement sur le Mac visé (un
 * changement de Mac qui a échoué ne doit pas ouvrir son pane sur l'autre), seulement un
 * chemin interne, et seulement s'il est récent.
 */
export function pendingPathFor(
  route: PendingRoute | null,
  activeId: string | null,
  now: number,
): string | null {
  if (!route || !activeId || route.host !== activeId) return null;
  if (!route.path.startsWith('/') || route.path.startsWith('//')) return null;
  const age = now - route.at;
  if (age < 0 || age > PENDING_ROUTE_TTL_MS) return null;
  return route.path;
}
