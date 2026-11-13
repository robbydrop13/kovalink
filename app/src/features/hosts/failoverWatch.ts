// Bascule automatique et sonde de retour (étape 4 du plan M1). Exécute ce que décide
// `net/failover.ts`, seule source des règles :
// - la liaison passe à « Mac injoignable » (minuteur de `connection.ts`, 8 s sans
//   reconnexion) : on sonde `/health` de tous les Macs, puis bascule, proposition d'un
//   geste, ou « hors ligne ou Mac injoignable » ;
// - sur un secours, le principal est sondé toutes les 60 s au premier plan et à chaque
//   retour au premier plan. Le retour, lui, attend toujours un geste.
//
// Abonné au magasin de liaison plutôt qu'appelé depuis `connection.ts` : `hostSwitch.ts`
// importe déjà `connection.ts`, l'inverse ferait un cycle.
import { AppState, type AppStateStatus } from 'react-native';

import { DEFAULT_PORT } from '@/protocol';
import {
  activeHostId,
  listHosts,
  loadAutoFailover,
  loadFailedOverFrom,
  setAutoFailover,
  type HostEntry,
} from '@/store/credentials';
import { useConnection } from '@/store/connection';
import { useFailover } from '@/store/failover';
import { health } from '@/net/http';
import { isSwitchingHost, switchHost } from '@/net/hostSwitch';
import {
  RETURN_PROBE_MS,
  decideFailover,
  hostBanner,
  primaryToProbe,
  shouldProbeReturn,
  type ProbedHost,
} from '@/net/failover';
import { bootLog, bootWarn } from '@/env';

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let appSub: { remove: () => void } | null = null;
let unsub: (() => void) | null = null;
/** Une sonde à la fois : un passage au premier plan pendant une sonde ne la double pas. */
let probing = false;
/** Demande arrivée pendant une sonde : rejouée à la fin, pas perdue pendant 60 s. */
let again = false;
/**
 * Liaison perdue : posé au passage à « Mac injoignable », levé seulement quand la liaison
 * revient (direct ou relayé). Pendant la panne, chaque tentative de reconnexion repasse
 * par `connecting` : sans ce drapeau, la bascule et les bandeaux clignoteraient avec elle.
 */
let lost = false;
/** Premier rendu sans attendre la sonde : le bandeau fixe s'affiche dès le rechargement. */
let rendered = false;
let failedOverFrom: string | null = null;
let primaryResponds = false;
let offer: ProbedHost | null = null;

function probed(h: HostEntry): ProbedHost {
  return { id: h.id, name: h.name, role: h.role };
}

async function respondsTo(h: HostEntry): Promise<boolean> {
  try {
    return await health({ tsDns: h.id, port: h.port || DEFAULT_PORT });
  } catch {
    return false;
  }
}

async function context(): Promise<{ activeId: string; hosts: HostEntry[] } | null> {
  const [hosts, activeId] = await Promise.all([listHosts(), activeHostId()]);
  // Un seul Mac : rien à sonder, rien à proposer.
  if (!activeId || hosts.length < 2) return null;
  return { activeId, hosts };
}

function render(activeId: string, hosts: HostEntry[]): void {
  useFailover.getState().setBanner(
    hostBanner({
      activeId,
      hosts: hosts.map(probed),
      failedOverFrom,
      primaryResponds,
      offer,
    }),
  );
}

/** Liaison perdue : bascule, proposition, ou rien si aucun Mac ne répond. */
async function checkFailover(activeId: string, hosts: HostEntry[]): Promise<void> {
  const answers = await Promise.all(hosts.map(async (h) => [h.id, await respondsTo(h)] as const));
  // La liaison a pu revenir pendant la sonde (6 s au plus), ou un geste a déjà lancé un
  // changement de Mac : on ne bascule pas sous eux.
  if (!lost || isSwitchingHost()) return;
  const responds = Object.fromEntries(answers);
  const decision = decideFailover({
    activeId,
    hosts: hosts.map(probed),
    responds,
    autoSwitch: useFailover.getState().autoSwitch,
  });
  bootLog('failover decision', decision.kind);
  const primary = primaryToProbe(activeId, hosts.map(probed));
  if (primary) primaryResponds = responds[primary.id] === true;
  useFailover.getState().setAllSilent(decision.kind === 'allSilent');
  if (decision.kind === 'switch') {
    const from = hosts.find((h) => h.id === activeId)?.name ?? activeId;
    try {
      await switchHost(decision.to.id, from);
    } catch (error) {
      bootWarn('automatic failover', error);
      offer = decision.to;
    }
  } else {
    offer = decision.kind === 'offer' ? decision.to : null;
  }
}

async function tick(): Promise<void> {
  if (isSwitchingHost() || AppState.currentState !== 'active') return;
  if (probing) {
    again = true;
    return;
  }
  probing = true;
  again = false;
  try {
    const ctx = await context();
    if (!ctx) {
      useFailover.getState().setBanner(null);
      return;
    }
    const { activeId, hosts } = ctx;
    if (!rendered) {
      rendered = true;
      render(activeId, hosts);
    }
    if (lost) {
      // `checkFailover` a déjà sondé tous les Macs, principal compris.
      await checkFailover(activeId, hosts);
      if (isSwitchingHost()) return;
    } else {
      const list = hosts.map(probed);
      const primary = primaryToProbe(activeId, list);
      const entry = primary ? hosts.find((h) => h.id === primary.id) : undefined;
      primaryResponds =
        entry && shouldProbeReturn(AppState.currentState === 'active', activeId, list)
          ? await respondsTo(entry)
          : false;
    }
    render(activeId, hosts);
  } catch (error) {
    bootWarn('failover probe', error);
  } finally {
    probing = false;
    if (again && !isSwitchingHost()) void tick();
  }
}

/** Idempotent. Appelé après le démarrage de la liaison (boot, appairage). */
export async function startFailoverWatch(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const [auto, from] = await Promise.all([loadAutoFailover(), loadFailedOverFrom()]);
    useFailover.getState().setAutoSwitch(auto);
    failedOverFrom = from;
  } catch (error) {
    bootWarn('failover settings', error);
  }

  unsub = useConnection.subscribe((s, prev) => {
    if (s.link === prev.link) return;
    if (s.link === 'macUnreachable' && !lost) {
      lost = true;
      void tick();
    } else if ((s.link === 'direct' || s.link === 'relayed') && lost) {
      // Liaison revenue : la proposition et le « hors ligne ou Mac injoignable » ne valent
      // plus. Les allers-retours par `connecting` pendant la panne ne touchent à rien.
      lost = false;
      offer = null;
      useFailover.getState().setAllSilent(false);
      void tick();
    }
  });
  lost = useConnection.getState().link === 'macUnreachable';

  appSub = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') void tick();
  });

  timer = setInterval(() => void tick(), RETURN_PROBE_MS);
  void tick();
}

export function stopFailoverWatch(): void {
  unsub?.();
  appSub?.remove();
  if (timer) clearInterval(timer);
  unsub = null;
  appSub = null;
  timer = null;
  started = false;
  lost = false;
  rendered = false;
  offer = null;
}

/** Geste du bandeau : « Return » ou « Switch ». Efface le bandeau de bascule. */
export async function goToHost(id: string): Promise<void> {
  await switchHost(id);
}

/** Interrupteur des Réglages, actif par défaut. */
export async function changeAutoSwitch(on: boolean): Promise<void> {
  useFailover.getState().setAutoSwitch(on);
  try {
    await setAutoFailover(on);
  } catch (error) {
    bootWarn('failover setting', error);
  }
}
