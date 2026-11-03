// Regroupement et mots d'une routine. Module pur : aucune horloge implicite, aucun état
// React, `now` est toujours passé. C'est ce qui rend les tests fixes.
//
// Les sections sont celles du Mac, dans cet ordre : Needs attention (dernier passage en
// échec et non suspendue), Today, This week, Later, Off. Une routine en échec n'apparait
// que dans Needs attention ; une routine suspendue que dans Off. Une routine manuelle
// (sans `nextRun`) tombe dans Later.
import type { Routine } from '@/protocol';

export type RoutineSectionKey = 'attention' | 'today' | 'week' | 'later' | 'off';

export interface RoutineSection {
  key: RoutineSectionKey;
  routines: Routine[];
}

export type RoutineStatusKind = 'running' | 'never' | 'ok' | 'failed';

export interface RoutineStatus {
  kind: RoutineStatusKind;
  /** Le mot du Mac : `Ok`, `Failed(1)`, `Never`, `Running`. */
  label: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function parse(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Jours calendaires entre deux instants, en heure locale et insensible au changement d'heure. */
function dayDistance(ms: number, now: number): number {
  const a = new Date(ms);
  const b = new Date(now);
  const localDay = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((localDay(a) - localDay(b)) / DAY);
}

/**
 * La prochaine échéance en mots : `19:05` aujourd'hui, `Wed 09:03` dans les sept jours,
 * `9 Nov` au-delà. Une date absente ou illisible ne dit rien.
 */
export function nextWords(iso: string | null, now: number): string {
  const ms = parse(iso);
  if (ms === null) return '';
  const d = new Date(ms);
  const days = dayDistance(ms, now);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days === 0) return time;
  if (days > 0 && days < 7) return `${WEEKDAYS[d.getDay()] ?? ''} ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`;
}

/** Le délai avant l'échéance : `in 20 min`, `in 2 h`, `in 3 d`, `now` quand elle est passée. */
export function inWords(iso: string | null, now: number): string {
  const ms = parse(iso);
  if (ms === null) return '';
  const diff = ms - now;
  if (diff <= 0) return 'now';
  if (diff < HOUR) return `in ${Math.max(1, Math.floor(diff / MINUTE))} min`;
  if (diff < DAY) return `in ${Math.floor(diff / HOUR)} h`;
  return `in ${Math.floor(diff / DAY)} d`;
}

/** L'âge du dernier passage : `just now`, `10 min ago`, `9 h ago`, `2 d ago`. */
export function lastWords(iso: string | null, now: number): string {
  const ms = parse(iso);
  if (ms === null) return '';
  const diff = Math.max(0, now - ms);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  return `${Math.floor(diff / DAY)} d ago`;
}

/** Le mot du dernier passage, sans l'état en cours : `Ok`, `Failed(1)`, `Never`. */
export function lastRunOf(routine: Routine): RoutineStatus {
  if (routine.last === null) return { kind: 'never', label: 'Never' };
  if (routine.last.code === 0) return { kind: 'ok', label: 'Ok' };
  return { kind: 'failed', label: `Failed(${routine.last.code})` };
}

/** L'état d'une routine, dans l'ordre du Mac : un passage en cours prime sur le dernier. */
export function statusOf(routine: Routine): RoutineStatus {
  if (routine.running) return { kind: 'running', label: 'Running' };
  return lastRunOf(routine);
}

/** La section d'une routine : suspendue d'abord, puis échec, puis l'échéance. */
export function sectionOf(routine: Routine, now: number): RoutineSectionKey {
  if (!routine.enabled) return 'off';
  if (routine.last !== null && routine.last.code !== 0) return 'attention';
  if (routine.manual || routine.nextRun === null) return 'later';
  const days = dayDistance(Date.parse(routine.nextRun), now);
  if (days === 0) return 'today';
  if (days > 0 && days < 7) return 'week';
  return 'later';
}

const ORDER: readonly RoutineSectionKey[] = ['attention', 'today', 'week', 'later', 'off'];

/** Les sections non vides, dans l'ordre du Mac ; l'ordre des routines est celui du daemon. */
export function groupRoutines(routines: readonly Routine[], now: number): RoutineSection[] {
  const buckets = new Map<RoutineSectionKey, Routine[]>();
  for (const routine of routines) {
    const key = sectionOf(routine, now);
    const list = buckets.get(key);
    if (list) list.push(routine);
    else buckets.set(key, [routine]);
  }
  return ORDER.flatMap((key) => {
    const items = buckets.get(key);
    return items && items.length > 0 ? [{ key, routines: items }] : [];
  });
}

/** Vrai quand au moins une routine non suspendue a échoué : le point de la barre basse. */
export function needsAttention(routines: readonly Routine[] | null): boolean {
  return (routines ?? []).some((routine) => routine.enabled && routine.last !== null && routine.last.code !== 0);
}
