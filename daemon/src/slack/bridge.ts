// Pont Slack : etat des commandes en cours. Aucune E/S directe : Slack passe par
// `SlackApi` (bouchonnable), l'ecriture dans le pane par `send` (KeyGate.emitText, le
// meme chemin que l'iPhone), la fin de tour par `onTurnClosed` (TurnEndDetector).
import type { ActionResponse, Pane, Prompt } from '@kovalink/protocol';
import { audit } from '../audit.js';
import { logger } from '../logger.js';
import { finalTurnText, type RawLine } from '../transcript/jsonl.js';
import {
  authorizeEvent,
  Dedupe,
  formatReply,
  formatSessionList,
  formatUnresolved,
  mentionedUserIds,
  originMarker,
  paneMessage,
  parseCommand,
  resolveSession,
  routeEvent,
  slackToPlain,
  type Origin,
  type SlackEnvelope,
} from './logic.js';

/** Ce que le pont demande a Slack. Implementation reelle dans `socket.ts`. */
export interface SlackApi {
  post(channel: string, threadTs: string, text: string): Promise<void>;
  react(channel: string, ts: string, name: string): Promise<void>;
  unreact(channel: string, ts: string, name: string): Promise<void>;
  /** Nom affichable d'un utilisateur, `null` si inconnu. Mis en cache par l'appelant. */
  userName(userId: string): Promise<string | null>;
}

export interface BridgeDeps {
  api: SlackApi;
  /** Jeton de Robin : repondre la ou le bot n'est pas (DM avec quelqu'un). Absent = chemin bot seul. */
  userApi?: SlackApi | null;
  /** `botDm` : DM Robin <-> bot, connu seulement quand `userApi` est actif. */
  identity: { botUserId: string; teamId: string; botDm?: string | null };
  allowedUserId: () => string;
  jobTimeoutMs: () => number;
  panes: () => Pane[];
  pane: (paneId: number) => Pane | undefined;
  /** Relecture de `list-panes` avant de resoudre un nom. */
  refresh: () => Promise<void>;
  /** KeyGate.emitText : le chemin de l'iPhone, gardes comprises. */
  send: (paneId: number, text: string) => Promise<ActionResponse>;
  /** Question en attente sur le pane, si elle est lisible. */
  currentQuestion: (paneId: number) => Promise<string | null>;
  now?: () => number;
}

export const MAX_QUEUE = 5;
/** Au dela, on cesse de suivre un tour : la file ne doit jamais rester bloquee. */
export const HARD_CAP_MS = 6 * 60 * 60_000;

export const REACT = {
  delivered: 'hourglass_flowing_sand',
  queuedBehindWork: 'hourglass',
  done: 'white_check_mark',
  awaiting: 'raising_hand',
  failed: 'x',
} as const;

interface Job {
  paneId: number;
  name: string;
  origin: Origin;
  /** `ts` du message de Robin : c'est lui qui porte les reactions. */
  msgTs: string;
  text: string;
  sentAt: number | null;
  delivered: boolean;
  reaction: string | null;
  lastQuestion: string | null;
  timer: NodeJS.Timeout | null;
  capTimer: NodeJS.Timeout | null;
}

export class SlackBridge {
  private readonly active = new Map<number, Job>();
  private readonly queues = new Map<number, Job[]>();
  private readonly dedupe = new Dedupe();
  private readonly names = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly d: BridgeDeps) {
    this.now = d.now ?? Date.now;
  }

  // --- Entree : un evenement Slack -------------------------------------------

  async handleEnvelope(envelope: SlackEnvelope): Promise<void> {
    const ev = envelope.event;
    if (!ev) return;
    if (!this.dedupe.firstTime([envelope.event_id, ev.channel && ev.ts ? `${ev.channel}:${ev.ts}` : undefined])) {
      logger.debug('slack: evenement deja traite', { eventId: envelope.event_id });
      return;
    }
    const route = routeEvent(ev, {
      botUserId: this.d.identity.botUserId,
      botDm: this.d.userApi ? (this.d.identity.botDm ?? null) : null,
    });
    // Avant l'autorisation : les messages des autres dans les DM de Robin ne sont pas des
    // tentatives, rien a journaliser.
    if (route === null) return;
    const auth = authorizeEvent(envelope, { allowedUserId: this.d.allowedUserId(), teamId: this.d.identity.teamId });
    if (!auth.ok) {
      if (auth.notable) {
        // Jamais le contenu : qui, ou, pourquoi.
        logger.info('slack: mention ignoree', { user: ev.user ?? null, channel: ev.channel ?? null, reason: auth.reason });
        audit({
          deviceId: 'slack',
          action: 'slack.ignored',
          result: 'denied',
          detail: `user=${ev.user ?? '-'} channel=${ev.channel ?? '-'} reason=${auth.reason}`,
        });
      } else {
        logger.debug('slack: evenement ignore', { reason: auth.reason });
      }
      return;
    }
    if (!ev.channel || !ev.ts) return;

    const origin: Origin = { channel: ev.channel, threadTs: ev.thread_ts ?? ev.ts, asUser: route === 'user' };
    const cmd = parseCommand(ev.text ?? '', this.d.identity.botUserId);
    await this.d.refresh().catch(() => undefined);

    if (cmd.kind === 'list') {
      await this.notice(origin, formatSessionList(this.d.panes()));
      return;
    }
    if (cmd.message === '') {
      await this.notice(origin, `Nothing to send to \`${cmd.session}\`. Usage: \`@kova <session> <message>\` or \`@kova list\``);
      return;
    }
    const r = resolveSession(cmd.session, this.d.panes());
    if (!r.ok) {
      await this.notice(origin, formatUnresolved(cmd.session, r));
      return;
    }

    const plain = slackToPlain(cmd.message, await this.resolveNames(cmd.message));
    const job: Job = {
      paneId: r.pane.id,
      name: r.name,
      origin,
      msgTs: ev.ts,
      text: paneMessage(plain, origin),
      sentAt: null,
      delivered: false,
      reaction: null,
      lastQuestion: null,
      timer: null,
      capTimer: null,
    };
    audit({
      deviceId: 'slack',
      action: 'slack.command',
      paneId: r.pane.id,
      result: 'ok',
      detail: `session=${r.name} channel=${origin.channel} ts=${ev.ts} len=${plain.length}`,
    });
    logger.info('slack: commande acceptee', { paneId: r.pane.id, session: r.name, channel: origin.channel, len: plain.length });
    await this.enqueue(job);
  }

  private async resolveNames(text: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of mentionedUserIds(text)) {
      let name = this.names.get(id) ?? null;
      if (name === null) {
        name = await this.d.api.userName(id).catch(() => null);
        if (name) this.names.set(id, name);
      }
      if (name) out.set(id, name);
    }
    return out;
  }

  // --- File par session --------------------------------------------------------

  private async enqueue(job: Job): Promise<void> {
    if (!this.active.has(job.paneId)) {
      await this.start(job);
      return;
    }
    const q = this.queues.get(job.paneId) ?? [];
    if (q.length >= MAX_QUEUE) {
      void this.notice(job.origin, `Queue full for \`${job.name}\` (${MAX_QUEUE} pending). Try again once it is done.`);
      void this.react(job, REACT.failed);
      return;
    }
    q.push(job);
    this.queues.set(job.paneId, q);
  }

  private async start(job: Job): Promise<void> {
    this.active.set(job.paneId, job);
    const pane = this.d.pane(job.paneId);
    if (!pane) return this.fail(job, `Session \`${job.name}\` is gone from Kova.`);
    if (pane.awaiting) {
      await this.notifyAwaiting(job, await this.d.currentQuestion(job.paneId).catch(() => null));
      await this.notice(job.origin, 'Message not delivered. Answer in Kova, then send it again.');
      return this.finish(job);
    }
    const wasWorking = pane.working;
    job.sentAt = this.now();
    let res: ActionResponse;
    try {
      res = await this.d.send(job.paneId, job.text);
    } catch (e) {
      return this.fail(job, `Delivery to \`${job.name}\` failed: ${(e as Error).message}`);
    }
    if (!res.applied) {
      if (res.reason === 'became_awaiting') {
        await this.notifyAwaiting(job, await this.d.currentQuestion(job.paneId).catch(() => null));
        await this.notice(job.origin, 'Message not delivered. Answer in Kova, then send it again.');
        return this.finish(job);
      }
      return this.fail(job, `Delivery to \`${job.name}\` failed: ${res.reason ?? 'unknown reason'}`);
    }
    // La fin de tour a pu arriver pendant l'envoi (tour tres court) : `finish` l'a deja
    // retire, rien a armer.
    if (this.active.get(job.paneId) !== job) return;
    job.delivered = true;
    job.reaction = wasWorking ? REACT.queuedBehindWork : REACT.delivered;
    await this.react(job, job.reaction);
    job.timer = setTimeout(() => {
      job.timer = null;
      void this.notice(job.origin, `Still running on \`${job.name}\`, check Kova. I will reply here when the turn ends.`);
    }, this.d.jobTimeoutMs());
    job.timer.unref?.();
    job.capTimer = setTimeout(() => {
      job.capTimer = null;
      logger.warn('slack: suivi abandonne, tour trop long', { paneId: job.paneId });
      this.finish(job);
    }, HARD_CAP_MS);
    job.capTimer.unref?.();
  }

  private finish(job: Job): void {
    if (job.timer) clearTimeout(job.timer);
    if (job.capTimer) clearTimeout(job.capTimer);
    job.timer = null;
    job.capTimer = null;
    if (this.active.get(job.paneId) !== job) return;
    this.active.delete(job.paneId);
    const q = this.queues.get(job.paneId);
    const next = q?.shift();
    if (q && q.length === 0) this.queues.delete(job.paneId);
    if (next) void this.start(next);
  }

  private async fail(job: Job, message: string): Promise<void> {
    logger.warn('slack: echec de livraison', { paneId: job.paneId });
    await this.notice(job.origin, message);
    if (job.reaction) await this.unreact(job, job.reaction);
    await this.react(job, REACT.failed);
    this.finish(job);
  }

  // --- Sorties de Kova ----------------------------------------------------------

  /** Tour clos (TurnEndDetector, sans seuil de duree). Seuls les tours lances de Slack. */
  async onTurnClosed(pane: Pane, lines: RawLine[]): Promise<void> {
    const job = this.active.get(pane.id);
    if (!job || job.sentAt === null) return;
    const final = finalTurnText(lines);
    const anchorAt = final.anchorTs ? Date.parse(final.anchorTs) : NaN;
    // Tour long (images en base64...) : le message humain sort du tail borne. Si tout le
    // tail est posterieur a l'envoi, le tour ne peut etre que le notre.
    const tailStart = Math.min(...lines.map((l) => (l.timestamp ? Date.parse(l.timestamp) : NaN)).filter(Number.isFinite));
    const ours =
      (final.anchor ?? '').includes(originMarker(job.origin)) ||
      (Number.isFinite(anchorAt) && anchorAt >= job.sentAt - 1_000) ||
      (final.anchor === null && Number.isFinite(tailStart) && tailStart >= job.sentAt - 1_000);
    if (!ours) {
      // Fin du tour d'AVANT (Mac ou iPhone) : notre message est encore en file chez Claude.
      logger.debug('slack: fin de tour etrangere au message slack', { paneId: pane.id });
      return;
    }
    this.finish(job);
    for (const chunk of formatReply(final.text)) await this.post(job.origin, chunk);
    if (job.reaction) await this.unreact(job, job.reaction);
    if (job.lastQuestion !== null) await this.unreact(job, REACT.awaiting);
    await this.react(job, REACT.done);
  }

  /** Question detectee sur un pane : seulement si un message Slack y est en cours. */
  async onPrompt(prompt: Prompt, pane: Pane): Promise<void> {
    const job = this.active.get(pane.id);
    if (!job || !job.delivered) return;
    const question = prompt.state === 'parsed' ? prompt.question : '';
    if (job.lastQuestion === question) return;
    await this.notifyAwaiting(job, question || null);
  }

  onPaneClosed(paneId: number): void {
    const job = this.active.get(paneId);
    const queued = this.queues.get(paneId) ?? [];
    this.queues.delete(paneId);
    for (const q of queued) {
      void this.notice(q.origin, `Session \`${q.name}\` was closed in Kova. Message not delivered.`);
      void this.react(q, REACT.failed);
    }
    if (job) void this.fail(job, `Session \`${job.name}\` was closed in Kova before the turn ended.`);
  }

  private async notifyAwaiting(job: Job, question: string | null): Promise<void> {
    const first = job.lastQuestion === null;
    job.lastQuestion = question ?? '';
    const q = question ? `\n> ${question.replace(/\n/g, '\n> ')}` : '';
    await this.notice(job.origin, `Session \`${job.name}\` is waiting for your input in Kova.${q}`);
    if (first) await this.react(job, REACT.awaiting);
  }

  // --- Slack, sans jamais lever ----------------------------------------------------

  /** Le bot n'est pas dans la conversation : Robin y parle en son nom. */
  private apiFor(o: Origin): SlackApi {
    return o.asUser && this.d.userApi ? this.d.userApi : this.d.api;
  }

  /** La reponse du tour : dans le fil d'origine, au nom de Robin si le bot n'y est pas. */
  private async post(o: Origin, text: string): Promise<void> {
    try {
      await this.apiFor(o).post(o.channel, o.threadTs, text);
    } catch (e) {
      logger.warn('slack: envoi du message en echec', { channel: o.channel, err: (e as Error).message });
    }
  }

  /**
   * Messages du pont (erreurs, liste, attente...). Dans un DM avec quelqu'un, ils ne
   * partent pas au nom de Robin sous les yeux de l'autre : ils vont dans le DM au bot.
   */
  private async notice(o: Origin, text: string): Promise<void> {
    const botDm = this.d.identity.botDm;
    if (!o.asUser || !botDm) return this.post(o, text);
    try {
      await this.d.api.post(botDm, '', `_About your @kova command in a DM:_ ${text}`);
    } catch (e) {
      logger.warn('slack: envoi du message en echec', { channel: botDm, err: (e as Error).message });
    }
  }

  private async react(job: Job, name: string): Promise<void> {
    try {
      await this.apiFor(job.origin).react(job.origin.channel, job.msgTs, name);
    } catch (e) {
      logger.debug('slack: reaction en echec', { name, err: (e as Error).message });
    }
  }

  private async unreact(job: Job, name: string): Promise<void> {
    try {
      await this.apiFor(job.origin).unreact(job.origin.channel, job.msgTs, name);
    } catch (e) {
      logger.debug('slack: retrait de reaction en echec', { name, err: (e as Error).message });
    }
  }

  /** Pour les tests et le diagnostic. */
  pending(paneId: number): { active: boolean; queued: number } {
    return { active: this.active.has(paneId), queued: this.queues.get(paneId)?.length ?? 0 };
  }

  stop(): void {
    for (const job of this.active.values()) {
      if (job.timer) clearTimeout(job.timer);
      if (job.capTimer) clearTimeout(job.capTimer);
    }
  }
}
