// Verrou de la saisie terminal : logique PURE, testée seule. Taper dans un pane revient à
// exécuter une commande sur le Mac, donc Face ID une fois par pane. Le déverrouillage tient
// tant que la vue Term de ce pane reste ouverte, au premier plan ; tout le reste reverrouille.

/** Pane déverrouillé, `null` quand tout est verrouillé. */
export interface TerminalLock {
  unlockedPane: number | null;
}

export const LOCKED: TerminalLock = { unlockedPane: null };

export function isTerminalUnlocked(lock: TerminalLock, paneId: number): boolean {
  return lock.unlockedPane === paneId;
}

export function unlockPane(paneId: number): TerminalLock {
  return { unlockedPane: paneId };
}

/** Contexte courant de l'écran : un seul écart par rapport au pane déverrouillé et on reverrouille. */
export interface TerminalContext {
  paneId: number;
  termOpen: boolean;
  focused: boolean;
  appActive: boolean;
}

export function nextLock(lock: TerminalLock, ctx: TerminalContext): TerminalLock {
  if (lock.unlockedPane === null) return lock;
  if (!ctx.termOpen || !ctx.focused || !ctx.appActive || ctx.paneId !== lock.unlockedPane) return LOCKED;
  return lock;
}
