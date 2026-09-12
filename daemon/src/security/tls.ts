import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { logger } from '../logger.js';
import { tailscaleBin } from '../net/tailscale.js';
import { paths } from '../paths.js';

/** A12 : reemission a moins de 30 jours de l'expiration, verifiee une fois par jour. */
export const RENEW_BELOW_DAYS = 30;
export const CERT_CHECK_INTERVAL_MS = 24 * 3_600_000;

/** Echec de mise en place du certificat, avec un message directement actionnable. */
export class CertificateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificateError';
  }
}

export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
}

function daysUntilExpiry(certPath: string): number {
  try {
    const cert = new X509Certificate(readFileSync(certPath));
    return (Date.parse(cert.validTo) - Date.now()) / 86_400_000;
  } catch {
    return -1;
  }
}

/** Date d'expiration ISO du certificat sur disque, `null` s'il est illisible. */
export function certExpiresAt(certPath = paths.certFile()): string | null {
  try {
    return new Date(Date.parse(new X509Certificate(readFileSync(certPath)).validTo)).toISOString();
  } catch {
    return null;
  }
}

/** Vrai quand le materiel a change : cle ou certificat. */
export function sameMaterial(a: TlsMaterial, b: TlsMaterial): boolean {
  return a.key.equals(b.key) && a.cert.equals(b.cert);
}

/**
 * TLS par certificat `tailscale cert` sur le nom MagicDNS (A12).
 *
 * Let's Encrypt, publiquement valide, valide par la chaine de confiance systeme d'iOS :
 * plus d'epinglage SPKI, plus de module natif Swift, `fetch` et `WebSocket` standards.
 * La cle privee n'est jamais regeneree, `tailscale cert` la reutilise.
 */
export function ensureCertificate(tsDns: string, force = false): TlsMaterial {
  mkdirSync(paths.certDir(), { recursive: true, mode: 0o700 });
  const certPath = paths.certFile();
  const keyPath = paths.keyFile();

  const needs = force || !existsSync(certPath) || daysUntilExpiry(certPath) < RENEW_BELOW_DAYS;
  if (needs) {
    const bin = tailscaleBin();
    if (!bin) {
      throw new CertificateError(
        [
          'Tailscale est introuvable sur cette machine.',
          'Installe Tailscale, connecte le, puis relance kovalinkd.',
        ].join(' '),
      );
    }
    logger.info('emission du certificat tailscale', { tsDns });
    try {
      execFileSync(bin, ['cert', '--cert-file', certPath, '--key-file', keyPath, tsDns], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      // Cas le plus frequent, mesure sur le tailnet de Robin : la fonction HTTPS du
      // tailnet n'est pas activee. Le message doit dire quoi faire, pas afficher une
      // trace d'appel.
      const stderr = String((e as { stderr?: unknown }).stderr ?? '').trim();
      const hint = /does not support getting TLS certs|HTTPS/i.test(stderr)
        ? [
            `Les certificats HTTPS ne sont pas actives pour ce tailnet.`,
            `Ouvre https://login.tailscale.com/admin/dns, active HTTPS Certificates,`,
            `puis relance kovalinkd.`,
          ].join(' ')
        : `Verifie que ${tsDns} est bien le nom MagicDNS de ce Mac (tailscale status).`;
      throw new CertificateError(
        `tailscale cert a echoue pour ${tsDns}. ${hint}${stderr ? ` Detail : ${stderr}` : ''}`,
      );
    }
  }

  if (statSync(keyPath).mode & 0o077) {
    logger.warn('la cle TLS n est pas en 0600', { keyPath });
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}
