import { createHash } from 'node:crypto';
import {
  isPaneContentError,
  SCREEN_FALLBACK_LINES,
  type PaneContent,
  type PaneScreen,
  type Prompt,
  type PromptOption,
} from '@kovalink/protocol';
import type { KovaIpc } from '../kova/ipc.js';
import { logger } from '../logger.js';
import { parsePromptText } from './parser.js';
import type { PromptRefs } from './refs.js';

/**
 * Canon du `promptHash` (C20). Tout ce qui est affiche a Robin pour qu'il decide entre
 * dans le hash, et rien de ce qui n'y entre pas ne lui est affiche.
 *
 * | Entre dans le hash | Exclu du hash |
 * |---|---|
 * | le prefixe de version `v1` | le marqueur de surlignage `❯` : il suit le curseur du Mac, jamais une entree de la decision (C1) |
 * | la question, NFC, espaces compresses | les filets de cadre et la ligne `Tip:` : decoratifs, retires aussi de `detail` |
 * | TOUTES les lignes de detail, dans l'ordre : en-tete, commande, fichier, contenu | les repetitions d'espaces : le TUI re-wrap quand la largeur change |
 * | les options, index ET libelle, dans l'ordre | tout ce qui est hors du cadre : conversation, barre d'etat, compteurs |
 *
 * Deux demandes `Bash` consecutives partagent question et libelles : seul le detail les
 * distingue, c'est lui qui porte la commande (CA-62, fixtures `prompt-bash-consecutive-*`).
 */
export function hashPrompt(question: string, detail: string[], options: PromptOption[]): string {
  const norm = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim();
  const canon = [
    'v1',
    `Q:${norm(question)}`,
    ...detail.map((d, i) => `D${i}:${norm(d)}`),
    ...options.map((o) => `O${o.index}:${norm(o.label)}`),
  ].join('\n');
  return createHash('sha256').update(canon, 'utf8').digest('base64url');
}

/** Les `SCREEN_FALLBACK_LINES` dernieres lignes non vides, filets de cadre compris. */
function lastLines(text: string, count = SCREEN_FALLBACK_LINES): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .slice(-count);
}

function toScreen(pc: PaneContent, capturedAt = new Date().toISOString()): PaneScreen | null {
  if (isPaneContentError(pc)) return null;
  return {
    paneId: pc.id,
    cols: pc.cols,
    rows: pc.rows,
    lines: lastLines(pc.text),
    cursor: pc.cursor,
    capturedAt,
  };
}

const CACHE_MS = 500;

/**
 * Construit l'etat `parsed` ou `unparsable` a partir d'un contenu de pane deja lu.
 * Fonction pure, sans cache : c'est elle que `answer()` rappelle sur une relecture
 * fraiche, juste avant d'emettre.
 */
export function promptFromContent(pc: PaneContent, awaitingSince: string, promptRef: string): Prompt {
  if (isPaneContentError(pc)) return { state: 'none', paneId: pc.id };
  const core = parsePromptText(pc.text);
  if (core) {
    return {
      state: 'parsed',
      paneId: pc.id,
      awaitingSince,
      question: core.question,
      detail: core.detail,
      options: core.options,
      freeTextAllowed: core.freeTextAllowed,
      promptHash: hashPrompt(core.question, core.detail, core.options),
      promptRef,
    };
  }
  return {
    state: 'unparsable',
    paneId: pc.id,
    awaitingSince,
    rawScreen: lastLines(pc.text).join('\n'),
    cols: pc.cols,
    rows: pc.rows,
    promptRef,
  };
}

/**
 * Etat interactif d'un pane, lu depuis `get-pane-content` en `mode: "visible"`.
 *
 * `parsed` n'est produit que si le rendu correspond exactement a la grammaire observee
 * dans les fixtures (`parser.ts`). Sinon `unparsable` : aucun bouton n'est jamais
 * devine, l'app affiche le repli monospace (A6, C37).
 */
export class PromptState {
  private readonly cache = new Map<number, { at: number; prompt: Prompt }>();

  constructor(
    private readonly ipc: KovaIpc,
    private readonly refs: PromptRefs,
  ) {}

  /** Lecture, avec un cache de 500 ms pour ne pas marteler l'IPC. */
  async current(paneId: number, awaitingSince: string | null): Promise<Prompt> {
    const hit = this.cache.get(paneId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.prompt;
    const prompt = await this.read(paneId, awaitingSince);
    this.cache.set(paneId, { at: Date.now(), prompt });
    return prompt;
  }

  private async read(paneId: number, awaitingSince: string | null): Promise<Prompt> {
    // Un pane qui n'attend RIEN n'a pas de prompt. Sans cette garde, chaque `pane.peek`
    // fabriquait un etat `unparsable` date de maintenant : l'app affichait alors
    // « Validation requise » a l'ouverture de n'importe quelle session, et verrouillait
    // le composer derriere Face ID pour une question qui n'existait pas.
    if (awaitingSince === null) return { state: 'none', paneId };

    let contents: PaneContent[] = [];
    try {
      contents = await this.ipc.getPaneContent([paneId]);
    } catch (e) {
      // La cause remonte au journal : un `none` muet se lit comme « rien n'attend »,
      // ce qui est faux quand l'IPC vient de tomber.
      logger.warn('lecture du pane en echec', { paneId, err: (e as Error).message });
      return { state: 'none', paneId };
    }
    const pc = contents[0];
    // V2 : un pane inexistant renvoie ok:true avec `{error:"not found"}`.
    if (!pc || isPaneContentError(pc)) return { state: 'none', paneId };
    return promptFromContent(pc, awaitingSince, this.refs.mint(paneId, null));
  }

  /**
   * Relecture FRAICHE, sans cache : reservee a `answer()`. Le cache de 500 ms sert
   * aux lectures d'affichage, jamais a la decision d'emettre.
   */
  async fresh(paneId: number): Promise<PaneContent | null> {
    const contents = await this.ipc.getPaneContent([paneId]);
    return contents[0] ?? null;
  }

  async screen(paneId: number): Promise<PaneScreen | null> {
    const contents = await this.ipc.getPaneContent([paneId]);
    const pc = contents[0];
    return pc ? toScreen(pc) : null;
  }

  invalidate(paneId: number): void {
    this.cache.delete(paneId);
  }
}
