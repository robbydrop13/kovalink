import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.js';

/**
 * Etat courant publie par le daemon, pour que `kovalinkd status` puisse repondre sans
 * ouvrir de canal de controle. Un fichier JSON suffit : un utilisateur, une machine.
 */
export interface RuntimeState {
  pid: number;
  version: string;
  startedAt: string;
  updatedAt: string;
  binds: string[];
  port: number;
  kova: { status: string; pid: number | null };
  tsDns: string | null;
  /** Date d'expiration du certificat TLS, au format ISO. */
  certExpiresAt: string | null;
  /** L'ecoute sur l'adresse Tailscale, sans laquelle le telephone ne joint pas ce Mac. */
  tailnet?: { listening: boolean; since: string | null; backend: string | null };
  /** L'anti-veille : tenue ou non, pourquoi, depuis quand, et l'alimentation lue. */
  sleep?: {
    held: boolean;
    reason: 'ac' | 'agent' | null;
    since: string | null;
    power: 'ac' | 'battery' | 'unknown';
    lid?: 'held' | 'free' | 'unavailable' | 'stuck' | 'unknown';
    /** Reglage `sleep` de macOS en minutes, 0 = jamais. Lu, jamais ecrit par le daemon. */
    systemSleepMin?: number | null;
  };
}

function statePath(): string {
  return join(paths.home(), 'state.json');
}

let current: RuntimeState | null = null;

export function initRuntimeState(seed: Omit<RuntimeState, 'updatedAt'>): void {
  current = { ...seed, updatedAt: new Date().toISOString() };
  flush();
}

export function updateRuntimeState(patch: Partial<RuntimeState>): void {
  if (!current) return;
  current = { ...current, ...patch, updatedAt: new Date().toISOString() };
  flush();
}

function flush(): void {
  if (!current) return;
  try {
    mkdirSync(paths.home(), { recursive: true, mode: 0o700 });
    writeFileSync(statePath(), `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  } catch {
    /* l'etat publie ne doit jamais faire tomber le daemon */
  }
}

export function readRuntimeState(): RuntimeState | null {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as RuntimeState;
  } catch {
    return null;
  }
}

export function clearRuntimeState(): void {
  current = null;
  try {
    unlinkSync(statePath());
  } catch {
    /* deja supprime */
  }
}
