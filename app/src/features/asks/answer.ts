// Ce qui part au Mac quand on répond à la question d'un agent, isolé de tout réseau pour
// être testable : `src/actions/ask.ts` fait les appels, ces deux règles les encadrent.
import { ASK_TEXT_MAX, type AskItem } from '@/protocol';

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
