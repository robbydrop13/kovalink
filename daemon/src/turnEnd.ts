import { EventEmitter } from 'node:events';
import type { Pane, Prompt } from '@kovalink/protocol';
import type { KovalinkConfig } from './config.js';
import type { PaneStore, WorkingTransition } from './kova/panes.js';
import { logger } from './logger.js';
import { transcriptPath } from './paths.js';
import type { PromptRefs } from './prompt/refs.js';
import { analyzeTurnEnd } from './transcript/jsonl.js';
import { readTailLines } from './transcript/session.js';

/**
 * Anti-rebond : on laisse le JSONL etre ecrit et on verifie que le pane ne repart pas
 * immediatement. Un outil long qui rend la main brievement est ainsi ecarte.
 */
export const DEBOUNCE_MS = 2_000;

export type TurnEndPrompt = Extract<Prompt, { state: 'turn_end' }>;

/** `4 min 12 s`, `42 s`, `1 h 05 min`. Jamais de valeur negative ni de `NaN`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/**
 * Sous-titre de la banniere de fin de tour (PRD 4.2 : `4m 12s, 11 tools`), en anglais.
 * Aucun contenu de conversation n'y figure, seulement des compteurs.
 */
export function formatTurnEndSubtitle(durationMs: number | null, toolCount: number): string {
  const parts: string[] = [];
  if (durationMs !== null && durationMs > 0) parts.push(formatDuration(durationMs));
  parts.push(toolCount === 1 ? '1 tool' : `${toolCount} tools`);
  return parts.join(', ');
}

/**
 * Detection de fin de tour, lot 1 (D1).
 *
 * DECLENCHEUR : le FRONT DESCENDANT de `pane-working`, confirme par le tail du JSONL
 * (tour assistant clos, aucun `tool_use` en attente).
 *
 * `pane-status` ne se declenche jamais sur cette machine et `awaiting` reste `false`
 * partout : mesure de Robin, 5 panes, plusieurs minutes, 0 evenement `pane-status`
 * contre 33 `pane-working`. `awaiting` n'est donc JAMAIS utilise comme declencheur.
 *
 * La double condition elimine les faux positifs d'un outil long qui rend la main
 * brievement : le front descendant seul se leve aussi dans ce cas, le JSONL non.
 */
export class TurnEndDetector extends EventEmitter {
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private readonly debounceMs: number;

  constructor(
    private readonly panes: PaneStore,
    private readonly refs: PromptRefs,
    private readonly cfg: () => KovalinkConfig,
    /** Anti-rebond reglable pour les tests seulement ; la production garde `DEBOUNCE_MS`. */
    options: { debounceMs?: number } = {},
  ) {
    super();
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.panes.on('working', (t: WorkingTransition, pane: Pane) => this.onWorking(t, pane));
    this.panes.on('close', (paneId: number) => this.cancel(paneId));
  }

  private cancel(paneId: number): void {
    const timer = this.timers.get(paneId);
    if (timer) clearTimeout(timer);
    this.timers.delete(paneId);
  }

  private onWorking(t: WorkingTransition, pane: Pane): void {
    if (t.working) {
      // Front montant : on annule un examen en cours, le tour n'etait pas fini.
      this.cancel(t.paneId);
      return;
    }
    this.cancel(t.paneId);
    const timer = setTimeout(() => {
      this.timers.delete(t.paneId);
      this.evaluate(t, pane);
    }, this.debounceMs);
    timer.unref?.();
    this.timers.set(t.paneId, timer);
  }

  private evaluate(t: WorkingTransition, snapshot: Pane): void {
    const pane = this.panes.get(t.paneId) ?? snapshot;
    if (pane.working) return; // reparti pendant l'anti-rebond
    // Une question attend (detectee par `PromptDetector` a 1 s, ou par Kova) : ce front
    // descendant n'est pas une fin de tour, c'est un prompt. Pas de double banniere.
    if (pane.awaiting) return;
    const sessionId = pane.agent_session_id ?? pane.claude_session_id;
    if (pane.agent !== 'claude' || !sessionId) return;

    // Lecture bornee de la fin du JSONL : jamais le fichier entier.
    const lines = readTailLines(transcriptPath(pane.cwd, sessionId));
    const analysis = analyzeTurnEnd(lines);
    if (!analysis.closed) {
      logger.debug('front descendant sans tour clos, ignore', {
        paneId: pane.id,
        stopReason: analysis.stopReason,
      });
      return;
    }

    const cfg = this.cfg();
    // C29 : seuil opposable, le pane doit avoir travaille assez longtemps pour que
    // Robin ait eu le temps de partir. Reglable dans `config.json`.
    if (t.workedMs !== null && t.workedMs < cfg.push.minWorkingMsForTurnEnd) {
      logger.debug('tour trop court pour notifier', { paneId: pane.id, workedMs: t.workedMs });
      return;
    }

    const prompt: TurnEndPrompt = {
      state: 'turn_end',
      paneId: pane.id,
      sessionId,
      endedAt: analysis.lastTs ?? new Date().toISOString(),
      summary: analysis.summary,
      subtitle: formatTurnEndSubtitle(t.workedMs, analysis.toolCount),
      toolCount: analysis.toolCount,
      durationMs: t.workedMs,
      promptRef: this.refs.mint(pane.id, sessionId),
    };
    logger.info('fin de tour detectee', {
      paneId: pane.id,
      toolCount: prompt.toolCount,
      durationMs: prompt.durationMs,
    });
    this.emit('turn-end', prompt, pane);
  }

  stop(): void {
    for (const paneId of [...this.timers.keys()]) this.cancel(paneId);
  }
}
