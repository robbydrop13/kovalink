// Autocomplétion des commandes `/` dans la barre de message (13 septembre) : la même
// aide que le menu de Claude Code dans le terminal. Décision pure, testée : quand
// proposer, quoi proposer, dans quel ordre, et ce que donne un choix.
import type { SlashCommand } from '@/protocol';

export const SUGGESTIONS_MAX = 8;

/**
 * La requête de complétion, ou `null` quand il n'y a rien à proposer : le champ doit
 * commencer par `/` et ne contenir qu'un seul mot, sans espace ni retour. Dès que la
 * commande est suivie d'un espace, l'utilisateur écrit ses arguments : on se retire.
 */
export function slashQuery(text: string): string | null {
  const m = /^\/([A-Za-z0-9._:-]*)$/.exec(text);
  return m ? (m[1] ?? '').toLowerCase() : null;
}

/**
 * Les commandes à proposer : celles dont le nom commence par la requête, puis celles qui
 * la contiennent (nom ou espace de noms), dans l'ordre reçu du daemon, plafonnées.
 * Une requête vide propose le début de la liste.
 */
export function matchCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const starts: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) starts.push(c);
    else if (q.length > 0 && name.includes(q)) contains.push(c);
    if (starts.length >= SUGGESTIONS_MAX) break;
  }
  return [...starts, ...contains].slice(0, SUGGESTIONS_MAX);
}

/** Le texte du champ après un choix : la commande, puis un espace pour les arguments. */
export function applyCommand(command: Pick<SlashCommand, 'name'>): string {
  return `/${command.name} `;
}

/** `(user)`, `(project)`, `(plugin)` comme dans le terminal ; rien pour une intégrée. */
export function sourceTag(source: SlashCommand['source']): string | null {
  return source === 'builtin' ? null : source;
}
