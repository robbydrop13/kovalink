// Les questions des agents (`kova ask`), lues sur la carte de Kova et servies au
// telephone.
//
// Pourquoi ce module existe : une question de `kova ask` ne vivait que sur la carte du
// Mac. Posee pendant que Robin n'etait pas devant son ecran, elle bloquait l'agent
// jusqu'a son retour, et c'est exactement la situation ou KovaLink sert.
//
// Ce que ce module NE fait pas : ecrire dans un pane. Repondre a une question passe par
// `answer-ask`, et c'est Kova qui porte la reponse a l'agent, par le chemin exact de sa
// carte (socket encore ouverte, sinon frappe dans son pane, sinon reprise de sa
// conversation). `KeyGate` reste le seul point d'ecriture de touches du daemon.
//
// Trois commandes de Kova, et un Kova anterieur a `list-asks` repond `unknown command` :
// c'est `supported: false`, jamais une liste vide, qui se lirait « aucune question ».
import { ASK_TEXT_MAX, type AskItem, type AskSnoozeChoice, type AsksResponse } from '@kovalink/protocol';
import { logger } from '../logger.js';
import { IpcError, type KovaIpc } from './ipc.js';

/**
 * Cadence de relecture de la carte. Kova n'emet aucun evenement quand une question
 * arrive ou qu'elle est repondue sur le Mac : sans sondage, le telephone n'apprendrait
 * rien. Une requete sur une socket Unix locale, quelques centaines d'octets, et 3 s
 * borne le retard d'une notification a ce que personne ne remarque.
 */
export const ASK_POLL_MS = 3_000;

export class AskError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'ASK_NOT_FOUND' | 'KOVA_TOO_OLD',
    message: string,
  ) {
    super(message);
    this.name = 'AskError';
  }
}

/**
 * Une question telle que Kova la rend, traduite une fois pour toutes : `snake_case` vers
 * `camelCase`, secondes vers millisecondes. Rend `null` sur une ligne qui n'a pas la
 * forme attendue, plutot qu'une question a moitie lue.
 */
export function mapAsk(raw: unknown): AskItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  const message = r['message'];
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof message !== 'string') return null;
  const buttons = Array.isArray(r['buttons'])
    ? r['buttons'].filter((b): b is string => typeof b === 'string')
    : [];
  if (buttons.length === 0) return null;
  const seconds = (key: string): number => {
    const v = r[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : 0;
  };
  const text = (key: string): string | null => {
    const v = r[key];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  return {
    id,
    from: text('from') ?? 'agent',
    message,
    buttons,
    input: r['input'] !== false,
    askedAtMs: seconds('asked_at'),
    snoozedUntilMs: seconds('snoozed_until'),
    due: r['due'] !== false,
    waiting: r['waiting'] === true,
    sessionId: text('session_id'),
    cwd: text('cwd'),
  };
}

/**
 * Ce qui, en changeant, justifie une diffusion : l'identite des questions et leur etat
 * visible. Le texte n'en fait pas partie, il ne change jamais pour une meme question.
 */
export function asksSignature(asks: AskItem[], supported: boolean): string {
  return JSON.stringify([supported, asks.map((a) => [a.id, a.due, a.snoozedUntilMs, a.waiting])]);
}

/**
 * Les questions apparues, au sens d'une notification : visibles maintenant et pas
 * avant. Une question qui revient d'un report en fait partie, c'est tout l'interet du
 * report ; une question repondue puis une autre posee n'en est pas une par hasard,
 * parce que la comparaison porte sur l'identifiant.
 */
export function newlyDue(before: AskItem[], after: AskItem[]): AskItem[] {
  const wasDue = new Set(before.filter((a) => a.due).map((a) => a.id));
  return after.filter((a) => a.due && !wasDue.has(a.id));
}

/** Etat des questions cote daemon : une lecture, deux gestes, une porte de diffusion. */
export class AskBoard {
  private asks: AskItem[] = [];
  private choices: AskSnoozeChoice[] = [];
  private supported = true;
  private signature = '';

  constructor(private readonly ipc: KovaIpc) {}

  snapshot(): AsksResponse {
    return { asks: this.asks, snoozeChoices: this.choices, supported: this.supported };
  }

  get(askId: string): AskItem | undefined {
    return this.asks.find((a) => a.id === askId);
  }

  /** Kova a disparu : la liste est videe et la signature remise a zero, sinon la
   * diffusion suivante recalculerait la meme et ne partirait jamais. */
  reset(): void {
    this.asks = [];
    this.signature = '';
  }

  /**
   * Relit la carte. Rend ce qui a change et les questions a notifier. Ne jette jamais :
   * appelee par un minuteur, elle doit survivre a un Kova qui redemarre.
   */
  async refresh(): Promise<{ changed: boolean; appeared: AskItem[] }> {
    let raw: unknown;
    try {
      const res = await this.ipc.request({ cmd: 'list-asks' });
      if (!res.ok) throw new Error(res.error ?? 'list-asks refused');
      raw = res.data;
    } catch (e) {
      if (e instanceof IpcError && e.code === 'IPC_UNSUPPORTED') {
        const changed = this.supported;
        this.supported = false;
        this.asks = [];
        if (changed) logger.info('questions des agents indisponibles, Kova est anterieur a list-asks');
        return { changed, appeared: [] };
      }
      return { changed: false, appeared: [] };
    }
    const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const list = Array.isArray(data['asks']) ? data['asks'] : [];
    const asks = list.map(mapAsk).filter((a): a is AskItem => a !== null);
    const choices = Array.isArray(data['snooze_choices'])
      ? data['snooze_choices']
          .map((c) => (typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : {}))
          .filter((c) => typeof c['label'] === 'string' && typeof c['seconds'] === 'number')
          .map((c) => ({ label: c['label'] as string, seconds: c['seconds'] as number }))
      : [];
    const before = this.asks;
    this.supported = true;
    this.asks = asks;
    if (choices.length > 0) this.choices = choices;
    const next = asksSignature(asks, true);
    if (next === this.signature) return { changed: false, appeared: [] };
    this.signature = next;
    return { changed: true, appeared: newlyDue(before, asks) };
  }

  /**
   * Repond a une question. `action` doit etre un des boutons de CETTE question : Kova
   * le verifie aussi, et le verifier ici rend une erreur lisible a l'app plutot qu'un
   * 502 relaye. Le texte libre est borne comme celui de la carte.
   */
  async answer(askId: string, action: unknown, text: unknown): Promise<void> {
    const ask = this.requireAsk(askId);
    if (typeof action !== 'string' || !ask.buttons.includes(action)) {
      throw new AskError('BAD_REQUEST', 'action must be one of this question\'s buttons');
    }
    if (text !== undefined && typeof text !== 'string') {
      throw new AskError('BAD_REQUEST', 'text must be a string');
    }
    const body = typeof text === 'string' ? text : '';
    if (Buffer.byteLength(body, 'utf8') > ASK_TEXT_MAX) {
      throw new AskError('BAD_REQUEST', `text is longer than ${ASK_TEXT_MAX} bytes`);
    }
    const res = await this.ipc.request({ cmd: 'answer-ask', id: askId, action, text: body });
    if (!res.ok) throw new AskError('ASK_NOT_FOUND', res.error ?? 'Kova refused the answer');
    // La carte du Mac a change : on ne laisse pas le telephone attendre le sondage.
    await this.refresh();
  }

  /** Remet une question a plus tard. Kova plafonne le delai, il n'est pas refuse. */
  async snooze(askId: string, seconds: unknown): Promise<number> {
    this.requireAsk(askId);
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new AskError('BAD_REQUEST', 'seconds must be a positive number');
    }
    const res = await this.ipc.request({ cmd: 'snooze-ask', id: askId, seconds: Math.round(seconds) });
    if (!res.ok) throw new AskError('ASK_NOT_FOUND', res.error ?? 'Kova refused the snooze');
    const data = (typeof res.data === 'object' && res.data !== null ? res.data : {}) as Record<string, unknown>;
    const until = data['snoozed_until'];
    await this.refresh();
    return typeof until === 'number' ? Math.round(until * 1000) : 0;
  }

  private requireAsk(askId: string): AskItem {
    if (!this.supported) {
      throw new AskError('KOVA_TOO_OLD', 'this Kova does not know about agent questions');
    }
    const ask = this.get(askId);
    if (!ask) throw new AskError('ASK_NOT_FOUND', `no question ${askId}`);
    return ask;
  }
}
