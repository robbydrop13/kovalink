import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Racine d'etat du daemon. Surchargeable par `KOVALINK_HOME` (tests, launchd). */
function kovalinkHome(): string {
  return resolve(process.env['KOVALINK_HOME'] ?? join(homedir(), '.kovalink'));
}

export const paths = {
  home: kovalinkHome,
  config: () => join(kovalinkHome(), 'config.json'),
  devices: () => join(kovalinkHome(), 'devices.json'),
  logsDir: () => join(kovalinkHome(), 'logs'),
  logFile: () => join(kovalinkHome(), 'logs', 'kovalinkd.log'),
  auditDir: () => join(kovalinkHome(), 'audit'),
  certDir: () => join(kovalinkHome(), 'cert'),
  certFile: () => join(kovalinkHome(), 'cert', 'server.crt'),
  keyFile: () => join(kovalinkHome(), 'cert', 'server.key'),
  /** Transcripts Claude Code. Surchargeable pour les tests. */
  claudeProjects: () =>
    resolve(process.env['KOVALINK_CLAUDE_PROJECTS'] ?? join(homedir(), '.claude', 'projects')),
};

/**
 * Slug d'un `cwd` vers le dossier de projet Claude Code : chaque caractere qui n'est
 * ni alphanumerique, ni `.`, ni `_` devient `-`. Verifie sur la machine de Robin avec
 * un cwd contenant une espace.
 */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9._]/g, '-');
}

/**
 * Sessions deja retrouvees hors de leur dossier slugifie. L'id est unique et un
 * transcript ne se redeplace pas, donc un succes se garde pour la vie du daemon.
 */
const movedProjects = new Map<string, string>();

/**
 * Un dossier de projet deplace sur le disque (`~/AI directory/Claap/Product/kova`
 * devenu `.../personal-tools/kova`) laisse son transcript dans le dossier slugifie
 * d'origine : Claude Code ecrit jusqu'au bout dans celui qu'il a ouvert au demarrage,
 * tandis que le cwd du pane slugifie desormais ailleurs. Le chemin calcule ne pointe
 * alors sur rien et l'app affiche une session vide, sans la moindre erreur. L'id de
 * session etant unique, on le retrouve par balayage des dossiers de projet.
 */
function movedTranscript(root: string, sessionId: string): string | null {
  const known = movedProjects.get(sessionId);
  if (known) return known;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) {
      movedProjects.set(sessionId, candidate);
      return candidate;
    }
  }
  return null;
}

export function transcriptPath(cwd: string, sessionId: string): string {
  const root = paths.claudeProjects();
  const own = join(root, projectSlug(cwd), `${sessionId}.jsonl`);
  // Le chemin slugifie fait foi, y compris quand le fichier n'existe pas encore : le
  // tailer sonde jusqu'a la naissance du transcript d'une session qui demarre.
  if (existsSync(own)) return own;
  return movedTranscript(root, sessionId) ?? own;
}
