// Une passation (`kova ask --open` ou `--run`) dans une carte de question, en regles
// pures. Le pas est fait par Kova sur le Mac quand on repond par son mot (`Ouvrir` ou
// `Lancer`) ; la question reste ouverte jusqu'a `Fait`. Le telephone ne construit jamais
// la commande : il montre l'URL ou la commande telles que Kova les rend, au caractere pres.
import { HANDOFF_DONE, HANDOFF_KIND, HANDOFF_RUN, type AskItem } from '@/protocol';

export interface HandoffView {
  /** Le mot que le bouton du pas renvoie a Kova : un des `buttons` de la question. */
  step: string;
  /** Vrai pour une commande a lancer sur le Mac, faux pour une URL a ouvrir. */
  run: boolean;
  /** L'URL ou la commande, verbatim. Vide quand Kova n'a pas pu relire l'entree. */
  text: string;
  label: string | null;
  /** L'entree ne se lit plus sur le Mac : le pas echouera, `Fait` reste possible. */
  error: string | null;
  /** Le mot de `Fait`, `null` si la question ne le declare pas. */
  done: string | null;
}

/** La vue d'une passation, `null` pour toute autre question ou un pas hors des boutons. */
export function handoffView(ask: AskItem): HandoffView | null {
  const h = ask.handoff;
  if (ask.kind !== HANDOFF_KIND || !h || !ask.buttons.includes(h.step)) return null;
  const run = h.step === HANDOFF_RUN;
  return {
    step: h.step,
    run,
    text: (run ? h.command : h.url) ?? '',
    label: h.label,
    error: h.error,
    done: ask.buttons.includes(HANDOFF_DONE) ? HANDOFF_DONE : null,
  };
}
