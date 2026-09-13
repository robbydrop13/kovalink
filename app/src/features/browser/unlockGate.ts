// Verrou du miroir : logique PURE, testée seule. Le miroir expose le navigateur connecté
// de Robin, donc Face ID à l'entrée, une fois par session au premier plan : le
// déverrouillage tient dix minutes, et tombe dès que l'app passe en arrière-plan.
export const UNLOCK_TTL_MS = 10 * 60_000;

/** Instant du dernier déverrouillage, `null` quand verrouillé. */
export const gate: { unlockedAt: number | null } = { unlockedAt: null };

export function isUnlocked(unlockedAt: number | null, now: number): boolean {
  return unlockedAt !== null && now - unlockedAt < UNLOCK_TTL_MS;
}

export function lock(): void {
  gate.unlockedAt = null;
}

export function markUnlocked(now: number): void {
  gate.unlockedAt = now;
}
