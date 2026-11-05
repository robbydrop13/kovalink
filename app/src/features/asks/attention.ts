// La file d'attention (`attn`) dans l'onglet Asks, en regles pures : les sections, le
// regroupement par sujet, les comptes, les boutons d'une ligne et ce que `Ouvrir` ouvre.
// Rien n'est lu d'un magasin ni d'une horloge : les tests le prouvent sur des entrees
// construites a la main.
//
// Trois sections, comme Kova : les entrees `now` rejoignent les questions et permissions
// en tete, `point` se replie par sujet, `memo` n'est qu'un compte qui se deplie en titres.
// Un compte est TOUJOURS la longueur de la liste qu'il annonce.
import {
  ATTENTION_DONE,
  ATTENTION_IGNORE,
  ATTENTION_OPEN,
  ATTENTION_SEND,
  type AttentionButton,
  type AttentionEntry,
} from '@/protocol';
import { isWebUrl, panelKindOfPath, type PanelTarget } from '@/features/panel/target';

/** Un sujet du prochain point : `topic` null rassemble les entrees qui n'en ont pas. */
export interface TopicGroup {
  topic: string | null;
  entries: AttentionEntry[];
}

export interface AttentionSections {
  /** Les entrees `now`, la plus ancienne d'abord. */
  now: AttentionEntry[];
  /** Les sujets dans l'ordre ou ils sont apparus, le groupe sans sujet a la fin. */
  point: TopicGroup[];
  /** Le nombre de lignes de `point`, tous sujets confondus. */
  pointCount: number;
  memo: AttentionEntry[];
}

/** Instant d'une entree en ms, 0 quand la date ne se lit pas (elle passe en tete). */
export function attentionAtMs(entry: AttentionEntry): number {
  const ms = Date.parse(entry.ts);
  return Number.isFinite(ms) ? ms : 0;
}

function byAge(a: AttentionEntry, b: AttentionEntry): number {
  return attentionAtMs(a) - attentionAtMs(b) || a.id.localeCompare(b.id);
}

export function attentionSections(entries: readonly AttentionEntry[]): AttentionSections {
  const now = entries.filter((e) => e.level === 'now').sort(byAge);
  const memo = entries.filter((e) => e.level === 'memo').sort(byAge);
  const groups = new Map<string, AttentionEntry[]>();
  const loose: AttentionEntry[] = [];
  for (const entry of [...entries].filter((e) => e.level === 'point').sort(byAge)) {
    const topic = entry.topic?.trim() ?? '';
    if (topic.length === 0) {
      loose.push(entry);
      continue;
    }
    const group = groups.get(topic);
    if (group) group.push(entry);
    else groups.set(topic, [entry]);
  }
  const point: TopicGroup[] = [...groups].map(([topic, list]) => ({ topic, entries: list }));
  if (loose.length > 0) point.push({ topic: null, entries: loose });
  const pointCount = point.reduce((n, g) => n + g.entries.length, 0);
  return { now, point, pointCount, memo };
}

/**
 * Rien du tout a montrer : ni question, ni permission, ni entree d'attention a aucun
 * niveau. Seul ce cas affiche l'etat vide ; une file qui n'a que du `point` ou du `memo`
 * montre ses sections, sans « aucune question » au dessus.
 */
export function asksScreenEmpty(feedLength: number, sections: AttentionSections): boolean {
  return feedLength === 0 && sections.now.length === 0 && sections.pointCount === 0 && sections.memo.length === 0;
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
