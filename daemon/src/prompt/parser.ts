import type { OptionKind, PromptOption } from '@kovalink/protocol';

/**
 * Grammaire du prompt de permission de Claude Code, OBSERVEE et non inventee.
 *
 * Fixtures : `daemon/test/fixtures/prompt-*.txt`, capturees le 11 septembre 2026 sur
 * Claude Code v2.1.268 en mode de permission par defaut, via `get-pane-content` en
 * `mode: "visible"` (voir le README du dossier). Rendu observe, de haut en bas :
 *
 *   ─────────────────────────────────────    filet de cadre, pleine largeur
 *    Bash command                            en-tete : la nature de l'action
 *    Tip: auto mode handles these prompts    ligne de conseil, PARFOIS presente
 *
 *      echo bonjour > hello.txt              lignes de detail : la commande, sa
 *      Write "bonjour" to hello.txt          description, ou le nom du fichier
 *                                            et son contenu entre filets `╌`
 *    Do you want to proceed?                 la question, termine par `?`
 *    ❯ 1. Yes                                options numerotees a partir de 1,
 *      2. Yes, and always allow ...          consecutives, marqueur `❯` sur la
 *      3. Yes, and switch to auto mode ...   ligne surlignee cote Mac
 *      4. No
 *
 *    Esc to cancel · Tab to amend            pied de cadre, DERNIERE ligne non vide
 *
 * REGLES (A6, C37) : le nombre d'options est variable, jamais 3 en dur. Au moindre
 * ecart avec cette grammaire, le parseur rend `null` et n'invente rien : l'app affiche
 * alors l'etat `unparsable`, sans aucun bouton. Un prompt perime qui resterait visible
 * plus haut dans l'ecran ne parse pas non plus, parce que le pied de cadre doit etre la
 * derniere ligne non vide de l'ecran.
 */

/** Une option : marqueur optionnel, numero, point, libelle. */
const OPTION_RE = /^\s*(❯|>)?\s*(\d{1,2})\.\s+(\S.*?)\s*$/u;
/** Filet du cadre, pleine largeur : le trait plein `─` uniquement. */
const FRAME_RE = /^\s*─{10,}\s*$/u;
/** Tout filet decoratif, cadre compris : le trait plein ou les separateurs internes `╌`. */
const RULE_RE = /^\s*[─╌═┄┈━]{10,}\s*$/u;
/** Pied de cadre du prompt de permission. */
const FOOTER_RE = /^\s*Esc to cancel\b/u;
/** Ligne de conseil, decorative : jamais decisionnelle. */
const TIP_RE = /^\s*Tip:\s/u;
/** Une question se termine par un point d'interrogation. */
const QUESTION_RE = /\?\s*$/u;

/** Borne de sante : au dela, ce n'est pas un prompt de permission. */
export const MAX_OPTIONS = 20;

export interface ParsedPromptCore {
  question: string;
  /** En-tete puis lignes de detail, filets et conseil exclus. Toutes entrent dans le hash. */
  detail: string[];
  options: PromptOption[];
  freeTextAllowed: boolean;
}

/**
 * Heuristique de nature. Elle ne pilote que la teinte et Face ID cote app, jamais la
 * position d'un bouton (design 4.3.1). En cas de doute : `neutral`, qui exige Face ID.
 */
export function classifyOption(label: string): OptionKind {
  const l = label.toLowerCase();
  // Portee qui depasse la question courante : toujours avant le simple `yes`.
  if (
    /don'?t ask again|always allow|switch to auto mode|switch to accept edits|for this session|ne plus (me )?demander/.test(
      l,
    )
  ) {
    return 'approve_always';
  }
  if (/^(yes|oui|allow|autoriser|accept)\b/.test(l)) return 'approve';
  if (/^(no|non|reject|refuser|cancel|annuler)\b/.test(l) || /tell claude what to do/.test(l)) {
    return 'reject';
  }
  return 'neutral';
}

/**
 * Parse le texte visible d'un pane. Rend `null` des que le rendu s'ecarte de la
 * grammaire observee : c'est le comportement attendu, pas une erreur.
 */
export function parsePromptText(text: string): ParsedPromptCore | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const lines = text.split('\n').map((l) => l.replace(/\s+$/u, ''));

  // 1. Le pied de cadre est la DERNIERE ligne non vide de l'ecran.
  let footerAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    if (FOOTER_RE.test(line)) footerAt = i;
    break;
  }
  if (footerAt < 0) return null;

  // 2. Le bloc d'options : lignes contiguës juste au dessus du pied (lignes vides
  //    tolerees entre le bloc et le pied), numerotees consecutivement a partir de 1.
  let i = footerAt - 1;
  while (i >= 0 && (lines[i] ?? '').trim() === '') i--;
  const collected: { n: number; label: string; marked: boolean }[] = [];
  for (; i >= 0; i--) {
    const m = OPTION_RE.exec(lines[i] ?? '');
    if (!m) break;
    collected.push({ n: Number(m[2]), label: m[3] ?? '', marked: m[1] !== undefined });
  }
  collected.reverse();
  if (collected.length < 2 || collected.length > MAX_OPTIONS) return null;
  if (collected.some((o, idx) => o.n !== idx + 1)) return null;
  if (collected.filter((o) => o.marked).length > 1) return null;
  if (collected.some((o) => o.label.length === 0)) return null;
  const firstOptionAt = i + 1;

  // 3. La question : premiere ligne non vide au dessus de l'option 1, termine par `?`.
  let q = firstOptionAt - 1;
  while (q >= 0 && (lines[q] ?? '').trim() === '') q--;
  if (q < 0) return null;
  const question = (lines[q] ?? '').trim();
  if (!QUESTION_RE.test(question) || OPTION_RE.test(question) || RULE_RE.test(question)) {
    return null;
  }

  // 4. Le cadre : du dernier filet pleine largeur au dessus de la question jusqu'a
  //    elle. L'en-tete est la premiere ligne non vide du cadre, obligatoire.
  let top = q - 1;
  while (top >= 0 && !FRAME_RE.test(lines[top] ?? '')) top--;
  if (top < 0) return null;
  const body = lines
    .slice(top + 1, q)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !RULE_RE.test(l) && !TIP_RE.test(l));
  if (body.length === 0) return null;
  if (body.some((l) => OPTION_RE.test(l) || FOOTER_RE.test(l))) return null;

  const options: PromptOption[] = collected.map((o) => ({
    index: o.n,
    label: o.label,
    kind: classifyOption(o.label),
  }));

  return {
    question,
    detail: body,
    options,
    freeTextAllowed: options.some((o) => /tell claude|autre|other/iu.test(o.label)),
  };
}
