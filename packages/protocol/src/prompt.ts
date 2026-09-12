import type { NotificationCategory } from './notifications.js';

export type OptionKind = 'approve' | 'approve_always' | 'reject' | 'neutral';

export interface PromptOption {
  /** Le rang affiche. La position d'un bouton derive de lui, jamais du libelle. */
  index: number;
  label: string;
  kind: OptionKind;
}

/**
 * Etat interactif d'un pane.
 *
 * R2 : union a TROIS etats notifiables, `turn_end`, `parsed`, `unparsable`, plus
 * `none` qui sert au retrait. La discrimination `turn_end` vient du JSONL (tour clos,
 * aucun `tool_use` en attente), jamais du parsing du terminal.
 *
 * `parsed` est produit par le daemon quand l'ecran correspond exactement a la grammaire
 * observee dans `daemon/test/fixtures` (Claude Code 2.1.268). Au moindre ecart :
 * `unparsable`, sans aucun bouton (A6.2). Les trois champs `question`, `detail` et
 * `options` sont exactement ceux qui entrent dans `promptHash`, et rien d'autre de
 * l'ecran n'est affiche a l'utilisateur (C20).
 */
export type Prompt =
  | { state: 'none'; paneId: number }
  | {
      state: 'turn_end';
      paneId: number;
      sessionId: string | null;
      endedAt: string;
      /** Dernier bloc `text` de l'assistant, tronque. Jamais l'`ai-title` (A14). */
      summary: string;
      /** Sous-titre de la banniere, deja formate : `4 min 12 s, 11 outils` (PRD 4.2). */
      subtitle: string;
      toolCount: number;
      durationMs: number | null;
      promptRef: string;
    }
  | {
      state: 'parsed';
      paneId: number;
      awaitingSince: string;
      question: string;
      /**
       * Toutes les lignes du cadre hors filets et conseil : en-tete (`Bash command`),
       * commande, nom de fichier, contenu. Entrent TOUTES dans le hash : c'est le detail
       * qui distingue deux demandes `Bash` consecutives (C20).
       */
      detail: string[];
      /** 2 options ou plus, jamais 3 en dur. */
      options: PromptOption[];
      freeTextAllowed: boolean;
      promptHash: string;
      promptRef: string;
    }
  | {
      state: 'unparsable';
      paneId: number;
      awaitingSince: string;
      /** Repli monospace : les 30 dernieres lignes non vides. */
      rawScreen: string;
      cols: number;
      rows: number;
      promptRef: string;
    };

export type PromptState = Prompt['state'];

/** Longueur maximale du resume porte par un `turn_end` (PRD 4.2). */
export const TURN_END_SUMMARY_MAX = 140;

/**
 * Choix de la categorie de notification, unique dans tout le projet (R1).
 * Au dela de 3 options la banniere retombe sur `KL_AWAITING_BLIND` : 4 options plus
 * `Interrompre` demanderaient 5 actions pour un budget iOS de 4 (C30).
 */
export function categoryForPrompt(prompt: Prompt): NotificationCategory {
  switch (prompt.state) {
    case 'turn_end':
      return 'KL_TURN_END';
    case 'parsed':
      if (prompt.options.length === 2) return 'KL_AWAITING_2';
      if (prompt.options.length === 3) return 'KL_AWAITING_3';
      return 'KL_AWAITING_BLIND';
    case 'unparsable':
    case 'none':
    default:
      return 'KL_AWAITING_BLIND';
  }
}
