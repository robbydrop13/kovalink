import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { expandTilde, type KovalinkConfig } from '../config.js';

export interface DenyDecision {
  allowed: boolean;
  rule?: string;
}

function isUnder(path: string, root: string): boolean {
  if (path === root) return true;
  return path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * `realpath` du chemin, ou de son plus profond ancetre existant avec le reste
 * rejoint tel quel. Un fichier a creer n'existe pas encore, mais le dossier qui le
 * recevra existe : c'est lui qui peut etre un lien vers une racine interdite. `null`
 * si rien n'existe (chemin hors disque), jamais une exception.
 */
function realOrNull(path: string): string | null {
  const tail: string[] = [];
  let head = path;
  for (;;) {
    try {
      return tail.length === 0
        ? realpathSync.native(head)
        : join(realpathSync.native(head), ...tail.reverse());
    } catch {
      const parent = dirname(head);
      if (parent === head) return null;
      tail.push(basename(head));
      head = parent;
    }
  }
}

/**
 * Formes d'un chemin a comparer : telle quelle, et apres resolution des liens quand
 * elle existe et differe. Sur macOS `/etc` est un lien vers `/private/etc` : une regle
 * `/etc` comparee a un chemin deja passe par `realpath` ne matchait jamais (S2). Les
 * DEUX cotes de la comparaison passent desormais par la meme fonction.
 */
function forms(path: string): string[] {
  const real = realOrNull(path);
  return real && real !== path ? [path, real] : [path];
}

interface CompiledRules {
  /** Chaque entree de `denyWrite`, sous toutes ses formes. */
  writeRoots: { entry: string; roots: string[] }[];
  readRoots: { entry: string; roots: string[] }[];
  /** `$HOME` reel, pour la regle structurelle des fichiers caches. */
  homes: string[];
}

/**
 * Les regles sont resolues UNE FOIS par objet de configuration, pas a chaque appel :
 * `realpath` coute un appel systeme par entree et `checkWrite` est appele deux fois
 * par ecriture.
 */
const compiled = new WeakMap<KovalinkConfig, CompiledRules>();

function compile(cfg: KovalinkConfig): CompiledRules {
  const hit = compiled.get(cfg);
  if (hit) return hit;
  const rules: CompiledRules = {
    writeRoots: cfg.denyWrite.map((entry) => ({ entry, roots: forms(expandTilde(entry)) })),
    readRoots: cfg.denyRead.map((entry) => ({ entry, roots: forms(expandTilde(entry)) })),
    homes: forms(homedir()),
  };
  compiled.set(cfg, rules);
  return rules;
}

/**
 * Regle STRUCTURELLE (S1) : sous `$HOME`, tout composant de chemin qui commence par un
 * point est refuse en ecriture. `~/.zlogin`, `~/.config/fish/config.fish`,
 * `~/.hammerspoon/init.lua`, `~/.npmrc`, `~/.vimrc`, `~/.local/bin/x` : tout.
 *
 * Pourquoi une regle et non une liste : les vrais fichiers de Robin ne sont jamais des
 * fichiers caches, et les mecanismes de persistance d'un utilisateur le sont tous. Une
 * enumeration a laisse passer `~/.zlogin` (reproduit par le relecteur). Une famille se
 * ferme par sa forme, pas par ses membres.
 *
 * Renvoie le segment fautif, ou `null`.
 */
function hiddenSegmentUnderHome(path: string, homes: string[]): string | null {
  for (const home of homes) {
    if (!isUnder(path, home)) continue;
    const rel = path.slice(home.length);
    const segment = rel.split(sep).find((s) => s.startsWith('.'));
    if (segment) return segment;
  }
  return null;
}

/**
 * Liste noire en ECRITURE (C5).
 *
 * La lecture reste totale sur tout le disque, c'est le choix de Robin. L'ecriture est
 * refusee sur les mecanismes de demarrage automatique et d'authentification de la
 * machine, par trois familles de regles, dans cet ordre :
 *
 * 1. `denyWrite` : des racines explicites (LaunchAgents, `/etc`, le daemon lui meme...),
 *    comparees sous leur forme demandee ET reelle (`realpath`), des deux cotes ;
 * 2. la regle structurelle : tout composant cache sous `$HOME` (voir
 *    `hiddenSegmentUnderHome`) ;
 * 3. `denyWriteRules` : bundles `.app`, `node_modules`, `package.json`, executables.
 *
 * C'est une REDUCTION DE SURFACE, pas une frontiere de securite. La vraie frontiere
 * reste le jeton, son expiration et sa revocation.
 */
export function checkWrite(rawPath: string, cfg: KovalinkConfig): DenyDecision {
  const rules = compile(cfg);
  const candidates = forms(resolve(rawPath));

  for (const { entry, roots } of rules.writeRoots) {
    for (const path of candidates) {
      if (roots.some((root) => isUnder(path, root))) return { allowed: false, rule: `path:${entry}` };
    }
  }

  for (const path of candidates) {
    const hidden = hiddenSegmentUnderHome(path, rules.homes);
    if (hidden) return { allowed: false, rule: `hidden:${hidden}` };
  }

  const path = candidates[candidates.length - 1] ?? resolve(rawPath);
  const segments = path.split(sep).filter(Boolean);
  for (const rule of cfg.denyWriteRules) {
    if (rule.startsWith('segment:')) {
      const needle = rule.slice('segment:'.length);
      if (needle.includes('/')) {
        // Sequence de segments, par exemple `.git/hooks`.
        const parts = needle.split('/').filter(Boolean);
        for (let i = 0; i + parts.length <= segments.length; i++) {
          if (parts.every((p, j) => segments[i + j] === p)) return { allowed: false, rule };
        }
      } else if (needle.startsWith('.')) {
        // Extension de segment, par exemple tout chemin traversant un `.app`.
        if (segments.some((s) => s.endsWith(needle))) return { allowed: false, rule };
      } else if (segments.includes(needle)) {
        return { allowed: false, rule };
      }
      continue;
    }
    if (rule.startsWith('name:')) {
      if (segments[segments.length - 1] === rule.slice('name:'.length)) {
        return { allowed: false, rule };
      }
      continue;
    }
    if (rule === 'mode:executable') {
      // Un `postinstall` ou un binaire remplace s'executerait au prochain lancement.
      try {
        const st = statSync(path);
        if (st.isFile() && (st.mode & 0o111) !== 0) return { allowed: false, rule };
      } catch {
        // Le fichier n'existe pas encore : rien a refuser au titre de cette regle.
      }
    }
  }

  return { allowed: true };
}

/** Symetrique en lecture : secrets du daemon et `.raw` de Kova (qui sont en 0644). */
export function checkRead(rawPath: string, cfg: KovalinkConfig): DenyDecision {
  const rules = compile(cfg);
  const candidates = forms(resolve(rawPath));
  for (const { entry, roots } of rules.readRoots) {
    for (const path of candidates) {
      if (roots.some((root) => isUnder(path, root))) return { allowed: false, rule: `path:${entry}` };
    }
  }
  return { allowed: true };
}
