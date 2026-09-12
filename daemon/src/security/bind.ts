import { networkInterfaces } from 'node:os';

/** Tailscale IPv4 : plage CGNAT 100.64.0.0/10. */
export function isTailscale4(addr: string): boolean {
  const o = addr.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return o[0] === 100 && (o[1] as number) >= 64 && (o[1] as number) <= 127;
}

/** Tailscale IPv6 : prefixe ULA du tailnet. */
export function isTailscale6(addr: string): boolean {
  return addr.toLowerCase().startsWith('fd7a:115c:a1e0');
}

export interface NetIface {
  address: string;
  family: string;
  internal: boolean;
}

/**
 * Contrainte 1 : bind sur la loopback et l'interface Tailscale, EXCLUSIVEMENT.
 * `0.0.0.0` et `::` n'apparaissent nulle part dans ce projet, et `bind.test.ts` le
 * verifie sur tout `src/`.
 */
export function resolveBinds(ifaces: Record<string, NetIface[] | undefined>): string[] {
  const addrs = ['127.0.0.1', '::1'];
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.internal) continue;
      if (ni.family === 'IPv4' && isTailscale4(ni.address)) addrs.push(ni.address);
      if (ni.family === 'IPv6' && isTailscale6(ni.address)) addrs.push(ni.address);
    }
  }
  return [...new Set(addrs)];
}

export function currentBinds(): string[] {
  return resolveBinds(networkInterfaces() as Record<string, NetIface[] | undefined>);
}

/** L'adresse Tailscale n'existe qu'une fois Tailscale demarre : on re-scanne. */
export const BIND_RESCAN_MS = 30_000;
