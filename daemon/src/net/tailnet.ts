import { execFile } from 'node:child_process';
import { isTailscale4, isTailscale6 } from '../security/bind.js';
import { tailscaleBin } from './tailscale.js';

export { parseBackendState as parseBackend } from './tailscale.js';

/**
 * Le telephone joint ce Mac par son adresse Tailscale, et par elle seule. Sans cette
 * adresse le daemon n'ecoute que la loopback : il tourne, `status` dit `kova up`, et
 * l'app n'affiche plus rien.
 *
 * Constate du 12/11/2026 17:07 au 13/11 21:40 : le Mac a redemarre, Tailscale s'est
 * lance sans se connecter, et pendant 28 heures le daemon n'a ecoute que 127.0.0.1 et
 * ::1 sans rien en dire. Robin a lu « No sessions » sur son telephone.
 *
 * Ce module dit l'absence (journal, `status`, etat publie) et tente UNE fois par panne
 * de reconnecter Tailscale quand il est simplement arrete. Un Tailscale deconnecte de
 * son compte (`NeedsLogin`) n'est jamais touche : c'est a Robin de s'y reconnecter.
 */

/** Delai laisse a Tailscale pour monter apres un demarrage ou un reveil. */
export const TAILNET_GRACE_MS = 120_000;

export function hasTailnetBind(binds: readonly string[]): boolean {
  return binds.some((addr) => isTailscale4(addr) || isTailscale6(addr));
}

export interface TailnetWatch {
  /** Depuis quand aucune adresse Tailscale n'est ecoutee (ms), ou null. */
  missingSince: number | null;
  warned: boolean;
  upTried: boolean;
}

export const TAILNET_OK: TailnetWatch = { missingSince: null, warned: false, upTried: false };

export interface TailnetStep {
  state: TailnetWatch;
  /** A dire une fois : le telephone ne peut pas joindre ce Mac. */
  warn: boolean;
  /** A tenter une fois : `tailscale up`. */
  tryUp: boolean;
  /** L'ecoute est revenue apres une panne de cette duree (ms). */
  recoveredAfterMs: number | null;
}

/**
 * Un pas du guet, a chaque re-scan des ecouteurs. Pur : l'appelant journalise et
 * lance la commande.
 */
export function tailnetStep(
  prev: TailnetWatch,
  listening: boolean,
  backend: string | null,
  now: number,
  opts: { autoUp: boolean; graceMs?: number },
): TailnetStep {
  if (listening) {
    const recoveredAfterMs = prev.missingSince !== null && prev.warned ? now - prev.missingSince : null;
    return { state: TAILNET_OK, warn: false, tryUp: false, recoveredAfterMs };
  }
  const missingSince = prev.missingSince ?? now;
  const late = now - missingSince >= (opts.graceMs ?? TAILNET_GRACE_MS);
  const warn = late && !prev.warned;
  // `Stopped` seulement : c'est l'etat d'un Tailscale lance mais pas connecte, celui
  // que `tailscale up` repare sans rien demander a personne.
  const tryUp = late && opts.autoUp && !prev.upTried && backend === 'Stopped';
  return {
    state: { missingSince, warned: prev.warned || warn, upTried: prev.upTried || tryUp },
    warn,
    tryUp,
    recoveredAfterMs: null,
  };
}

/** Ce que `status` et l'etat publie disent de l'ecoute Tailscale. */
export interface TailnetState {
  listening: boolean;
  /** Debut de la panne, ISO, ou null. */
  since: string | null;
  backend: string | null;
}

export function tailnetState(watch: TailnetWatch, listening: boolean, backend: string | null): TailnetState {
  return {
    listening,
    since: !listening && watch.missingSince !== null ? new Date(watch.missingSince).toISOString() : null,
    backend,
  };
}

/** La phrase de `status`, vide quand l'ecoute Tailscale est la ou encore dans son delai. */
export function tailnetWarning(state: TailnetState | undefined, now: number, graceMs = TAILNET_GRACE_MS): string | null {
  if (!state || state.listening || !state.since) return null;
  if (now - Date.parse(state.since) < graceMs) return null;
  const why =
    state.backend === 'NeedsLogin'
      ? 'Tailscale est deconnecte de son compte sur ce Mac : ouvre Tailscale et reconnecte toi'
      : state.backend === 'Stopped'
        ? 'Tailscale est arrete sur ce Mac : `tailscale up`, ou Connect dans son menu'
        : `Tailscale ne donne pas d'adresse a ce Mac (etat ${state.backend ?? 'inconnu'})`;
  return `ATTENTION : aucune ecoute Tailscale depuis ${state.since}, le telephone ne peut pas joindre ce Mac. ${why}`;
}

/** `tailscale up`, borne dans le temps. Rend null en cas de succes, la cause sinon. */
export function tailscaleUp(timeoutMs = 20_000): Promise<string | null> {
  const bin = tailscaleBin();
  if (!bin) return Promise.resolve('binaire tailscale introuvable');
  return new Promise((resolve) => {
    execFile(bin, ['up'], { timeout: timeoutMs }, (err, _stdout, stderr) => {
      resolve(err ? (stderr.trim().split('\n')[0] || err.message).slice(0, 200) : null);
    });
  });
}
