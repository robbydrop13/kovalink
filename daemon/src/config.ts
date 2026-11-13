import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { paths } from './paths.js';

/**
 * Role de ce Mac. `primary` : le Mac de Robin, tout est ouvert. `secondary` : un Mac de
 * secours en lecture, qui ne pilote ni la file d'attention, ni les routines, ni les
 * agents, et ne demarre pas le pont Slack (`server/roleGuard.ts`, `main.ts`).
 */
export type HostRole = 'primary' | 'secondary';

export interface KovalinkConfig {
  port: number;
  role: HostRole;
  /** Nom MagicDNS servi par `tailscale cert`. Null tant que l'appairage n'a pas eu lieu. */
  tsDns: string | null;
  preventSleep: boolean;
  push: {
    /** Seuil N2 : le pane doit avoir travaille plus de 60 s (C29). */
    minWorkingMsForTurnEnd: number;
    quietHours: boolean;
    onlyValidations: boolean;
    /**
     * Sessions dont les fins de tour et questions detectees sonnent sur le telephone,
     * par `agent_session_name` (ou `claude_session_name`) du pane. Liste vide : toutes.
     * Les cartes `kova ask` et le pont Slack ne passent pas par ce filtre.
     */
    sessions: string[];
  };
  /** Liste noire en ECRITURE. La lecture reste totale (choix de Robin). */
  denyWrite: string[];
  denyWriteRules: string[];
  denyRead: string[];
  /** Pont Slack (`slack/`). Les jetons vivent dans le Trousseau, jamais ici. */
  slack: {
    /** Seul utilisateur Slack dont les messages sont executes. */
    allowedUserId: string;
    /** Apres ce delai sans fin de tour, un seul message « still running » part. */
    jobTimeoutMs: number;
  };
}

export const DEFAULT_CONFIG: KovalinkConfig = {
  port: 8765,
  role: 'primary',
  tsDns: null,
  preventSleep: true,
  push: {
    minWorkingMsForTurnEnd: 60_000,
    quietHours: true,
    onlyValidations: false,
    sessions: ['claap-agent', 'perso-agent'],
  },
  denyWrite: [
    '~/Library/LaunchAgents',
    '~/Library/LaunchDaemons',
    '/Library/LaunchAgents',
    '/Library/LaunchDaemons',
    '/Library/StartupItems',
    '~/.kovalink',
    '~/.ssh',
    '~/.aws',
    '~/.gnupg',
    '~/.config/kova',
    '~/.claude',
    '~/.zshrc',
    '~/.zprofile',
    '~/.zshenv',
    '~/.bashrc',
    '~/.bash_profile',
    '~/.profile',
    '/etc',
    '~/Library/Application Support',
  ],
  denyWriteRules: [
    'segment:.app',
    'segment:.git/hooks',
    'segment:node_modules',
    'name:package.json',
    'mode:executable',
  ],
  denyRead: ['~/.kovalink', '~/Library/Logs/Kova'],
  slack: {
    allowedUserId: 'U01DYDY2WR1',
    jobTimeoutMs: 30 * 60_000,
  },
};

/**
 * Champ absent : `primary`, un fichier d'avant ce champ se comporte exactement comme
 * avant. Valeur inconnue (une faute, ou `satellite`, le mot de `claude-config`) :
 * `secondary`, on ferme plutot que d'ouvrir les gestes du Mac principal par erreur.
 */
function roleOf(raw: unknown): HostRole {
  if (raw === undefined || raw === 'primary') return 'primary';
  return 'secondary';
}

/** Nom court du Mac, le meme que celui du QR d'appairage (`pair.ts`). */
export function hostName(): string {
  return hostname().replace(/\.local$/, '');
}

/** `~` est resolu ici, une fois, jamais dans les comparateurs de chemin. */
export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function loadConfig(): KovalinkConfig {
  const file = paths.config();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<KovalinkConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      role: roleOf(raw.role),
      push: { ...DEFAULT_CONFIG.push, ...(raw.push ?? {}) },
      slack: { ...DEFAULT_CONFIG.slack, ...(raw.slack ?? {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: KovalinkConfig): void {
  const file = paths.config();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}
