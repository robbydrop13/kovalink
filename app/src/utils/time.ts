/** Âge court, lisible à une seconde de regard (P4). */
export function shortAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return shortAgeMs(now - t);
}

export function shortAgeMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** Durée d'une tâche, format du design : `4m 12s`, ou `12s` sans minutes. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function clockTime(ts: number | null): string {
  if (ts === null) return '-';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Chemin tronqué en tête, comme dans le sous-titre contextuel de l'écran de session. */
export function truncatePath(path: string, max = 34): string {
  if (path.length <= max) return path;
  return `…${path.slice(path.length - max + 1)}`;
}
