import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { paths } from './paths.js';

export interface KovalinkConfig {
  port: number;
  /** Nom MagicDNS servi par `tailscale cert`. Null tant que l'appairage n'a pas eu lieu. */
  tsDns: string | null;
  preventSleep: boolean;
  push: {
    /** Seuil N2 : le pane doit avoir travaille plus de 60 s (C29). */
    minWorkingMsForTurnEnd: number;
    quietHours: boolean;
    onlyValidations: boolean;
  };
  /** Liste noire en ECRITURE. La lecture reste totale (choix de Robin). */
  denyWrite: string[];
  denyWriteRules: string[];
  denyRead: string[];
}

export const DEFAULT_CONFIG: KovalinkConfig = {
  port: 8765,
  tsDns: null,
  preventSleep: true,
  push: {
    minWorkingMsForTurnEnd: 60_000,
    quietHours: true,
    onlyValidations: false,
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
};

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
      push: { ...DEFAULT_CONFIG.push, ...(raw.push ?? {}) },
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
