// Ce qui attend Robin, mis dans la forme que `needs.ts` du protocole attend. Module pur :
// les panes, leurs prompts, les routines, les questions et l'horloge arrivent en argument.
// L'ordre, le dedoublonnage et les comptes restent dans le protocole (`needItems`,
// `waitsOnYou`) : ce fichier ne fait que traduire ce que l'app sait deja.
//
// Une erreur n'a pas d'horodatage chez Kova ; le magasin des panes retient l'instant ou
// elle est apparue (`errorSince`), comme il retient deja le debut d'un travail.
import { needItems, waitsOnYou } from '@/protocol';
import type { AskItem, NeedInput, NeedItem, Pane, Prompt, Routine } from '@/protocol';

/** Secondes epoch d'une date ISO, `null` quand elle manque ou ne se lit pas. */
export function epochSecondsOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Ce que la vue Needs you affiche, sans relire le modele du protocole. */
export interface NeedCounts {
  /** Questions et prompts de permission : ce a quoi un humain doit repondre. */
  needYou: number;
  errors: number;
  failed: number;
}

/** Tout ce que l'app sait a un instant, pour construire un `NeedInput`. */
export interface NeedsSnapshot {
  panes: readonly Pane[];
  prompts: Readonly<Record<number, Prompt>>;
  routines: readonly Routine[] | null;
  asks: readonly AskItem[];
  /** Debut connu de chaque erreur, en ms epoch (voir `PanesState.errorSince`). */
  errorSince?: Readonly<Record<number, number>>;
  nowMs: number;
}

/** Le pane d'une question, par sa session (`kova ask` ne porte pas l'identifiant du pane). */
export function paneIdOfAsk(ask: AskItem, panes: readonly Pane[]): number | null {
  if (ask.sessionId === null) return null;
  for (const pane of panes) {
    if (pane.agent_session_id === ask.sessionId || pane.claude_session_id === ask.sessionId) return pane.id;
  }
  return null;
}

/** L'instant et le detail d'un prompt de permission : le prompt lu d'abord, puis `awaiting`. */
function permissionOf(pane: Pane, prompt: Prompt | undefined): { since: number; detail: string } | null {
  if (prompt && (prompt.state === 'parsed' || prompt.state === 'unparsable')) {
    const since = epochSecondsOf(prompt.awaitingSince);
    if (since !== null) {
      const detail = prompt.state === 'parsed' ? (prompt.detail[0] ?? prompt.question) : '';
      return { since, detail };
    }
  }
  if (!pane.awaiting) return null;
  const since = epochSecondsOf(pane.awaiting_since);
  return since === null ? null : { since, detail: '' };
}

/**
 * Traduit l'etat de l'app vers `NeedInput`. Un pane qui travaille est ignore : Kova ne
 * lit son erreur ou son prompt que hors travail, et le telephone doit dire la meme chose.
 * Une routine en cours n'est pas un echec (son code de sortie est encore celui d'avant).
 */
export function needInputOf(snapshot: NeedsSnapshot): NeedInput {
  const now = Math.floor(snapshot.nowMs / 1000);
  const paneOfSession = new Map<string, number>();
  for (const pane of snapshot.panes) {
    for (const sessionId of [pane.agent_session_id, pane.claude_session_id]) {
      if (sessionId !== null && !paneOfSession.has(sessionId)) paneOfSession.set(sessionId, pane.id);
    }
  }

  const panes = snapshot.panes.flatMap((pane) => {
    if (pane.working) return [];
    const permission = permissionOf(pane, snapshot.prompts[pane.id]);
    const error = pane.error ?? null;
    if (permission === null && error === null) return [];
    const errorSince = snapshot.errorSince?.[pane.id];
    return [
      {
        id: pane.id,
        error_since: error === null ? null : Math.floor((errorSince ?? snapshot.nowMs) / 1000),
        permission_since: permission?.since ?? null,
        title: pane.agent_session_name || pane.title || pane.projectName,
        detail: error?.text || error?.kind || permission?.detail || null,
      },
    ];
  });

  const routines = (snapshot.routines ?? []).map((routine) => ({
    name: routine.name,
    failed_at:
      !routine.running && routine.last !== null && routine.last.code !== 0
        ? (epochSecondsOf(routine.last.end) ?? epochSecondsOf(routine.last.start))
        : null,
    paused: !routine.enabled,
  }));

  const asks = snapshot.asks.map((ask) => {
    const [title = '', ...rest] = ask.message.split('\n');
    return {
      id: ask.id,
      pane_id: ask.sessionId === null ? null : (paneOfSession.get(ask.sessionId) ?? null),
      created_at: Math.floor(ask.askedAtMs / 1000),
      snoozed_until: ask.snoozedUntilMs > 0 ? Math.floor(ask.snoozedUntilMs / 1000) : null,
      // `list-asks` ne rend que les questions ouvertes : une repondue a deja quitte la liste.
      answered: false,
      title,
      detail: rest.length > 0 ? rest.join('\n') : null,
    };
  });

  return { panes, routines, asks, now };
}

/** Les trois mots de l'en-tete : `2 need you · 1 error · 1 failed`. */
export function needCounts(items: readonly NeedItem[]): NeedCounts {
  const counts: NeedCounts = { needYou: 0, errors: 0, failed: 0 };
  for (const item of items) {
    if (item.kind === 'error') counts.errors += 1;
    else if (item.kind === 'failed_routine') counts.failed += 1;
    else counts.needYou += 1;
  }
  return counts;
}

/** Quatre lignes par defaut, et jamais moins de deux questions quand il y a de la place. */
export const NEED_ROW_LIMIT = 4;
export const NEED_ASK_MIN = 2;

/**
 * Les lignes montrees : erreurs et routines en echec toujours, les questions remplissent
 * les quatre lignes restantes (deux au minimum, meme si les erreurs debordent deja).
 */
export function visibleNeedItems(items: readonly NeedItem[], expanded: boolean): NeedItem[] {
  if (expanded) return [...items];
  const always = items.filter((item) => item.kind === 'error' || item.kind === 'failed_routine');
  const waiting = items.filter((item) => item.kind === 'permission' || item.kind === 'ask');
  const room = Math.max(NEED_ROW_LIMIT - always.length, NEED_ASK_MIN);
  return [...always, ...waiting.slice(0, room)];
}

/**
 * Le modele affiche et le compte de la pastille, calcules par le protocole. Aucun ordre
 * ni dedoublonnage n'est reecrit ici : `needItems` et `waitsOnYou` font foi.
 */
export function needModelOf(input: NeedInput): { items: NeedItem[]; waits: number } {
  return { items: needItems(input), waits: waitsOnYou(input) };
}

/** L'identifiant de la question d'un item, `null` pour un pane ou une routine. */
export function askIdOf(item: NeedItem): string | null {
  return item.kind === 'ask' && item.key.startsWith('ask:') ? item.key.slice('ask:'.length) : null;
}

export type NeedDecision =
  | { kind: 'need'; item: NeedItem; others: number }
  | { kind: 'scheduled'; others: number }
  | null;

/**
 * La cible de Next dans l'ordre de Needs you : panes en erreur, permissions et questions,
 * en sautant la routine en echec qui n'a pas de pane. On repart apres le pane sous les
 * yeux, en bouclant, pour que des appuis repetes visitent tout. Rien a viser et une
 * routine en echec : l'onglet Scheduled, une seule fois (pas quand il est deja ouvert).
 */
export function nextNeedDecision(
  items: readonly NeedItem[],
  currentPaneId: number | null,
  scheduledOpen: boolean,
): NeedDecision {
  const targets: NeedItem[] = [];
  const seenPanes = new Set<number>();
  for (const item of items) {
    if (item.kind === 'failed_routine') continue;
    if (item.kind !== 'ask') {
      if (item.pane_id === null || seenPanes.has(item.pane_id)) continue;
      seenPanes.add(item.pane_id);
    }
    targets.push(item);
  }

  const eligible = targets.filter(
    (item) => !(item.kind !== 'ask' && item.pane_id !== null && item.pane_id === currentPaneId),
  );
  if (eligible.length === 0) {
    const failed = items.some((item) => item.kind === 'failed_routine');
    return failed && !scheduledOpen ? { kind: 'scheduled', others: 1 } : null;
  }

  const at = currentPaneId === null ? -1 : targets.findIndex((item) => item.pane_id === currentPaneId);
  const start = at + 1;
  for (let step = 0; step < targets.length; step += 1) {
    const item = targets[(start + step) % targets.length] as NeedItem;
    if (item.kind !== 'ask' && item.pane_id !== null && item.pane_id === currentPaneId) continue;
    return { kind: 'need', item, others: eligible.length };
  }
  return null;
}
