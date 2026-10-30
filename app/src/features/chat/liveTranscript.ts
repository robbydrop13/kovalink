// Dictée en direct : les messages JSON du service de transcription (AssemblyAI) deviennent
// un état pur, sans React ni module natif, testé sous Node.
//
// Un tour (`turn_order`) revient plusieurs fois avant d'être final : chaque message remplace
// le précédent. Une fois `end_of_turn`, il est figé et rangé dans l'ordre. Dans un tour
// encore ouvert, les mots `word_is_final` rejoignent le texte acquis et les autres restent en
// suspens jusqu'à confirmation : c'est ce que la barre affiche en gris. Rien n'est perdu :
// `finalText` reprend aussi le dernier tour ouvert s'il n'a jamais été finalisé.
//
// Aucune propriété de paramètre ni `enum` ici : Node dépouille les types sans transpiler.

/** Un mot reconnu. Le service joint déjà la ponctuation au mot. */
interface LiveWord {
  text: string;
  word_is_final: boolean;
}

/** Un `Turn` du service, réduit à ce que l'interface affiche. */
interface LiveTurn {
  turn_order: number;
  transcript: string;
  end_of_turn: boolean;
  words: LiveWord[];
}

/** État de la dictée : les tours finalisés, triés, et le dernier tour encore ouvert. */
export interface LiveState {
  finals: LiveTurn[];
  partial: LiveTurn | null;
}

/** Ce que la barre affiche : le texte acquis en couleur normale, le reste en gris. */
export interface LiveRender {
  settled: string;
  pending: string;
}

/** Niveau de silence : un RMS nul n'a pas de dB, on le pose à ce plancher. */
export const LEVEL_DB_FLOOR = -120;

export function emptyLiveState(): LiveState {
  return { finals: [], partial: null };
}

function asWords(raw: unknown): LiveWord[] {
  if (!Array.isArray(raw)) return [];
  const words: LiveWord[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const w = item as Record<string, unknown>;
    if (typeof w.text !== 'string' || w.text.length === 0) continue;
    words.push({ text: w.text, word_is_final: w.word_is_final === true });
  }
  return words;
}

/** Un message du service, ou `null` s'il ne porte pas un `Turn` exploitable. */
function asTurn(msg: unknown): LiveTurn | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== 'Turn') return null;
  const order = m.turn_order;
  if (typeof order !== 'number' || !Number.isFinite(order)) return null;
  return {
    turn_order: order,
    transcript: typeof m.transcript === 'string' ? m.transcript : '',
    end_of_turn: m.end_of_turn === true,
    words: asWords(m.words),
  };
}

/**
 * Le message suivant, ou l'état inchangé (même référence) s'il n'apprend rien : `Begin`,
 * `Termination`, un `{error}`, un type inconnu ou un corps illisible sont ignorés.
 *
 * Un `Turn` final remplace le tour de même `turn_order` et efface tout tour ouvert couvert.
 * Un `Turn` ouvert remplace le tour ouvert de même `turn_order`, et un tour plus ancien
 * qu'un tour déjà finalisé ne revient jamais en arrière.
 */
export function applyMessage(state: LiveState, msg: unknown): LiveState {
  const turn = asTurn(msg);
  if (turn === null) return state;
  if (turn.end_of_turn) {
    const finals = state.finals.filter((t) => t.turn_order !== turn.turn_order);
    finals.push(turn);
    finals.sort((a, b) => a.turn_order - b.turn_order);
    const partial = state.partial && state.partial.turn_order > turn.turn_order ? state.partial : null;
    return { finals, partial };
  }
  const lastFinal = state.finals[state.finals.length - 1];
  if (lastFinal && turn.turn_order <= lastFinal.turn_order) return state;
  if (state.partial && turn.turn_order < state.partial.turn_order) return state;
  return { finals: state.finals, partial: turn };
}

function pushText(parts: string[], text: string): void {
  const trimmed = text.trim();
  if (trimmed.length > 0) parts.push(trimmed);
}

/** Le texte affichable : ce qui est acquis, puis ce qui reste ouvert. */
export function render(state: LiveState): LiveRender {
  const parts: string[] = [];
  for (const turn of state.finals) pushText(parts, turn.transcript);
  const partial = state.partial;
  let pending = '';
  if (partial) {
    if (partial.words.length > 0) {
      const acquired: string[] = [];
      const open: string[] = [];
      for (const word of partial.words) {
        (word.word_is_final ? acquired : open).push(word.text);
      }
      pushText(parts, acquired.join(' '));
      pending = open.join(' ').trim();
    } else {
      // Pas de mots : le transcrit du tour est la seule source, et il reste ouvert.
      pending = partial.transcript.trim();
    }
  }
  return { settled: parts.join(' '), pending };
}

/**
 * Le texte à mettre dans le champ : les tours finalisés, puis le dernier tour ouvert s'il
 * n'a jamais été finalisé (un arrêt, une panne de socket). Ses mots non confirmés comptent :
 * mieux vaut une faute que des mots perdus.
 */
export function finalText(state: LiveState): string {
  const parts: string[] = [];
  for (const turn of state.finals) pushText(parts, turn.transcript);
  const partial = state.partial;
  if (partial) {
    // Selon le modèle, `transcript` porte tout le tour ou seulement ses mots confirmés : on
    // garde la version la plus longue en mots.
    const fromWords = partial.words.map((w) => w.text).join(' ');
    const longer = words(fromWords).length > words(partial.transcript).length ? fromWords : partial.transcript;
    pushText(parts, longer);
  }
  return parts.join(' ');
}

/**
 * Niveau d'un tampon PCM 16 bits little endian, en dB (0 = pleine échelle, négatif sinon).
 * Seul le premier canal compte : la dictée est mono, un stéréo éventuel est un reste.
 */
export function levelDb(pcm: ArrayBuffer): number {
  const samples = Math.floor(pcm.byteLength / 2);
  if (samples === 0) return LEVEL_DB_FLOOR;
  const view = new DataView(pcm);
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const s = view.getInt16(i * 2, true);
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples) / 32768;
  if (rms <= 0) return LEVEL_DB_FLOOR;
  return Math.max(LEVEL_DB_FLOOR, 20 * Math.log10(rms));
}

function words(text: string): string[] {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.split(/\s+/) : [];
}

/** Nombre de mots affichables : acquis et en suspens. */
export function wordCount(r: LiveRender): number {
  return words(r.settled).length + words(r.pending).length;
}

/**
 * Les `shown` premiers mots seulement, les acquis d'abord. Le service livre ses mots par
 * paquets d'une seconde environ ; la barre les dévoile un par un pour que la dictée
 * s'écrive au rythme de la voix.
 */
export function reveal(r: LiveRender, shown: number): LiveRender {
  const settled = words(r.settled);
  const pending = words(r.pending);
  if (shown >= settled.length + pending.length) return r;
  if (shown <= settled.length) return { settled: settled.slice(0, Math.max(0, shown)).join(' '), pending: '' };
  return { settled: settled.join(' '), pending: pending.slice(0, shown - settled.length).join(' ') };
}
