// La ligne d'une entree de la file d'attention (`attn`) d'avant le Cockpit, en regles
// pures : ses boutons et ce que `Ouvrir` ouvre. Le Cockpit la montre encore pour une carte
// dont la file ne liste pas les gestes (daemon ou `attn` plus anciens) ; ses sections sont
// celles du Cockpit (`features/cockpit/rules.ts`).
import {
  ATTENTION_DONE,
  ATTENTION_IGNORE,
  ATTENTION_OPEN,
  ATTENTION_SEND,
  type AttentionButton,
  type AttentionEntry,
} from '@/protocol';
import { isWebUrl, panelKindOfPath, type PanelTarget } from '@/features/panel/target';

/** Instant d'une entree en ms, 0 quand la date ne se lit pas (elle passe en tete). */
export function attentionAtMs(entry: AttentionEntry): number {
  const ms = Date.parse(entry.ts);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Ce que `Ouvrir` ouvre dans le panneau : une URL http(s), ou un fichier `.md` / `.html`
 * du Mac (absolu ou en `~/`), l'ancre retiree. Un texte libre ou un autre fichier : rien,
 * et la ligne n'offre pas `Ouvrir`. L'app ne peut pas savoir si le fichier existe : le
 * panneau dit l'erreur de lecture du Mac s'il n'existe plus.
 */
export function attentionOpenTarget(action: string | undefined): PanelTarget | null {
  const value = action?.trim() ?? '';
  if (value.length === 0) return null;
  if (isWebUrl(value)) return { kind: 'web', target: value };
  const hash = value.indexOf('#');
  const path = hash === -1 ? value : value.slice(0, hash);
  if (!path.startsWith('/') && !path.startsWith('~/')) return null;
  const kind = panelKindOfPath(path);
  return kind === null ? null : { kind, target: path };
}

/**
 * Les boutons d'une ligne, dans l'ordre affiche. `Ouvrir` d'abord quand il y a quoi
 * ouvrir ; `would` (l'agent l'aurait fait) se confirme ou s'ignore ; ce qui attend un
 * verdict de Robin (`decision`, `review`, `test`) se ferme par `Fait`. Les autres genres
 * n'ont que `Ouvrir`, quand il s'applique.
 */
export function attentionButtons(entry: AttentionEntry): AttentionButton[] {
  const out: AttentionButton[] = [];
  if (attentionOpenTarget(entry.action) !== null) out.push(ATTENTION_OPEN);
  if (entry.kind === 'would') out.push(ATTENTION_SEND, ATTENTION_IGNORE);
  else if (entry.kind === 'decision' || entry.kind === 'review' || entry.kind === 'test') out.push(ATTENTION_DONE);
  return out;
}

/**
 * Etat d'un geste sur une ligne. `sent` : `Envoyer` est parti, l'entree attend son chief.
 * `unknown` : `Envoyer` n'a pas eu de reponse claire (coupure, delai, 502), il a peut-etre
 * ete transmis ; il ne se rejoue pas.
 */
export type AttentionPhase = 'idle' | 'sending' | 'sent' | 'unknown' | 'failed';

/**
 * Ce que devient la ligne apres un `Envoyer` refuse ou sans reponse. Une coupure, un delai
 * ou un 502 ne disent pas si le clic est arrive au chief : `unknown`, jamais un echec qu'on
 * retente. Un renvoi refuse par le daemon (deja parti) vaut `sent`. Le reste est un refus net.
 */
export function phaseAfterSendFailure(
  kind: 'gone' | 'refused' | 'network',
  status?: number,
  code?: string,
): AttentionPhase {
  if (kind === 'gone') return 'idle';
  if (code === 'ATTENTION_ALREADY_SENT') return 'sent';
  if (kind === 'network' || status === 502 || status === 504) return 'unknown';
  return 'failed';
}

/**
 * Un bouton est-il actif. Un geste en vol les eteint tous ; apres `Envoyer`, la ligne
 * reste ouverte jusqu'a ce que le chief la ferme, mais rien ne repart deux fois : seul
 * `Ouvrir` reste disponible. Mac injoignable : seul `Ouvrir` d'une URL reste utile, le
 * reste ne partirait pas.
 */
export function attentionButtonEnabled(
  button: AttentionButton,
  phase: AttentionPhase,
  entry: AttentionEntry,
  unavailable: boolean,
): boolean {
  if (phase === 'sending') return false;
  if (button === ATTENTION_OPEN) {
    return !unavailable || attentionOpenTarget(entry.action)?.kind === 'web';
  }
  if (unavailable) return false;
  if (phase === 'unknown') return button !== ATTENTION_SEND;
  return phase !== 'sent';
}
