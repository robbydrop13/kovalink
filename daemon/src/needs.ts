// Ce que le daemon sait deja, mis dans la forme que `needs.ts` du protocole attend :
// les panes avec leur prompt de permission et leur erreur, les questions de `kova ask`,
// les entrees de la file d'attention (`attn`), et une seule lecture d'horloge. Kova calcule le meme modele pour sa barre laterale ;
// ici il n'alimente que le compte `waitsOnYou` (message WS et pastille de l'icone).
//
// Les routines planifiees ne sont pas lues par le daemon : la liste est vide, jamais
// inventee. Les deux fonctions sont pures et prennent l'horloge, pour se tester sans
// attendre.
import {
  waitsOnYou,
  type AskItem,
  type AttentionEntry,
  type NeedInput,
  type Pane,
} from '@kovalink/protocol';

function epochSecondsOf(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Traduit l'etat du daemon vers `NeedInput`.
 *
 * `permission_since` vient de `awaiting_since` : c'est l'instant ou le daemon a pose
 * `awaiting` (PromptDetector) ou celui que Kova a donne. Une erreur n'a pas d'horodatage
 * chez Kova : `error_since` vaut `now`, l'instant ou on la voit pour la premiere fois.
 * Une question est rattachee a son pane par sa session, ce qui permet de la dedoublonner
 * avec le prompt de permission du meme pane. Une entree d'attention est datee par son
 * `ts` ; une date illisible l'ecarte (`attention.ts` les a deja filtrees).
 */
export function needInputOf(
  panes: readonly Pane[],
  asks: readonly AskItem[],
  nowMs: number,
  attention: readonly AttentionEntry[] = [],
): NeedInput {
  const now = Math.floor(nowMs / 1000);
  const paneOfSession = new Map<string, number>();
  for (const pane of panes) {
    for (const sessionId of [pane.agent_session_id, pane.claude_session_id]) {
      if (sessionId !== null && !paneOfSession.has(sessionId)) paneOfSession.set(sessionId, pane.id);
    }
  }

  const paneNeeds = panes.flatMap((pane) => {
    const permission = pane.awaiting ? (epochSecondsOf(pane.awaiting_since) ?? now) : null;
    const error = pane.error ?? null;
    if (permission === null && error === null) return [];
    return [
      {
        id: pane.id,
        error_since: error === null ? null : now,
        permission_since: permission,
        title: pane.title ?? (pane.projectName || 'Shell'),
        detail: error?.text ?? null,
      },
    ];
  });

  return {
    panes: paneNeeds,
    routines: [],
    asks: asks.map((ask) => {
      const [title = '', ...rest] = ask.message.split('\n');
      return {
        id: ask.id,
        pane_id: ask.sessionId === null ? null : (paneOfSession.get(ask.sessionId) ?? null),
        created_at: Math.floor(ask.askedAtMs / 1000),
        snoozed_until: ask.snoozedUntilMs > 0 ? Math.floor(ask.snoozedUntilMs / 1000) : null,
        // `list-asks` de Kova ne rend que les questions en attente : une question
        // repondue n'a pas d'identifiant ici, elle a deja quitte la liste.
        answered: false,
        title,
        detail: rest.length > 0 ? rest.join('\n') : null,
      };
    }),
    attention: attention.flatMap((entry) => {
      const since = epochSecondsOf(entry.ts);
      return since === null ? [] : [{ id: entry.id, since, level: entry.level, title: entry.title }];
    }),
    now,
  };
}

/**
 * La pastille de l'icone et le champ `waitsOnYou` du message `asks` : le meme calcul,
 * une seule definition.
 */
export function waitsOnYouOf(
  panes: readonly Pane[],
  asks: readonly AskItem[],
  nowMs: number,
  attention: readonly AttentionEntry[] = [],
): number {
  return waitsOnYou(needInputOf(panes, asks, nowMs, attention));
}
