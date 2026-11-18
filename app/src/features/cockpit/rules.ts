// Le Cockpit en regles pures, celles de Kova (`kova/src/cockpit.rs`, `docs/cockpit.md`) :
// les sections par priorite, le filtre d'espace, la page de 10 cartes, et ce qu'une carte
// montre (bouton principal, liens, icones de tete, zone de reponse). Rien n'est lu d'un
// magasin ni d'une horloge : les tests le prouvent sur des cartes construites a la main.
//
// Un compte est TOUJOURS la longueur de la liste qu'il annonce.
import {
  ATTENTION_UNCERTAIN_WORDS,
  type AttentionEntry,
  type AttentionGesture,
  type AttentionUncertainWord,
} from '@/protocol';
import { attentionAtMs, attentionOpenTarget } from '@/features/asks/attention';
import type { PanelTarget } from '@/features/panel/target';
import { t } from '@/i18n/en';

/** Cartes affichees d'abord, et ajoutees par chaque `Voir plus`. */
export const PAGE_SIZE = 10;

export type CockpitPrio = 1 | 2 | 3;
export type CockpitScope = 'claap' | 'perso';
export type CockpitFilter = 'all' | CockpitScope;

/** La priorite d'une carte : la sienne, sinon `now` 2 et `point` 3 ; `memo` n'est jamais montre. */
export function cockpitPrio(entry: AttentionEntry): CockpitPrio | null {
  if (entry.prio === 1 || entry.prio === 2 || entry.prio === 3) {
    return entry.level === 'memo' ? null : entry.prio;
  }
  if (entry.level === 'now') return 2;
  if (entry.level === 'point') return 3;
  return null;
}

/** L'espace d'une carte : `perso`, sinon Claap (absent compris). */
export function cockpitScope(entry: AttentionEntry): CockpitScope {
  return entry.scope === 'perso' ? 'perso' : 'claap';
}

function byAge(a: AttentionEntry, b: AttentionEntry): number {
  return attentionAtMs(a) - attentionAtMs(b) || a.id.localeCompare(b.id);
}

export interface CockpitSection {
  prio: CockpitPrio;
  name: string;
  /** Toutes les cartes de la section, filtre applique. */
  count: number;
  /** Celles que la page montre. */
  cards: AttentionEntry[];
}

export interface CockpitPage {
  sections: CockpitSection[];
  /** Les cartes que le filtre garde, toutes sections. */
  total: number;
  /** Combien `Voir plus` en cache encore. */
  more: number;
  /** Les comptes du filtre : chacun la longueur de ce qu'il garderait. */
  filterCounts: Record<CockpitFilter, number>;
  /** Les Urgentes que le filtre garde. */
  urgent: number;
}

const SECTION_NAMES: Record<CockpitPrio, string> = {
  1: t.cockpitSectionUrgent,
  2: t.cockpitSectionToday,
  3: t.cockpitSectionWeek,
};

/**
 * La liste, comme `list_html` de Kova : les cartes que le filtre garde, sous leur section,
 * la plus ancienne d'abord (l'identifiant departage) ; les `limit` premieres dans l'ordre
 * des priorites ; une section vide n'apparait pas, et son compte est son compte entier.
 */
export function cockpitPage(entries: readonly AttentionEntry[], filter: CockpitFilter, limit: number): CockpitPage {
  const listed = entries.filter((e) => cockpitPrio(e) !== null);
  const filterCounts: Record<CockpitFilter, number> = {
    all: listed.length,
    claap: listed.filter((e) => cockpitScope(e) === 'claap').length,
    perso: listed.filter((e) => cockpitScope(e) === 'perso').length,
  };
  const kept = listed.filter((e) => filter === 'all' || cockpitScope(e) === filter);
  const max = Math.max(1, limit);
  const sections: CockpitSection[] = [];
  let shown = 0;
  for (const prio of [1, 2, 3] as const) {
    const all = kept.filter((e) => cockpitPrio(e) === prio).sort(byAge);
    if (all.length === 0 || shown >= max) continue;
    const cards = all.slice(0, max - shown);
    shown += cards.length;
    sections.push({ prio, name: SECTION_NAMES[prio], count: all.length, cards });
  }
  return {
    sections,
    total: kept.length,
    more: kept.length - shown,
    filterCounts,
    urgent: kept.filter((e) => cockpitPrio(e) === 1).length,
  };
}

/** `il y a 4 min`, `hier`... comme `cockpit::age` ; vide quand la date ne se lit pas. */
export function cockpitAge(entry: AttentionEntry, nowMs: number): string {
  const at = Date.parse(entry.ts);
  if (!Number.isFinite(at)) return '';
  const secs = Math.max(0, Math.floor((nowMs - at) / 1000));
  if (secs < 60) return t.cockpitAgeNow;
  if (secs < 3600) return t.cockpitAgeMin(Math.floor(secs / 60));
  if (secs < 86_400) return t.cockpitAgeHours(Math.floor(secs / 3600));
  if (secs < 172_800) return t.cockpitAgeYesterday;
  return t.cockpitAgeDays(Math.floor(secs / 86_400));
}

/**
 * L'id de la question `kova ask` qu'une carte nomme (`kova-sheet:<id>` ou `kova-ask:<id>`,
 * prefixe de 6 caracteres au moins), comme `ask_ref` de Kova. `sheet` : une fiche de
 * decisions, a ouvrir dans le panneau.
 */
export function askRefOf(action: string | undefined): { id: string; sheet: boolean } | null {
  const a = action?.trim() ?? '';
  const sheet = a.startsWith('kova-sheet:');
  if (!sheet && !a.startsWith('kova-ask:')) return null;
  const id = a.slice(sheet ? 'kova-sheet:'.length : 'kova-ask:'.length).trim();
  return id.length >= 6 && /^[0-9a-fA-F-]+$/.test(id) ? { id, sheet } : null;
}

/** Ce que `Voir` ouvre dans le panneau, jamais une fiche (`Decider` s'en charge). */
export function cockpitOpenTarget(entry: AttentionEntry): PanelTarget | null {
  return askRefOf(entry.action) === null ? attentionOpenTarget(entry.action) : null;
}

const has = (entry: AttentionEntry, g: AttentionGesture): boolean => (entry.gestures ?? []).includes(g);

/**
 * La carte repond par la zone de reponse : la file y liste des gestes, et elle ne renvoie
 * pas a une fiche (qui se repond dans la fiche). Sans gestes : les anciennes lignes.
 */
export function cockpitZoned(entry: AttentionEntry): boolean {
  return (entry.gestures ?? []).length > 0 && askRefOf(entry.action) === null;
}

/** La carte vient d'un daemon ou d'une file qui ne liste pas encore les gestes. */
export function cockpitLegacy(entry: AttentionEntry): boolean {
  return entry.gestures === undefined && askRefOf(entry.action) === null;
}

/** Un verdict ou une question (pas seulement `Vu` ou `Annuler ma demande`) : `answers`. */
export function cockpitAnswers(entry: AttentionEntry): boolean {
  return has(entry, 'go') || has(entry, 'nogo') || has(entry, 'ask');
}

/** La carte attend le go de Robin sur une action preparee (`expects_validation`). */
export function cockpitValidates(entry: AttentionEntry): boolean {
  const action = entry.action?.trim() ?? '';
  const prepared = action.length > 0 && askRefOf(action) === null;
  return entry.draft === undefined && (entry.kind === 'would' || entry.kind === 'review' || (entry.kind === 'decision' && prepared));
}

/** La carte montre des captures avant et apres. */
export function cockpitHasShots(entry: AttentionEntry): boolean {
  return entry.before !== undefined || entry.after !== undefined;
}

/** La carte attend l'agent : une question de Robin est partie. */
export function cockpitWaitingAgent(entry: AttentionEntry): boolean {
  return entry.waiting === 'agent';
}

/** La zone se montre d'office : un brouillon ou des captures se jugent sur place (`zone_shown`). */
export function cockpitZoneShownFolded(entry: AttentionEntry): boolean {
  return cockpitZoned(entry) && cockpitAnswers(entry) && (entry.draft !== undefined || cockpitHasShots(entry));
}

/** Le bouton principal d'une carte (`primary`), ou aucun. */
export type CockpitPrimary = 'go' | 'decide' | 'test' | 'brief' | 'sheet';

export function cockpitPrimary(entry: AttentionEntry): CockpitPrimary | null {
  if (askRefOf(entry.action) !== null) return 'sheet';
  if (!cockpitZoned(entry)) return null;
  if (entry.draft !== undefined || !cockpitAnswers(entry)) return null;
  if (cockpitValidates(entry) && entry.uncertain === undefined && has(entry, 'go')) return 'go';
  if (entry.kind === 'test') return 'test';
  if (entry.kind === 'blocked' || entry.kind === 'ask' || entry.kind === 'brief') return 'brief';
  if (entry.kind === 'decision') return 'decide';
  return null;
}

/** Les actions de la carte, de gauche a droite (`buttons`) : liens, puis le principal. */
export type CockpitButton = 'open' | AttentionUncertainWord | 'respond' | CockpitPrimary;

export function cockpitButtons(entry: AttentionEntry): CockpitButton[] {
  const out: CockpitButton[] = [];
  if (cockpitOpenTarget(entry) !== null) out.push('open');
  if (!cockpitZoned(entry)) {
    const main = cockpitPrimary(entry);
    if (main !== null) out.push(main);
    return out;
  }
  // Un envoi dont personne ne connait la fin garde ses deux issues.
  if (entry.uncertain !== undefined && (entry.draft !== undefined || cockpitValidates(entry))) {
    out.push(...ATTENTION_UNCERTAIN_WORDS);
  }
  const main = cockpitPrimary(entry);
  if (main === 'go') out.push('respond');
  if (main !== null) out.push(main);
  return out;
}

/** Les icones de tete (`zone_icons`) : l'horloge, puis `Vu`, la croix et la coche offerts. */
export type CockpitIcon = 'snooze' | 'seen' | 'dismiss' | 'done';

/**
 * `Vu` est en tete tant que la zone n'est pas montree ; une fois montree, il est dans sa
 * rangee, a gauche de `No go`. Une carte qui attend l'agent n'a ni `Vu` ni croix : la file
 * ne les liste pas, rien n'est deduit ici.
 */
export function cockpitIcons(entry: AttentionEntry, zoneShown: boolean): CockpitIcon[] {
  const out: CockpitIcon[] = ['snooze'];
  if (has(entry, 'seen') && !(zoneShown && cockpitAnswers(entry))) out.push('seen');
  if (has(entry, 'dismiss')) out.push('dismiss');
  if (has(entry, 'done')) out.push('done');
  return out;
}

/** Les gestes de la rangee de la zone, dans l'ordre de Kova : Vu, No go, Demander, Go. */
export function cockpitZoneGestures(entry: AttentionEntry): AttentionGesture[] {
  if (!cockpitAnswers(entry)) return [];
  return (['seen', 'nogo', 'ask', 'go'] as const).filter((g) => has(entry, g));
}

/** Le mot du bouton Go : celui de la file, sinon `Go, envoyer` sur un brouillon, sinon `Go`. */
export function cockpitGoLabel(entry: AttentionEntry): string {
  return entry.goLabel ?? (entry.draft !== undefined ? t.cockpitGoSend : t.cockpitGo);
}

/** Le brouillon a envoyer avec `go` : le texte de Robin s'il l'a reecrit, sinon rien. */
export function draftToSend(entry: AttentionEntry, edited: string | undefined): string | undefined {
  if (entry.draft === undefined || edited === undefined) return undefined;
  return edited !== entry.draft.text && edited.trim().length > 0 ? edited : undefined;
}

/**
 * L'encre lisible sur une pastille de couleur (`cockpit::ink_on`, luminance WCAG) : quasi
 * noir sur une couleur claire, blanc sur une foncee. Le nom ecrit dit ce qu'est la pastille.
 */
export function inkOn(hex: string): '#111111' | '#FFFFFF' {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1] ?? '000000', 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Le contraste avec le noir l'emporte au dessus de ce seuil.
  return l > 0.179 ? '#111111' : '#FFFFFF';
}

/** L'id complet d'une question a partir du prefixe que nomme la carte, sinon le prefixe tel quel. */
export function resolveAskId(prefix: string, askIds: readonly string[]): string {
  const hits = askIds.filter((id) => id.startsWith(prefix));
  return hits.length === 1 ? (hits[0] ?? prefix) : prefix;
}
