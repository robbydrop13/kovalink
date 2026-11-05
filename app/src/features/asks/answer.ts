// Ce qui part au Mac quand on répond à la question d'un agent, isolé de tout réseau pour
// être testable : `src/actions/ask.ts` fait les appels, ces deux règles les encadrent.
import { ASK_TEXT_MAX, type AskItem } from '@/protocol';
import type { PanelTarget } from '@/features/panel/target';

/** Le texte libre tel qu'il part : coupé au plafond du protocole, espaces en moins. */
export function askText(raw: string): string {
  return raw.trim().slice(0, ASK_TEXT_MAX);
}

/**
 * Vrai quand ce bouton appartient bien à cette question. L'app ne propose que les boutons
 * de la question, donc ce contrôle ne devrait jamais échouer : il existe pour que, s'il
 * échoue un jour, rien ne parte au Mac. Ce mot est celui que l'agent relit, et il finit
 * retapé dans un terminal.
 */
export function isAskButton(ask: AskItem, action: string): boolean {
  return ask.buttons.includes(action);
}

/**
 * Le bouton du check : le PREMIER declare par la question, celui que la carte du Mac
 * tinte et que l'Entree choisit. `null` si la question n'en declare aucun.
 */
export function okOption(ask: AskItem): string | null {
  return askOptions(ask)[0] ?? null;
}

/** Le bouton d'une fiche native a plusieurs decisions : la rendre telle quelle. */
export const DECISION_DONE = 'Done';

/** Le bouton que Kova ajoute aux questions qui acceptent du texte libre. */
export const OTHER = 'Other';

/** Les options de l'agent, sans le `Other` que Kova ajoute pour le texte libre. */
export function askOptions(ask: AskItem): string[] {
  return ask.buttons.filter((b) => b !== OTHER);
}

/**
 * Le bouton du cross : le SECOND declare par la question.
 *
 * « No » n'est PAS un mot envoyable quand la question n'a qu'un bouton : le daemon refuse
 * tout `action` hors `buttons` (`daemon/src/kova/asks.ts`, `answer`), et le protocole est
 * hors perimetre ici. `null` dit donc qu'il n'y a rien a refuser, et la carte masque le
 * cross plutot que d'offrir un bouton qui echouerait a coup sur.
 */
export function koOption(ask: AskItem): string | null {
  return askOptions(ask)[1] ?? null;
}

/**
 * L'option qui porte un Brief : celle qu'on a cochee, sinon `Other` (la reponse libre de
 * Kova, que l'agent lit « Other: texte »). Sans option cochee ni texte, rien ne part.
 */
export function briefAction(ask: AskItem, picked: string | null): string | null {
  if (picked !== null) return isAskButton(ask, picked) ? picked : null;
  return OTHER;
}

/** Le corps d'une reponse : le bouton choisi, et le texte libre borne par le protocole. */
export function askAnswerBody(action: string, text: string): { action: string; text: string } {
  return { action, text: askText(text) };
}

/** Ce que `Open` ouvre dans le panneau : la fiche native, sinon sa page, sinon rien. */
export function askPanelTarget(ask: AskItem): PanelTarget | null {
  if (ask.sheet === true) return { kind: 'sheet', target: ask.id };
  if (ask.url) return { kind: 'web', target: ask.url };
  return null;
}

/** Une fiche de decisions : elle s'ouvre dans le panneau, jamais dans la conversation du pane. */
export function isDecisionAsk(ask: AskItem): boolean {
  return (ask.kind === 'decision' || ask.sheet === true) && askPanelTarget(ask) !== null;
}

/** Ou mene le tap sur une question : le panneau pour une fiche, sinon l'ecran de la question. */
export type AskHref = string | { pathname: '/panel'; params: { kind: string; target: string } };

/**
 * La destination d'une question nommee par son id, d'apres les questions connues. Une
 * question encore inconnue (demarrage a froid depuis une notification) va a son ecran, qui
 * redirige vers le panneau des que la liste arrive.
 */
export function askHref(askId: string, asks: readonly AskItem[]): AskHref {
  const ask = asks.find((a) => a.id === askId);
  const target = ask && isDecisionAsk(ask) ? askPanelTarget(ask) : null;
  if (target) return { pathname: '/panel', params: { kind: target.kind, target: target.target } };
  return `/ask/${askId}`;
}
