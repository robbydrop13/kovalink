// Ouvrir quelque chose dans le panneau. Hors du panneau, c'est la route `/panel` (une
// feuille) ; DANS le panneau, un lien remplace ce qui est affiche au lieu d'empiler une
// seconde feuille : le panneau fournit alors son propre ouvreur par ce contexte.
import { createContext, useContext } from 'react';
import { router } from 'expo-router';
import { fetchQuickDests } from '@/net/files';
import { askHref } from '@/features/asks/answer';
import { useAsks } from '@/store/asks';
import type { PanelTarget } from './target';

export function openInPanel(target: PanelTarget): void {
  router.push({ pathname: '/panel', params: { kind: target.kind, target: target.target } });
}

/**
 * Ouvrir une question, depuis n'importe quel point d'entree (onglet Asks, Needs you,
 * cartes en attente, Next, montre de session, Agents) : une fiche de decisions va au
 * panneau, toute autre question a son ecran.
 */
export function openAsk(askId: string, replace = false): void {
  const href = askHref(askId, useAsks.getState().asks);
  if (replace) router.replace(href);
  else router.push(href);
}

/** La liste « Recently opened », seule. */
export function openPanelHistory(): void {
  router.push({ pathname: '/panel', params: { kind: 'history' } });
}

export const PanelOpener = createContext<(target: PanelTarget) => void>(openInPanel);

export function usePanelOpener(): (target: PanelTarget) => void {
  return useContext(PanelOpener);
}

let home: Promise<string | null> | null = null;

/**
 * Le dossier personnel du Mac, pour les chemins en `~/` : le daemon refuse un chemin
 * relatif et ne developpe pas `~`. Lu une fois par la route des destinations rapides, qui
 * le porte deja ; un echec laisse `null` et sera retente a la prochaine ouverture.
 */
export function macHome(): Promise<string | null> {
  if (!home) {
    home = fetchQuickDests().then(
      (res) => res.home || null,
      () => null,
    );
    // Un echec n'est pas garde : la prochaine ouverture redemande.
    void home.then((h) => {
      if (h === null) home = null;
    });
  }
  return home;
}
