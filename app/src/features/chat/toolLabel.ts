// Libellé d'une ligne d'action : verbe, cible, statistiques. Convention de l'app Claude
// (docs/13-chat-lisibilite.md, point 3) : `Reads  app/src/boot.ts`, `Runs  npm test`,
// `Edits  pair.tsx  +12 -3`. Fonction pure, sans React, testée sous Node.
import type { ToolUseBlock } from '@/protocol';
import { t } from '@/i18n/en';

export interface ToolLabel {
  /** Verbe court, à l'indicatif présent. Le nom brut de l'outil si on ne le connaît pas. */
  verb: string;
  /** Chemin, commande ou motif. Vide quand l'outil n'a pas de cible lisible. */
  target: string;
  /** `+12 -3` pour une modification, sinon null. */
  stats: string | null;
}

const VERBS: Record<string, string> = {
  Read: t.toolLabelRead,
  Write: t.toolLabelWrite,
  Edit: t.toolLabelEdit,
  MultiEdit: t.toolLabelEdit,
  NotebookEdit: t.toolLabelEdit,
  Bash: t.toolLabelRun,
  Grep: t.toolLabelSearch,
  Glob: t.toolLabelSearch,
  LS: t.toolLabelList,
  WebFetch: t.toolLabelFetch,
  WebSearch: t.toolLabelLookUp,
  Task: t.toolLabelDelegate,
  Agent: t.toolLabelDelegate,
  TodoWrite: t.toolLabelPlan,
  Skill: t.toolLabelApply,
};

/** Vrai pour les outils qui changent des fichiers : dépliés par défaut, Robin doit voir. */
export function isEditTool(name: string): boolean {
  return name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split('\n').length;
}

/** Chemin raccourci : les trois derniers segments suffisent à reconnaître un fichier. */
export function shortPath(path: string, keep = 3): string {
  const parts = path.split('/').filter((p) => p.length > 0);
  if (parts.length <= keep) return path;
  return parts.slice(-keep).join('/');
}

function firstLine(text: string, max = 80): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function toolLabel(call: Pick<ToolUseBlock, 'name' | 'input' | 'preview'>): ToolLabel {
  const verb = VERBS[call.name] ?? call.name;
  const input = (call.input && typeof call.input === 'object' ? call.input : {}) as Record<string, unknown>;

  const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  switch (call.name) {
    case 'Read':
    case 'Write':
    case 'LS':
    case 'NotebookEdit':
      return { verb, target: path ? shortPath(path) : firstLine(call.preview), stats: null };
    case 'Edit': {
      const oldText = str(input.old_string) ?? '';
      const newText = str(input.new_string) ?? '';
      const stats = oldText || newText ? `+${lineCount(newText)} -${lineCount(oldText)}` : null;
      return { verb, target: path ? shortPath(path) : firstLine(call.preview), stats };
    }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
      let added = 0;
      let removed = 0;
      for (const e of edits) {
        added += lineCount(str(e.new_string) ?? '');
        removed += lineCount(str(e.old_string) ?? '');
      }
      return {
        verb,
        target: path ? shortPath(path) : firstLine(call.preview),
        stats: edits.length > 0 ? `+${added} -${removed}` : null,
      };
    }
    case 'Bash': {
      const cmd = str(input.command);
      return { verb, target: cmd ? firstLine(cmd) : firstLine(call.preview), stats: null };
    }
    case 'Grep':
    case 'WebSearch': {
      const pattern = str(input.pattern) ?? str(input.query);
      return { verb, target: pattern ? `"${firstLine(pattern, 60)}"` : firstLine(call.preview), stats: null };
    }
    case 'Glob': {
      const pattern = str(input.pattern);
      return { verb, target: pattern ?? firstLine(call.preview), stats: null };
    }
    case 'WebFetch': {
      const url = str(input.url);
      return { verb, target: url ? url.replace(/^https?:\/\//, '') : firstLine(call.preview), stats: null };
    }
    case 'Task':
    case 'Agent': {
      const description = str(input.description) ?? str(input.prompt);
      return { verb, target: description ? firstLine(description, 60) : firstLine(call.preview), stats: null };
    }
    default:
      return { verb, target: firstLine(call.preview), stats: null };
  }
}

/** État d'une action, tel que la ligne le montre à droite. */
export type ToolRowState = 'running' | 'done' | 'failed' | 'unknown';

/**
 * `running` seulement si le pane travaille ENCORE et qu'aucun résultat n'est arrivé.
 * Sans résultat et pane à l'arrêt : l'appel n'a jamais rendu (interruption), on n'affirme
 * ni succès ni échec.
 */
export function toolRowState(hasResult: boolean, isError: boolean, working: boolean): ToolRowState {
  if (hasResult) return isError ? 'failed' : 'done';
  return working ? 'running' : 'unknown';
}

/** État agrégé d'un groupe d'actions : le pire cas l'emporte. */
export function groupState(states: readonly ToolRowState[]): ToolRowState {
  if (states.includes('failed')) return 'failed';
  if (states.includes('running')) return 'running';
  if (states.length > 0 && states.every((s) => s === 'done')) return 'done';
  return 'unknown';
}

/** Au delà de ce nombre d'actions, et seulement au delà, un groupe est replié (docs/13, point 9). */
export const GROUP_COLLAPSE_OVER = 5;

/** Vrai quand un groupe de `count` actions consécutives se replie derrière un en-tête. */
export function isCollapsible(count: number): boolean {
  return count > GROUP_COLLAPSE_OVER;
}
