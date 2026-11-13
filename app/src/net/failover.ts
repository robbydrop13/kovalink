// Bascule entre Macs (étape 4 du plan M1). Fonctions PURES, testées sous Node comme
// `resume.ts` : `features/hosts/failoverWatch.ts` sonde `/health`, puis exécute ce que ces
// fonctions décident.
//
// Trois règles tenues ici, pas dans l'écran :
// - on ne bascule que si un AUTRE Mac répond : c'est la preuve que le réseau du téléphone
//   marche et que c'est bien le Mac actif qui est absent. Aucun ne répond : « hors ligne ou
//   Mac injoignable », on reste ;
// - la bascule automatique part seulement du Mac principal. Depuis un secours, on propose
//   d'un geste : deux secours ne peuvent pas se renvoyer la balle ;
// - le retour vers le principal n'est JAMAIS automatique. Une session peut tourner sur le
//   secours, c'est Robin qui choisit le moment.
import type { HostRole } from '@/store/hosts';

/** Sur un secours, la sonde du principal au premier plan. */
export const RETURN_PROBE_MS = 60_000;

export interface ProbedHost {
  id: string;
  name: string;
  role: HostRole;
}

export interface FailoverInput {
  activeId: string;
  /** Registre dans l'ordre de préférence (`kl.hosts`). */
  hosts: ProbedHost[];
  /** Réponse de `/health` par Mac. Absent : pas sondé, compté comme muet. */
  responds: Record<string, boolean>;
  /** Interrupteur des Réglages « Switch on my own if the Mac does not respond ». */
  autoSwitch: boolean;
}

export type FailoverDecision =
  /** Le Mac actif répond à `/health` : la coupure est ailleurs (socket, jeton), on reste. */
  | { kind: 'stay' }
  /** Aucun Mac ne répond : le téléphone est sans doute hors ligne. Pas de bascule. */
  | { kind: 'allSilent' }
  /** Basculer maintenant, sans geste. */
  | { kind: 'switch'; to: ProbedHost }
  /** Proposer d'un geste (interrupteur coupé, ou départ depuis un secours). */
  | { kind: 'offer'; to: ProbedHost };

/**
 * Décision quand la liaison au Mac actif est perdue depuis `UNREACHABLE_AFTER_MS`.
 * La cible est le premier Mac qui répond, dans l'ordre de préférence.
 */
export function decideFailover(input: FailoverInput): FailoverDecision {
  if (input.responds[input.activeId] === true) return { kind: 'stay' };
  const to = input.hosts.find((h) => h.id !== input.activeId && input.responds[h.id] === true);
  if (!to) return { kind: 'allSilent' };
  const active = input.hosts.find((h) => h.id === input.activeId);
  // Depuis un secours, aller vers le principal est un RETOUR : jamais automatique. Aller
  // vers un autre secours non plus : seul le principal bascule seul, et seulement vers un
  // secours. Deux daemons qui se disent tous deux principaux ne se renvoient pas la balle.
  if (!active || active.role !== 'primary' || to.role !== 'secondary') return { kind: 'offer', to };
  return input.autoSwitch ? { kind: 'switch', to } : { kind: 'offer', to };
}

/**
 * Le Mac principal à sonder pour proposer le retour : seulement quand le Mac actif est un
 * secours. `null` sur le principal, ou sans principal connu.
 */
export function primaryToProbe(activeId: string, hosts: ProbedHost[]): ProbedHost | null {
  const active = hosts.find((h) => h.id === activeId);
  if (!active || active.role === 'primary') return null;
  return hosts.find((h) => h.id !== activeId && h.role === 'primary') ?? null;
}

/** La sonde de retour ne tourne qu'au premier plan, et seulement sur un secours. */
export function shouldProbeReturn(appActive: boolean, activeId: string, hosts: ProbedHost[]): boolean {
  return appActive && primaryToProbe(activeId, hosts) !== null;
}

/**
 * Bandeau d'hôte, un seul à la fois. Après une bascule automatique, le bandeau fixe reste
 * tant que le principal ne répond pas ; dès qu'il répond, il laisse place au retour.
 */
export type HostBanner =
  | { kind: 'failedOver'; from: string; here: string }
  | { kind: 'returnAvailable'; to: ProbedHost }
  | { kind: 'offer'; to: ProbedHost }
  | null;

export function hostBanner(input: {
  activeId: string;
  hosts: ProbedHost[];
  /** Nom du Mac quitté par une bascule automatique, `null` sans bascule en cours. */
  failedOverFrom: string | null;
  /** Dernière réponse de la sonde du principal. */
  primaryResponds: boolean;
  /** Proposition en attente (interrupteur coupé ou départ depuis un secours). */
  offer: ProbedHost | null;
}): HostBanner {
  const active = input.hosts.find((h) => h.id === input.activeId);
  if (!active) return null;
  const primary = primaryToProbe(input.activeId, input.hosts);
  if (primary && input.primaryResponds) return { kind: 'returnAvailable', to: primary };
  if (input.offer && input.offer.id !== input.activeId) return { kind: 'offer', to: input.offer };
  if (primary && input.failedOverFrom) {
    return { kind: 'failedOver', from: input.failedOverFrom, here: active.name };
  }
  return null;
}
