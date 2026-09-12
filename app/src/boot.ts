// Séquence de démarrage.
//
// Règle qui gouverne tout ce fichier : AUCUNE étape ne peut empêcher l'app d'atteindre un
// état affichable. Le démarrage se décompose en étapes isolées, chacune sous son propre
// try/catch, chacune tracée. Une étape de confort qui échoue (notifications, réseau, file
// d'attente) dégrade la fonctionnalité, elle n'éteint pas l'écran.
//
// Deux seules étapes sont bloquantes, et elles sont locales : lire les préférences et lire le
// trousseau. Si même celles là échouent, on affiche un écran d'erreur actionnable, jamais un
// squelette éternel.
import { useEffect } from 'react';
import { create } from 'zustand';

import { bootLog, bootWarn, pushAvailable } from '@/env';
import { t } from '@/i18n/en';
import { loadCredentials } from '@/store/credentials';
import { usePanes } from '@/store/panes';
import { useDrafts } from '@/store/drafts';
import { useReads } from '@/store/reads';
import { usePrompts } from '@/store/prompts';
import { usePrefs } from '@/store/prefs';
import { startConnection } from '@/net/connection';
import { setupNotifications, subscribeToNotifications } from '@/notifications/register';
import { flushOutbox } from '@/actions/outboxRunner';
import { pump, watchWifi } from '@/store/transfers';

export type BootState = 'loading' | 'unpaired' | 'ready' | 'failed';

/** Délai maximal de l'état `loading`. Au delà, on montre une erreur, pas un squelette. */
const LOADING_TIMEOUT_MS = 12_000;

interface BootStore {
  state: BootState;
  error: unknown;
  set: (state: BootState, error?: unknown) => void;
}

const useBootStore = create<BootStore>((set) => ({
  state: 'loading',
  error: null,
  set: (state, error = null) => set({ state, error }),
}));

// Deux sélecteurs distincts, jamais un objet reconstruit à chaque rendu : zustand compare
// par identité et une nouvelle référence à chaque appel provoquerait une boucle de rendu.
export function useBootState(): BootState {
  return useBootStore((s) => s.state);
}

export function useBootError(): unknown {
  return useBootStore((s) => s.error);
}

/** Exécute `step`, journalise, et rend `null` en cas d'échec au lieu de propager. */
async function attempt<T>(name: string, step: () => Promise<T>): Promise<T | null> {
  try {
    const value = await step();
    bootLog(`${name} ok`);
    return value;
  } catch (error) {
    bootWarn(name, error);
    return null;
  }
}

let started = false;
let wifiWatcher: { remove: () => void } | null = null;

export async function runBoot(): Promise<void> {
  if (started) return;
  started = true;

  const finish = useBootStore.getState().set;
  bootLog('boot start', { pushAvailable });

  // Filet contre un blocage : si rien n'a abouti dans le délai, on sort de `loading`.
  const timeout = setTimeout(() => {
    if (useBootStore.getState().state === 'loading') {
      bootWarn('boot timeout exceeded', `${LOADING_TIMEOUT_MS} ms`);
      finish(
        'failed',
        new Error(t.bootStorageFailed(Math.round(LOADING_TIMEOUT_MS / 1000))),
      );
    }
  }, LOADING_TIMEOUT_MS);

  try {
    // 1. Préférences et compteurs. Échec sans conséquence : les valeurs par défaut suffisent.
    await attempt('prefs', () => usePrefs.getState().hydrate());

    // 2. Trousseau. C'est la seule lecture qui décide de la route de départ.
    const creds = await attempt('keychain', loadCredentials);

    if (!creds) {
      bootLog('device not paired, route /pair');
      finish('unpaired');
      return;
    }

    // 3. Cache local des panes. La liste doit être visible avant le réseau.
    await attempt('panes cache', () => usePanes.getState().hydrate());
    await attempt('drafts', () => useDrafts.getState().hydrate());
    await attempt('read marks', () => useReads.getState().hydrate());
    await attempt('prompts cache', () => usePrompts.getState().hydrate());

    // L'app est affichable ici. Tout ce qui suit est asynchrone et facultatif.
    bootLog('device paired, route /');
    finish('ready');

    // 4. Purge des envois expirés, AVANT toute tentative de vidange.
    await attempt('outbox', flushOutbox);

    // 5. Connexion. Un échec mène à l'écran Sessions en mode dégradé, jamais à un blocage :
    //    la pastille de liaison affiche `Mac injoignable` et le cache reste lisible.
    await attempt('connection', startConnection);

    // 6. Notifications. Indisponibles dans Expo Go, et jamais bloquantes ailleurs.
    await attempt('notifications', setupNotifications);

    // 7. Transferts. Un envoi mis en attente de Wi-Fi doit repartir tout seul quand le
    //    Wi-Fi revient, sans que Robin ait à rouvrir l'écran Fichiers (A4).
    await attempt('transfers', async () => {
      wifiWatcher?.remove();
      wifiWatcher = watchWifi();
      void pump();
    });
  } catch (error) {
    // Ne devrait pas arriver, chaque étape est déjà protégée. Filet de dernier recours.
    bootWarn('boot sequence', error);
    if (useBootStore.getState().state === 'loading') finish('failed', error);
  } finally {
    clearTimeout(timeout);
  }
}

/** Relance complète, depuis l'écran d'erreur. */
export function retryBoot(): void {
  started = false;
  useBootStore.getState().set('loading');
  void runBoot();
}

/**
 * Appelé par l'écran d'appairage quand le jeton vient d'être écrit en trousseau.
 * Sans lui, l'état de démarrage resterait `unpaired`, l'écran Sessions renverrait aussitôt
 * vers `/pair`, et les deux écrans se renverraient la balle indéfiniment.
 */
export function markPaired(): void {
  bootLog('pairing saved, state ready');
  useBootStore.getState().set('ready');
}

/** Appelé par la révocation d'appairage : on repart sur le flux d'appairage. */
export function markUnpaired(): void {
  bootLog('pairing revoked, state unpaired');
  useBootStore.getState().set('unpaired');
}

/**
 * Monté une seule fois par le layout racine. Il lance la séquence et pose les écouteurs de
 * notification, qui sont eux aussi protégés : dans Expo Go, ils ne sont simplement pas posés.
 */
export function useBootRunner(): void {
  useEffect(() => {
    void runBoot();
    const unsubscribe = subscribeToNotifications();
    return unsubscribe;
  }, []);
}
