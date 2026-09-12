import { EventEmitter } from 'node:events';
import { isPaneContentError, type Pane, type PaneContent, type Prompt } from '@kovalink/protocol';
import type { PaneStore, WorkingTransition } from '../kova/panes.js';
import { logger } from '../logger.js';
import { transcriptPath } from '../paths.js';
import { analyzeTurnEnd } from '../transcript/jsonl.js';
import { readTailLines } from '../transcript/session.js';
import { parsePromptText } from './parser.js';
import type { PromptRefs } from './refs.js';
import { promptFromContent } from './state.js';

/** Le TUI rend le cadre du prompt dans la meme frame que la fin de `working` : 1 s suffit. */
export const PROMPT_DEBOUNCE_MS = 1_000;
/** Re-sondage borne tant qu'une question attend, jamais une boucle de fond (A6.4). */
export const PROMPT_POLL_MS = 2_000;
const PROMPT_POLL_MAX_MS = 10 * 60_000;

export type AwaitingPrompt = Extract<Prompt, { state: 'parsed' | 'unparsable' }>;

interface Poller {
  timer: NodeJS.Timeout;
  startedAt: number;
}

export interface DetectorDeps {
  fresh(paneId: number): Promise<PaneContent | null>;
  invalidate(paneId: number): void;
}

/**
 * Detection d'un prompt de permission, et synthese de `awaiting`.
 *
 * MESURE du 11 septembre 2026 (Kova 1.11, Claude Code 2.1.268, mode de permission par
 * defaut, pane jetable) : un vrai prompt de permission a l'ecran ne leve JAMAIS
 * `pane-status.awaiting`, pane focalise ou non. Seul `pane-working` bascule, `true` au
 * depart de l'agent, `false` a l'instant ou le cadre du prompt s'affiche. Le fichier
 * `~/.claude/sessions/<pid>.json` dit bien `status: "waiting"`, mais Kova ne le relaie
 * pas. Le declencheur de A6.4 n'existe donc pas sur cette machine, et D1 l'avait deja
 * constate pour la fin de tour.
 *
 * DECISION : le declencheur est le FRONT DESCENDANT de `pane-working`, le meme que la fin
 * de tour, suivi d'UNE lecture de `get-pane-content`. Si l'ecran correspond a la
 * grammaire des fixtures, le daemon pose lui meme `awaiting: true` sur le pane, date de
 * l'instant, et emet le prompt `parsed`. Si l'ecran ne parse pas mais que le JSONL montre
 * un `tool_use` sans resultat, une question attend que le parseur ne sait pas lire :
 * `unparsable`, sans aucun bouton (A6.2). Sinon, ce n'est pas un prompt et la detection
 * de fin de tour prend la main.
 *
 * Levee : front montant de `pane-working` (Claude est reparti, donc a recu sa reponse),
 * fermeture du pane, ou re-sondage qui ne trouve plus de question. Le re-sondage est
 * borne a 10 minutes et ne concerne que les panes en attente : jamais une boucle de fond.
 */
export class PromptDetector extends EventEmitter {
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private readonly pollers = new Map<number, Poller>();

  constructor(
    private readonly panes: PaneStore,
    private readonly prompts: DetectorDeps,
    private readonly refs: PromptRefs,
  ) {
    super();
    this.panes.on('working', (t: WorkingTransition) => this.onWorking(t));
    this.panes.on('close', (paneId: number) => this.forget(paneId));
  }

  isAwaiting(paneId: number): boolean {
    return this.panes.isSyntheticAwaiting(paneId);
  }

  private cancel(paneId: number): void {
    const timer = this.timers.get(paneId);
    if (timer) clearTimeout(timer);
    this.timers.delete(paneId);
  }

  private stopPoll(paneId: number): void {
    const p = this.pollers.get(paneId);
    if (p) clearTimeout(p.timer);
    this.pollers.delete(paneId);
  }

  private forget(paneId: number): void {
    this.cancel(paneId);
    this.stopPoll(paneId);
  }

  private onWorking(t: WorkingTransition): void {
    this.cancel(t.paneId);
    if (t.working) {
      // Claude est reparti : s'il attendait une reponse, il l'a recue.
      if (this.panes.isSyntheticAwaiting(t.paneId)) this.resolve(t.paneId, 'working');
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(t.paneId);
      void this.evaluate(t.paneId);
    }, PROMPT_DEBOUNCE_MS);
    timer.unref?.();
    this.timers.set(t.paneId, timer);
  }

  private async evaluate(paneId: number): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane || pane.working || pane.agent !== 'claude') return;
    if (pane.awaiting && !this.panes.isSyntheticAwaiting(paneId)) return; // Kova sait deja

    let pc: PaneContent | null;
    try {
      pc = await this.prompts.fresh(paneId);
    } catch (e) {
      logger.warn('lecture du pane en echec', { paneId, err: (e as Error).message });
      return;
    }
    if (!pc || isPaneContentError(pc)) return;

    const parsed = parsePromptText(pc.text) !== null;
    if (!parsed && !this.hasPendingTool(pane)) return; // fin de tour, ou rien du tout

    const since = new Date().toISOString();
    this.panes.setAwaiting(paneId, true, since, 'daemon');
    this.prompts.invalidate(paneId);
    const prompt = promptFromContent(pc, since, this.refs.mint(paneId, this.sessionOf(pane)));
    if (prompt.state !== 'parsed' && prompt.state !== 'unparsable') return;
    logger.info('question detectee', { paneId, state: prompt.state });
    this.emit('prompt', prompt, this.panes.get(paneId) ?? pane);
    this.startPoll(paneId, prompt);
  }

  private sessionOf(pane: Pane): string | null {
    return pane.agent_session_id ?? pane.claude_session_id;
  }

  /** Un `tool_use` sans `tool_result` dans le JSONL : une permission peut attendre. */
  private hasPendingTool(pane: Pane): boolean {
    const sessionId = this.sessionOf(pane);
    if (!sessionId) return false;
    try {
      return analyzeTurnEnd(readTailLines(transcriptPath(pane.cwd, sessionId))).pendingTools > 0;
    } catch {
      return false;
    }
  }

  private startPoll(paneId: number, last: AwaitingPrompt): void {
    this.stopPoll(paneId);
    this.schedule(paneId, Date.now(), last);
  }

  private schedule(paneId: number, startedAt: number, last: AwaitingPrompt): void {
    const timer = setTimeout(() => void this.poll(paneId, startedAt, last), PROMPT_POLL_MS);
    timer.unref?.();
    this.pollers.set(paneId, { timer, startedAt });
  }

  /** Un tick de re-sondage : relit l'ecran, emet si la question a change, se replanifie. */
  private async poll(paneId: number, startedAt: number, last: AwaitingPrompt): Promise<void> {
    this.pollers.delete(paneId);
    const pane = this.panes.get(paneId);
    if (!pane || !this.panes.isSyntheticAwaiting(paneId)) return;
    if (Date.now() - startedAt > PROMPT_POLL_MAX_MS) return; // borne : on cesse de sonder

    let pc: PaneContent | null = null;
    try {
      pc = await this.prompts.fresh(paneId);
    } catch {
      /* Kova injoignable : on reessaie au tick suivant */
    }
    if (pc && isPaneContentError(pc)) return this.resolve(paneId, 'pane_gone');

    let next = last;
    if (pc) {
      const p = promptFromContent(pc, pane.awaiting_since ?? last.awaitingSince, last.promptRef);
      if (p.state === 'unparsable' && !this.hasPendingTool(pane)) {
        return this.resolve(paneId, 'screen'); // Robin a repondu sur le Mac
      }
      if (p.state === 'parsed' || p.state === 'unparsable') {
        const changed =
          p.state !== last.state ||
          (p.state === 'parsed' && last.state === 'parsed' && p.promptHash !== last.promptHash);
        if (changed) {
          this.prompts.invalidate(paneId);
          this.emit('prompt', p, pane);
        }
        next = p;
      }
    }
    this.schedule(paneId, startedAt, next);
  }

  private resolve(paneId: number, reason: string): void {
    this.stopPoll(paneId);
    this.panes.setAwaiting(paneId, false, null, 'daemon');
    this.prompts.invalidate(paneId);
    this.refs.invalidatePane(paneId);
    logger.info('question resolue', { paneId, reason });
    this.emit('resolved', paneId);
  }

  stop(): void {
    for (const paneId of [...this.timers.keys()]) this.cancel(paneId);
    for (const paneId of [...this.pollers.keys()]) this.stopPoll(paneId);
  }
}
