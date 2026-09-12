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

export function transcriptPath(cwd: string, sessionId: string): string {
  return join(paths.claudeProjects(), projectSlug(cwd), `${sessionId}.jsonl`);
}
