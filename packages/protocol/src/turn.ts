import type { PermissionMode } from './pane.js';

/**
 * Resultat d'un appel d'outil.
 *
 * CONTRAT DE RATTACHEMENT, unique dans tout le projet (F1) :
 *
 * - le daemon emet chaque `tool_result` dans un turn SEPARE, de `kind: 'tool_result'`,
 *   exactement comme le JSONL le fait (une ligne `user` dont le contenu n'est que des
 *   `tool_result`). Un turn `assistant` ne contient JAMAIS de bloc `tool_result` ;
 * - chaque resultat porte `toolUseId`, l'identifiant du bloc `tool_use` qu'il clot ;
 * - l'APP fait la jointure, avec `indexToolResults` ci dessous, sur l'ensemble des turns
 *   qu'elle a en memoire. Un turn `tool_result` n'est jamais rendu comme une bulle : il
 *   ne sert qu'a alimenter le bloc d'outil deplie de la bulle assistant precedente.
 *
 * Avant ce contrat, le daemon emettait des turns separes et l'app cherchait les
 * resultats DANS la bulle assistant : chaque outil restait « en cours » pour toujours,
 * et les resultats etaient deverses bruts dans le fil.
 */
export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  isError: boolean;
  preview: string;
  /**
   * Vrai quand l'apercu est tronque. Le JSONL ne reference pas les fichiers de
   * `tool-results/` (V12) : `retrievable` est donc toujours faux, et l'app affiche
   * "resultat complet non recuperable, voir sur le Mac" plutot qu'un bouton mort.
   */
  truncated: boolean;
  retrievable: false;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
  preview: string;
}

export type Block =
  | { type: 'text'; text: string }
  /** Contenu toujours vide et signature opaque : badge replie, aucun texte. */
  | { type: 'thinking' }
  /**
   * Image collee dans un tour utilisateur. Claude Code remplace la ligne de chemin
   * envoyee par l'app par un bloc `image` en base64 et prefixe le texte de `[Image #n]`.
   * Les octets ne sont JAMAIS relayes : seule la presence compte, pour la vignette et
   * pour reconnaitre l'echo d'un message avec piece jointe.
   */
  | { type: 'image'; mediaType: string | null }
  | ToolUseBlock
  | ToolResultBlock;

/** Une bulle. Regroupement par `requestId`, ordre par `apiBlockIndex` (A16, V6). */
export interface Turn {
  id: string;
  /**
   * `tool_result` : turn de jointure, jamais une bulle. Voir `ToolResultBlock`.
   * Ses `blocks` ne contiennent QUE des `tool_result`.
   */
  kind: 'user' | 'assistant' | 'tool_result';
  ts: string;
  seq: number;
  uuids: string[];
  blocks: Block[];
  model?: string;
  stopReason?: string | null;
  /** Repete a l'identique sur chaque ligne d'un groupe : on prend la derniere, on ne somme jamais. */
  usage?: { input: number; output: number; cacheRead: number; cacheCreate: number };
  isSidechain: boolean;
}

/**
 * Jointure `tool_use` -> `tool_result`, la SEULE du projet.
 *
 * Parcourt tous les turns (l'ordre n'importe pas) et indexe chaque resultat par
 * `toolUseId`. Un `tool_use` absent de la table est encore en cours si le pane
 * travaille, sinon il n'a jamais rendu (interruption). Si deux resultats portent le
 * meme identifiant (reprise de session), le dernier dans l'ordre des turns l'emporte.
 */
export function indexToolResults(turns: readonly Turn[]): Map<string, ToolResultBlock> {
  const out = new Map<string, ToolResultBlock>();
  for (const turn of turns) {
    if (turn.kind !== 'tool_result') continue;
    for (const b of turn.blocks) if (b.type === 'tool_result') out.set(b.toolUseId, b);
  }
  return out;
}

export interface SessionMeta {
  sessionId: string;
  paneId: number | null;
  title: string | null;
  cwd: string;
  gitBranch: string | null;
  mode: string | null;
  permissionMode: PermissionMode | null;
  lastSeq: number;
}

/** Valeur unique dans tout le projet (architecture 2.5). */
export const TURNS_INITIAL_LOAD = 200;
export const TURNS_PAGE_SIZE = 100;
