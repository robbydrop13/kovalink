import {
  isPermissionMode,
  TURN_END_SUMMARY_MAX,
  type Block,
  type PermissionMode,
  type Turn,
} from '@kovalink/protocol';

/** Ligne brute du JSONL. 12 types reels observes (V5), la liste n'est pas exhaustive. */
export interface RawLine {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  requestId?: string;
  apiBlockIndex?: number;
  promptId?: string;
  message?: RawMessage;
  toolUseResult?: unknown;
  permissionMode?: string;
  mode?: string;
  subtype?: string;
  durationMs?: number;
  title?: string;
  /** Lignes `attachment` : `queued_command` porte un message de Robin absorbe en cours de tour. */
  attachment?: RawAttachment;
  /**
   * Offset d'octet de la ligne dans le fichier, pose par le lecteur (`tailer`,
   * `readTailLines`). Devient le `seq` du tour : stable d'une lecture a l'autre.
   */
  offset?: number;
  [k: string]: unknown;
}

export interface RawAttachment {
  type?: string;
  prompt?: unknown;
  commandMode?: string;
  origin?: { kind?: string };
  timestamp?: string;
  [k: string]: unknown;
}

export interface RawMessage {
  role?: string;
  model?: string;
  stop_reason?: string | null;
  content?: unknown;
  usage?: Record<string, unknown>;
}

export function safeParseLine(line: string): RawLine | null {
  if (line.trim() === '') return null;
  try {
    const v = JSON.parse(line) as unknown;
    if (!v || typeof v !== 'object') return null;
    const o = v as RawLine;
    return typeof o.type === 'string' ? o : null;
  } catch {
    return null;
  }
}

/** Types ignores en bloc. `queue-operation` en fait partie (C22) : zero message de Robin. */
const IGNORED_TYPES = new Set([
  'queue-operation',
  'last-prompt',
  'atis-latch',
  'bridge-session',
  'file-history-snapshot',
  'system',
]);

function isConversationLine(l: RawLine): boolean {
  return (l.type === 'user' || l.type === 'assistant') && !!l.message;
}

/**
 * Message de Robin ABSORBE EN COURS DE TOUR.
 *
 * Quand Robin ecrit pendant que l'agent travaille, Claude Code n'ecrit AUCUNE ligne
 * `user` : le texte part dans une ligne `attachment` de type `queued_command`, avec
 * `queue-operation remove, reason: absorbed_mid_turn` juste avant. Ignorer les
 * `attachment` en bloc effacait donc ces messages du fil, et la bulle locale de l'app
 * n'avait jamais d'echo a attendre. Les `queued_command` de mode `task-notification`
 * sont des retours de sous-agents, pas des messages de Robin : ils restent ignores.
 */
export function queuedHumanCommand(l: RawLine): RawAttachment | null {
  if (l.type !== 'attachment' || !l.attachment) return null;
  const a = l.attachment;
  if (a.type !== 'queued_command') return null;
  const human = a.origin?.kind === 'human' || a.commandMode === 'prompt';
  return human ? a : null;
}

const PREVIEW_MAX = 400;

/** Apercu generique. AUCUN `switch` exhaustif : un nouvel outil ne doit rien casser. */
function previewOf(value: unknown): { preview: string; truncated: boolean } {
  let s: string;
  if (value === null || value === undefined) s = '';
  else if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else if (Array.isArray(value)) {
    s = value
      .map((v) => {
        if (v && typeof v === 'object' && 'text' in (v as Record<string, unknown>)) {
          return String((v as { text?: unknown }).text ?? '');
        }
        return typeof v === 'string' ? v : JSON.stringify(v);
      })
      .join('\n');
  } else {
    const o = value as Record<string, unknown>;
    const candidates = ['stdout', 'text', 'content', 'output', 'result', 'query'];
    const hit = candidates.find((k) => typeof o[k] === 'string' && (o[k] as string).length > 0);
    s = hit ? (o[hit] as string) : JSON.stringify(o);
  }
  s = s.replace(/\s+$/, '');
  if (s.length <= PREVIEW_MAX) return { preview: s, truncated: false };
  return { preview: `${s.slice(0, PREVIEW_MAX)}...`, truncated: true };
}

function blocksOf(content: unknown): Block[] {
  if (typeof content === 'string') {
    return content.trim() === '' ? [] : [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  const out: Block[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    switch (b['type']) {
      case 'text':
        out.push({ type: 'text', text: String(b['text'] ?? '') });
        break;
      case 'thinking':
      case 'redacted_thinking':
        // Contenu toujours vide et signature opaque : badge replie, aucun texte.
        out.push({ type: 'thinking' });
        break;
      case 'image': {
        // Presence seulement, jamais les octets (plusieurs centaines de Ko par image).
        const source = b['source'] as Record<string, unknown> | undefined;
        const mediaType = typeof source?.['media_type'] === 'string' ? (source['media_type'] as string) : null;
        out.push({ type: 'image', mediaType });
        break;
      }
      case 'tool_use': {
        const { preview } = previewOf(b['input']);
        out.push({
          type: 'tool_use',
          id: String(b['id'] ?? ''),
          name: String(b['name'] ?? 'outil'),
          input: b['input'],
          preview,
        });
        break;
      }
      case 'tool_result': {
        const { preview, truncated } = previewOf(b['content']);
        out.push({
          type: 'tool_result',
          toolUseId: String(b['tool_use_id'] ?? ''),
          isError: b['is_error'] === true,
          preview,
          truncated,
          retrievable: false,
        });
        break;
      }
      default:
        // Type de bloc inconnu : ignore silencieusement, jamais une erreur.
        break;
    }
  }
  return out;
}

function usageOf(u: Record<string, unknown> | undefined): Turn['usage'] {
  if (!u) return undefined;
  const n = (k: string): number => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  return {
    input: n('input_tokens'),
    output: n('output_tokens'),
    cacheRead: n('cache_read_input_tokens'),
    cacheCreate: n('cache_creation_input_tokens'),
  };
}

/**
 * Construit les bulles.
 *
 * - Les lignes `assistant` sont REGROUPEES par `requestId` et ordonnees par
 *   `apiBlockIndex` (A16, V6). Distribution reelle mesuree : 1 a 5 lignes. Aucun code
 *   ici ne suppose un nombre.
 * - `usage` est repete a l'identique sur chaque ligne d'un groupe : on garde la
 *   derniere valeur, on ne somme JAMAIS.
 * - `user.message.content` est soit une string (message de Robin), soit un tableau de
 *   `tool_result` : c'est le discriminant entre humain et retour d'outil.
 * - Tout type inconnu est ignore silencieusement.
 */
export function buildTurns(lines: RawLine[], startSeq = 0): Turn[] {
  const turns: Turn[] = [];
  const byRequest = new Map<string, Turn>();
  let counter = startSeq;
  // Le `seq` est l'OFFSET D'OCTET de la ligne quand le lecteur l'a pose : stable entre
  // deux lectures, quelle que soit la fenetre. Le compteur ne sert qu'aux lignes sans
  // offset (tests, lignes construites en memoire).
  const seqOf = (line: RawLine): number => (typeof line.offset === 'number' ? line.offset : counter++);

  for (const line of lines) {
    if (IGNORED_TYPES.has(line.type)) continue;
    const queued = queuedHumanCommand(line);
    if (queued) {
      const blocks = blocksOf(queued.prompt);
      if (blocks.length === 0) continue;
      const seq = seqOf(line);
      turns.push({
        id: line.uuid ?? `q${seq}`,
        kind: 'user',
        ts: queued.timestamp ?? line.timestamp ?? new Date(0).toISOString(),
        seq,
        uuids: line.uuid ? [line.uuid] : [],
        blocks,
        isSidechain: line.isSidechain === true,
      });
      continue;
    }
    if (!isConversationLine(line)) continue;
    const msg = line.message as RawMessage;

    if (line.type === 'assistant') {
      const key = line.requestId ?? line.uuid ?? `a${counter}`;
      // Contrat F1 (`ToolResultBlock` du protocole) : un turn assistant ne porte JAMAIS
      // de `tool_result`. Ils vivent dans des turns `tool_result` separes, joints par
      // l'app sur `toolUseId`. Le JSONL de Claude ne les met pas la, mais un autre
      // agent pourrait : on l'impose ici plutot que de le supposer.
      const blocks = blocksOf(msg.content).filter((b) => b.type !== 'tool_result');
      const existing = byRequest.get(key);
      if (existing) {
        existing.blocks.push(...blocks);
        if (line.uuid) existing.uuids.push(line.uuid);
        existing.stopReason = msg.stop_reason ?? existing.stopReason;
        existing.usage = usageOf(msg.usage) ?? existing.usage;
        if (line.timestamp) existing.ts = line.timestamp;
        continue;
      }
      const turn: Turn = {
        id: key,
        kind: 'assistant',
        ts: line.timestamp ?? new Date(0).toISOString(),
        seq: seqOf(line),
        uuids: line.uuid ? [line.uuid] : [],
        blocks,
        model: msg.model,
        stopReason: msg.stop_reason ?? null,
        usage: usageOf(msg.usage),
        isSidechain: line.isSidechain === true,
      };
      byRequest.set(key, turn);
      turns.push(turn);
      continue;
    }

    // type === 'user'
    const blocks = blocksOf(msg.content);
    if (blocks.length === 0) continue;
    const isToolResult = blocks.every((b) => b.type === 'tool_result');
    turns.push({
      id: line.uuid ?? `u${counter}`,
      kind: isToolResult ? 'tool_result' : 'user',
      ts: line.timestamp ?? new Date(0).toISOString(),
      seq: seqOf(line),
      uuids: line.uuid ? [line.uuid] : [],
      blocks,
      isSidechain: line.isSidechain === true,
    });
  }

  // Ordre interne d'un groupe assistant : `apiBlockIndex` est deterministe, pas le
  // timestamp (plusieurs lignes partagent la meme milliseconde).
  return turns;
}

/** Trie les lignes `assistant` d'un meme `requestId` par `apiBlockIndex` avant regroupement. */
export function sortAssistantBlocks(lines: RawLine[]): RawLine[] {
  const order = new Map<RawLine, number>();
  lines.forEach((l, i) => order.set(l, i));
  const groups = new Map<string, RawLine[]>();
  for (const l of lines) {
    if (l.type !== 'assistant' || !l.requestId) continue;
    const g = groups.get(l.requestId) ?? [];
    g.push(l);
    groups.set(l.requestId, g);
  }
  for (const [, g] of groups) {
    const positions = g.map((l) => order.get(l) as number).sort((a, b) => a - b);
    const sorted = [...g].sort((a, b) => (a.apiBlockIndex ?? 0) - (b.apiBlockIndex ?? 0));
    sorted.forEach((l, i) => order.set(l, positions[i] as number));
  }
  return [...lines].sort((a, b) => (order.get(a) as number) - (order.get(b) as number));
}

export interface TurnEndAnalysis {
  /** Vrai si le dernier tour assistant est clos et qu'aucun `tool_use` n'attend son resultat. */
  closed: boolean;
  /** Dernier bloc `text` de l'assistant, tronque a 140 caracteres (PRD 4.2). */
  summary: string;
  toolCount: number;
  lastTs: string | null;
  stopReason: string | null;
  /** Nombre de `tool_use` sans `tool_result` : un outil en cours, ou une permission attendue. */
  pendingTools: number;
}

/**
 * Confirmation de fin de tour par le tail du JSONL (D1).
 *
 * Le declencheur est le front descendant de `pane-working`. Cette fonction est la
 * seconde condition : le tour assistant doit etre clos (`stop_reason` different de
 * `tool_use`) ET aucun `tool_use` ne doit attendre son `tool_result`. La double
 * condition elimine les faux positifs d'un outil long qui rend la main brievement.
 */
export function analyzeTurnEnd(lines: RawLine[]): TurnEndAnalysis {
  const conv = sortAssistantBlocks(lines.filter(isConversationLine));
  const pendingToolUse = new Set<string>();
  let toolCount = 0;
  let summary = '';
  let lastTs: string | null = null;
  let stopReason: string | null = null;
  let sawAssistant = false;
  let lastUserPromptAt = -1;

  conv.forEach((line, i) => {
    const blocks = blocksOf((line.message as RawMessage).content);
    if (line.type === 'user') {
      const isHuman = !blocks.every((b) => b.type === 'tool_result');
      if (isHuman) lastUserPromptAt = i;
      for (const b of blocks) if (b.type === 'tool_result') pendingToolUse.delete(b.toolUseId);
      return;
    }
    sawAssistant = true;
    stopReason = (line.message as RawMessage).stop_reason ?? null;
    lastTs = line.timestamp ?? lastTs;
    for (const b of blocks) {
      if (b.type === 'tool_use') {
        pendingToolUse.add(b.id);
        toolCount += 1;
      }
      if (b.type === 'text' && b.text.trim() !== '') summary = b.text.trim();
    }
  });

  // Outils du dernier tour seulement, pour le sous-titre de la notification.
  if (lastUserPromptAt >= 0) {
    toolCount = 0;
    for (const line of conv.slice(lastUserPromptAt + 1)) {
      if (line.type !== 'assistant') continue;
      for (const b of blocksOf((line.message as RawMessage).content)) {
        if (b.type === 'tool_use') toolCount += 1;
      }
    }
  }

  const closed = sawAssistant && stopReason !== 'tool_use' && pendingToolUse.size === 0;
  return {
    closed,
    summary: summary.slice(0, TURN_END_SUMMARY_MAX),
    toolCount,
    lastTs,
    stopReason,
    pendingTools: pendingToolUse.size,
  };
}

/** Derniere valeur `permission-mode` vue, pour le badge `bypass` (A2, V11). */
export function permissionModeOf(lines: RawLine[]): PermissionMode | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l && l.type === 'permission-mode' && isPermissionMode(l.permissionMode)) {
      return l.permissionMode;
    }
  }
  return null;
}

/** Titre de session (`ai-title`). JAMAIS dans une banniere de notification (A14). */
export function aiTitleOf(lines: RawLine[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l && l.type === 'ai-title') {
      const t = (l['title'] ?? l['aiTitle'] ?? l['content']) as unknown;
      if (typeof t === 'string' && t.trim() !== '') return t.trim();
    }
  }
  return null;
}
