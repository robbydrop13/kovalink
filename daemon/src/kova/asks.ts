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
import {
  ASK_TEXT_MAX,
  SHEET_NOTE_MAX,
  type AskItem,
  type AskSheetAnswerResponse,
  type AskSheetResponse,
  type AskSnoozeChoice,
  type AsksResponse,
  type DecisionSheet,
  type SheetAnswersPayload,
  type SheetDraft,
} from '@kovalink/protocol';
import { logger } from '../logger.js';
import { IpcError, mapIpcError, type KovaIpc, type KovaResponse } from './ipc.js';

/**
 * Cadence de relecture de la carte. Kova n'emet aucun evenement quand une question
 * arrive ou qu'elle est repondue sur le Mac : sans sondage, le telephone n'apprendrait
 * rien. Une requete sur une socket Unix locale, quelques centaines d'octets, et 3 s
 * borne le retard d'une notification a ce que personne ne remarque.
 */
export const ASK_POLL_MS = 3_000;

/**
 * Une reponse `ok:false` de Kova, traduite.
 *
 * `KovaIpc.request` RESOUT ces reponses, il ne les rejette pas : seul `expectOk` jette.
 * Les traiter comme une panne quelconque (un `new Error` attrape et ignore) avait un
 * effet mesure sur la machine : le Kova qui tournait ne connaissait pas `list-asks`, il
 * repondait `unknown command`, et `supported` restait vrai pour toujours. Le telephone
 * affichait donc « aucune question » au lieu de « ce Kova ne les connait pas encore ».
 */
function ipcErrorFrom(res: KovaResponse): IpcError {
  return new IpcError(mapIpcError(res.error ?? ''), res.error ?? 'erreur IPC');
}

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
    kind: text('kind'),
    // Meme garde que Kova (`is_panel_url`) : le telephone l'ouvre dans une WebView.
    url: isPanelUrl(r['url']) ? (r['url'] as string) : null,
    sheet: r['sheet'] === true,
  };
}

/** Une URL que le panneau peut ouvrir : http(s), imprimable, 2 Kio au plus. */
export function isPanelUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false;
  const lower = v.toLowerCase();
  const scheme = lower.startsWith('https://') ? 8 : lower.startsWith('http://') ? 7 : 0;
  // eslint-disable-next-line no-control-regex
  return scheme > 0 && v.length > scheme && !/[\s\x00-\x1f\x7f]/.test(v);
}

/**
 * La reponse de `get-sheet`, traduite. La fiche garde ses noms de champs (Kova l'a deja
 * validee, ils sont en un mot) ; seuls l'enveloppe et l'horodatage changent de forme.
 * `null` quand la fiche n'a pas la forme attendue.
 */
export function mapSheet(raw: unknown): AskSheetResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const sheet = r['sheet'] as DecisionSheet | undefined;
  if (typeof r['id'] !== 'string' || typeof sheet !== 'object' || sheet === null) return null;
  if (typeof sheet.title !== 'string' || !Array.isArray(sheet.decisions)) return null;
  // Le telephone rend chaque decision et ses options : une seule mal formee ferait planter
  // l'ecran, elle rend donc la fiche illisible ici, avec une erreur lisible.
  const isText = (v: unknown): boolean => typeof v === 'string';
  for (const d of sheet.decisions as unknown[]) {
    const decision = (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>;
    if (!isText(decision['id']) || !isText(decision['title']) || !Array.isArray(decision['options'])) return null;
    for (const o of decision['options'] as unknown[]) {
      const option = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
      if (!isText(option['id']) || !isText(option['label'])) return null;
      // Une image mal formee est retiree, pas la fiche : les autres restent lisibles.
      if ('images' in option) {
        const images = Array.isArray(option['images']) ? (option['images'] as unknown[]) : [];
        option['images'] = images.flatMap((i) => {
          const img = (typeof i === 'object' && i !== null ? i : {}) as Record<string, unknown>;
          if (!isText(img['path'])) return [];
          return [{ label: isText(img['label']) ? (img['label'] as string) : '', path: img['path'] as string }];
        });
      }
    }
  }
  const draft = (typeof r['draft'] === 'object' && r['draft'] !== null ? r['draft'] : {}) as Partial<SheetDraft>;
  const askedAt = r['asked_at'];
  return {
    id: r['id'],
    from: typeof r['from'] === 'string' ? r['from'] : 'agent',
    message: typeof r['message'] === 'string' ? r['message'] : '',
    askedAtMs: typeof askedAt === 'number' && askedAt > 0 ? Math.round(askedAt * 1000) : 0,
    followUp: r['follow_up'] === true,
    sheet,
    draft: {
      decisions: Array.isArray(draft.decisions) ? draft.decisions : [],
      ...(typeof draft.note === 'string' && draft.note.length > 0 ? { note: draft.note } : {}),
    },
  };
}

/**
 * Les reponses d'une fiche telles que le telephone les envoie, verifiees dans leur
 * FORME seulement : Kova les ramene ensuite a ce que la fiche demande (`answers_from`).
 * Leve `BAD_REQUEST` sur tout le reste, plutot que d'envoyer a Kova un objet qu'il
 * lirait comme « tout effacer ».
 */
export function checkSheetAnswers(raw: unknown): SheetAnswersPayload {
  const bad = (why: string): AskError => new AskError('BAD_REQUEST', `answers: ${why}`);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad('must be an object');
  const r = raw as Record<string, unknown>;
  const decisions = r['decisions'] ?? {};
  if (typeof decisions !== 'object' || decisions === null || Array.isArray(decisions)) {
    throw bad('decisions must be an object keyed by decision id');
  }
  // Sans prototype : un id `__proto__` serait sinon perdu, et la fiche partirait vide.
  const out: SheetAnswersPayload = { decisions: Object.create(null) as SheetAnswersPayload['decisions'] };
  for (const [id, value] of Object.entries(decisions as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) throw bad(`decision ${id} must be an object`);
    const v = value as Record<string, unknown>;
    const entry: { choice?: string; note?: string } = {};
    if (v['choice'] !== undefined && v['choice'] !== null) {
      if (typeof v['choice'] !== 'string') throw bad(`choice of ${id} must be a string`);
      entry.choice = v['choice'];
    }
    if (v['note'] !== undefined && v['note'] !== null) {
      if (typeof v['note'] !== 'string') throw bad(`note of ${id} must be a string`);
      if ([...v['note']].length > SHEET_NOTE_MAX) throw bad(`note of ${id} is longer than ${SHEET_NOTE_MAX} characters`);
      entry.note = v['note'];
    }
    out.decisions[id] = entry;
  }
  const note = r['note'];
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') throw bad('note must be a string');
    if ([...note].length > SHEET_NOTE_MAX) throw bad(`note is longer than ${SHEET_NOTE_MAX} characters`);
    out.note = note;
  }
  return out;
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

/**
 * Un refus de Kova sur un geste, avec sa cause reelle : une commande inconnue est un
 * Kova trop ancien, tout le reste est une question qui n'est plus sur sa carte.
 */
function refusal(res: KovaResponse, fallback: string): AskError {
  const code = mapIpcError(res.error ?? '');
  return new AskError(
    code === 'IPC_UNSUPPORTED' ? 'KOVA_TOO_OLD' : 'ASK_NOT_FOUND',
    res.error ?? fallback,
  );
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
      if (!res.ok) throw ipcErrorFrom(res);
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
    // `Other` avec un texte, c'est le Brief : une consigne libre, acceptee sur toute
    // question (Kova fait la meme regle, `accepts_external_answer`).
    const freeText = action === 'Other' && typeof text === 'string' && text.trim().length > 0;
    if (typeof action !== 'string' || (!ask.buttons.includes(action) && !freeText)) {
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
    if (!res.ok) throw refusal(res, 'Kova refused the answer');
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
    if (!res.ok) throw refusal(res, 'Kova refused the snooze');
    const data = (typeof res.data === 'object' && res.data !== null ? res.data : {}) as Record<string, unknown>;
    const until = data['snoozed_until'];
    await this.refresh();
    return typeof until === 'number' ? Math.round(until * 1000) : 0;
  }

  /** Le contenu d'une fiche native et son brouillon (`get-sheet`). */
  async sheet(askId: string): Promise<AskSheetResponse> {
    this.requireAsk(askId);
    const res = await this.ipc.request({ cmd: 'get-sheet', id: askId });
    if (!res.ok) throw refusal(res, 'Kova refused to read the sheet');
    const sheet = mapSheet(res.data);
    if (!sheet) throw new AskError('ASK_NOT_FOUND', `question ${askId} has no readable sheet`);
    return sheet;
  }

  /**
   * Enregistre les reponses d'une fiche (`answer-sheet`). `done` repond a la question ;
   * sinon c'est un brouillon, garde par Kova avec la question. L'etat ENTIER part a
   * chaque fois : il remplace le brouillon.
   */
  async answerSheet(askId: string, answers: unknown, done: unknown): Promise<AskSheetAnswerResponse> {
    this.requireAsk(askId);
    if (typeof done !== 'boolean') throw new AskError('BAD_REQUEST', 'done must be a boolean');
    const checked = checkSheetAnswers(answers);
    const res = await this.ipc.request({ cmd: 'answer-sheet', id: askId, answers: checked, done });
    if (!res.ok) throw refusal(res, 'Kova refused the sheet answers');
    const d = (typeof res.data === 'object' && res.data !== null ? res.data : {}) as Record<string, unknown>;
    if (done) await this.refresh();
    return {
      title: typeof d['title'] === 'string' ? d['title'] : '',
      summary: typeof d['summary'] === 'string' ? d['summary'] : '',
      answered: typeof d['answered'] === 'number' ? d['answered'] : 0,
      total: typeof d['total'] === 'number' ? d['total'] : 0,
      done: d['done'] === true,
      followUp: typeof d['follow_up'] === 'string' ? d['follow_up'] : null,
    };
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
