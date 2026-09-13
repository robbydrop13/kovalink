// Les commandes `/` de Claude Code, pour l'autocompletion de la barre de message (demande
// du 13 septembre : « comme j'ai sur Claude Code dans le terminal »).
//
// Le terminal les connait parce que Claude Code tourne dedans ; l'app, elle, ne voit que
// le transcript. Le daemon les reconstitue donc depuis le Mac, aux memes endroits que
// Claude Code : les commandes integrees (liste fixe ci-dessous), `~/.claude/commands/*.md`
// et `~/.claude/skills/*/SKILL.md` (utilisateur), les memes dossiers sous `.claude` du
// projet en remontant du `cwd` du pane jusqu'au dossier personnel exclu, et les plugins
// installes (`~/.claude/plugins/installed_plugins.json`), nommes `plugin:commande`.
//
// Lecture pure, jamais d'erreur : un fichier illisible donne une commande de moins. Un
// cache court par `cwd` evite de relire une centaine de fichiers a chaque frappe.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { SlashCommand } from '@kovalink/protocol';

export const COMMANDS_CACHE_MS = 30_000;
/** Plafond de securite par dossier lu : les dossiers de Robin en comptent quelques uns. */
const DIR_MAX = 500;

/** Commandes integrees de Claude Code, telles que le menu du terminal les presente. */
export const BUILTIN_COMMANDS: ReadonlyArray<readonly [name: string, description: string]> = [
  ['add-dir', 'Add a new working directory'],
  ['agents', 'Manage agent configurations'],
  ['artifacts', 'List your published artifacts'],
  ['btw', 'Ask a quick side question without affecting the conversation'],
  ['bug', 'Submit feedback about Claude Code'],
  ['clear', 'Clear conversation history and free up context'],
  ['code-review', 'Review the current branch or a pull request'],
  ['compact', 'Clear conversation history but keep a summary in context'],
  ['config', 'Open config panel'],
  ['context', 'Visualize current context usage'],
  ['cost', 'Show the total cost and duration of the current session'],
  ['diff', 'Review changes in the working tree'],
  ['doctor', 'Diagnose and verify your Claude Code installation'],
  ['exit', 'Exit the REPL'],
  ['export', 'Export the current conversation to a file or clipboard'],
  ['fast', 'Toggle fast mode'],
  ['help', 'Show help and available commands'],
  ['hooks', 'Manage hook configurations'],
  ['ide', 'Manage IDE integrations'],
  ['init', 'Initialize a new CLAUDE.md file with codebase documentation'],
  ['install-github-app', 'Set up Claude GitHub Actions for a repository'],
  ['login', 'Sign in with your Anthropic account'],
  ['logout', 'Sign out from your Anthropic account'],
  ['loop', 'Repeat a task on a schedule'],
  ['mcp', 'Manage MCP servers'],
  ['memory', 'Edit Claude memory files'],
  ['model', 'Set the AI model for Claude Code'],
  ['output-style', 'Set the output style'],
  ['permissions', 'Manage allow and deny tool permission rules'],
  ['plan', 'Switch to plan mode'],
  ['privacy-settings', 'View and update your privacy settings'],
  ['release-notes', 'View release notes'],
  ['rename', 'Rename the current session'],
  ['resume', 'Resume a previous conversation'],
  ['review', 'Review a pull request'],
  ['rewind', 'Restore the code and conversation to a previous point'],
  ['schedule', 'Schedule a recurring task'],
  ['skills', 'List available skills'],
  ['stats', 'Show usage statistics'],
  ['status', 'Show Claude Code status'],
  ['statusline', 'Set up the status line'],
  ['tasks', 'Show background tasks'],
  ['terminal-setup', 'Install Shift+Enter key binding'],
  ['theme', 'Change the color theme'],
  ['todos', 'List current todo items'],
  ['upgrade', 'Upgrade to Max'],
  ['usage', 'Show plan usage limits'],
  ['vim', 'Toggle between Vim and Normal editing modes'],
  ['workflows', 'Show running workflows'],
];

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface Frontmatter {
  name: string | null;
  description: string;
  argumentHint: string | null;
  invocable: boolean;
}

function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

/** L'en-tete YAML d'une commande ou d'un skill : les quatre cles utiles, rien d'autre. */
export function parseFrontmatter(data: string): Frontmatter {
  const out: Frontmatter = { name: null, description: '', argumentHint: null, invocable: true };
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(data);
  if (!m) return out;
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1] ?? '';
    const val = unquote(kv[2] ?? '');
    if (key === 'name' && NAME_RE.test(val)) out.name = val;
    else if (key === 'description') out.description = val;
    else if (key === 'argument-hint' && val.length > 0) out.argumentHint = val;
    else if (key === 'user-invocable' && val === 'false') out.invocable = false;
  }
  return out;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path).slice(0, DIR_MAX).sort();
  } catch {
    return [];
  }
}

/** `commands/*.md`, sous-dossiers compris (`frontend/component.md` donne `frontend:component`). */
function commandsIn(dir: string, prefix: string, source: SlashCommand['source'], out: SlashCommand[]): void {
  const walk = (d: string, ns: string[]): void => {
    for (const entry of listDir(d)) {
      const full = join(d, entry);
      if (isDir(full)) {
        if (ns.length < 3) walk(full, [...ns, entry]);
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      const base = entry.slice(0, -3);
      if (!NAME_RE.test(base)) continue;
      const fm = parseFrontmatter(readText(full) ?? '');
      if (!fm.invocable) continue;
      const name = [...(prefix ? [prefix] : []), ...ns, base].join(':');
      out.push({ name, description: fm.description, argumentHint: fm.argumentHint, source });
    }
  };
  walk(dir, []);
}

/** `skills/<nom>/SKILL.md` : le `name` de l'en-tete sinon le dossier. */
function skillsIn(dir: string, prefix: string, source: SlashCommand['source'], out: SlashCommand[]): void {
  for (const entry of listDir(dir)) {
    const file = join(dir, entry, 'SKILL.md');
    const text = readText(file);
    if (text === null) continue;
    const fm = parseFrontmatter(text);
    if (!fm.invocable) continue;
    const base = fm.name ?? entry;
    if (!NAME_RE.test(base)) continue;
    out.push({ name: prefix ? `${prefix}:${base}` : base, description: fm.description, argumentHint: fm.argumentHint, source });
  }
}

interface InstalledPlugin {
  installPath: string;
  scope: string;
  projectPath: string | null;
}

/** `installed_plugins.json` : nom du plugin (avant le `@`) et ses installations. */
export function parseInstalledPlugins(data: string): Map<string, InstalledPlugin[]> {
  const out = new Map<string, InstalledPlugin[]>();
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return out;
  }
  const plugins = (json as { plugins?: unknown })?.plugins;
  if (!plugins || typeof plugins !== 'object') return out;
  for (const [key, raw] of Object.entries(plugins as Record<string, unknown>)) {
    const name = key.split('@')[0] ?? '';
    if (!NAME_RE.test(name) || !Array.isArray(raw)) continue;
    const list: InstalledPlugin[] = [];
    for (const item of raw) {
      const o = item as Record<string, unknown>;
      if (typeof o?.['installPath'] !== 'string') continue;
      list.push({
        installPath: o['installPath'],
        scope: typeof o['scope'] === 'string' ? o['scope'] : 'user',
        projectPath: typeof o['projectPath'] === 'string' ? o['projectPath'] : null,
      });
    }
    if (list.length > 0) out.set(name, list);
  }
  return out;
}

function within(cwd: string, root: string): boolean {
  const rel = relative(root, cwd);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
}

/** Les dossiers `.claude` du projet : du `cwd` vers la racine, dossier personnel exclu. */
function projectClaudeDirs(cwd: string, home: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(cwd);
  for (let i = 0; i < 32; i++) {
    if (dir === home) break;
    dirs.push(join(dir, '.claude'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** Toutes les commandes visibles depuis `cwd`, sans doublon de nom, integrees en tete. */
export function collectCommands(cwd: string, home = homedir()): SlashCommand[] {
  const found: SlashCommand[] = [];
  for (const [name, description] of BUILTIN_COMMANDS) {
    found.push({ name, description, argumentHint: null, source: 'builtin' });
  }
  // Le projet d'abord, comme Claude Code : une commande de projet masque celle de l'utilisateur.
  for (const dir of projectClaudeDirs(cwd, home)) {
    commandsIn(join(dir, 'commands'), '', 'project', found);
    skillsIn(join(dir, 'skills'), '', 'project', found);
  }
  commandsIn(join(home, '.claude', 'commands'), '', 'user', found);
  skillsIn(join(home, '.claude', 'skills'), '', 'user', found);
  const installed = parseInstalledPlugins(readText(join(home, '.claude', 'plugins', 'installed_plugins.json')) ?? '');
  for (const [plugin, installs] of installed) {
    const install =
      installs.find((i) => i.scope !== 'user' && i.projectPath !== null && within(resolve(cwd), i.projectPath)) ??
      installs.find((i) => i.scope === 'user');
    if (!install) continue;
    commandsIn(join(install.installPath, 'commands'), plugin, 'plugin', found);
    skillsIn(join(install.installPath, 'skills'), plugin, 'plugin', found);
  }
  const seen = new Set<string>();
  const out: SlashCommand[] = [];
  for (const c of found) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
}

const cache = new Map<string, { at: number; commands: SlashCommand[] }>();

/** `collectCommands` avec un cache de 30 s par `cwd`. */
export function listCommands(cwd: string, now = Date.now()): SlashCommand[] {
  const key = resolve(cwd);
  const hit = cache.get(key);
  if (hit && now - hit.at < COMMANDS_CACHE_MS) return hit.commands;
  const commands = collectCommands(key);
  cache.set(key, { at: now, commands });
  return commands;
}

