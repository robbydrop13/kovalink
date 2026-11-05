/**
 * Ce qui attend Robin, dans l'ordre ou `Cmd+J` le parcourt : un tour mort sur une
 * erreur de fournisseur, une routine planifiee dont le dernier run a echoue, une
 * question de permission, une question `kova ask` ouverte, une entree de la file
 * d'attention (`attn`) de niveau `now`.
 *
 * PORTAGE de `kova/src/window/needs.rs`. La forme d'entree garde les noms snake_case
 * des structs Rust, pour que `test/fixtures/waits_on_you.json` (copie de celle de
 * Kova) se lise sans traduction. La fixture de Kova est la declaration partagee de
 * l'ordre : les deux implementations doivent rendre la meme liste, dans le meme ordre.
 *
 * `waitsOnYou` est plus etroit que `needItems` a dessein : il ne compte que ce qu'un
 * humain doit repondre, un prompt de permission, une question ouverte et une entree
 * d'attention `now`. Une erreur et
 * une routine en echec sont des need items pour que Next les parcoure, mais elles
 * n'attendent pas une reponse : le tour ou le run est simplement fini.
 */

/**
 * Le type d'un element. L'ordre de declaration est le tie-break a `since` egal, et
 * l'ordre dans lequel les groupes sont poses.
 */
export type NeedKind = 'error' | 'failed_routine' | 'permission' | 'ask' | 'attention';

const KIND_RANK: Record<NeedKind, number> = {
  error: 0,
  failed_routine: 1,
  permission: 2,
  ask: 3,
  attention: 4,
};

/** Un element tel que la barre laterale et Next le voient. */
export interface NeedItem {
  kind: NeedKind;
  /** Stable d'un tick a l'autre : `pane:12`, `routine:<name>`, `ask:<id>`, `attention:<id>`. */
  key: string;
  /** Le pane ou atterrir quand il y en a un ; une routine en echec n'en a pas. */
  pane_id: number | null;
  /** Secondes epoch depuis lesquelles il attend : le plus ancien est le plus urgent. */
  since: number;
  /** Ce que dit la ligne : le titre du pane, le nom de la routine, la question. */
  title: string;
  /** La seconde ligne : les mots du fournisseur, la commande, le reste d'une question. */
  detail: string;
}

/** Ce qu'un pane attend, s'il attend quelque chose. */
export interface PaneNeed {
  id: number;
  error_since?: number | null;
  permission_since?: number | null;
  title: string;
  /**
   * Le texte de l'erreur, ou le detail du prompt de permission (la commande, le
   * fichier). Absent chez un Kova plus ancien et dans la fixture partagee.
   */
  detail?: string | null;
}

/** Le dernier run d'une routine planifiee, s'il a echoue. */
export interface RoutineNeed {
  name: string;
  failed_at?: number | null;
  /** Eteinte volontairement : un echec d'avant ne compte pas. */
  paused?: boolean;
}

/** Une question `kova ask`, telle que le tableau de Kova la rapporte. */
export interface AskNeed {
  id: string;
  pane_id?: number | null;
  created_at: number;
  /** `null` quand elle n'a jamais ete remise a plus tard ; une question reportee a `now` ou avant revient. */
  snoozed_until?: number | null;
  answered?: boolean;
  title: string;
  /** Ce que la question dit apres sa premiere ligne. */
  detail?: string | null;
}

/**
 * Une entree de la file d'attention. Seul le niveau `now` est un need : `point` et
 * `memo` attendent un coup d'oeil plus tard, l'ecran des questions les liste a part.
 */
export interface AttentionNeed {
  id: string;
  /** Secondes epoch de l'ajout de l'entree. */
  since: number;
  level: string;
  title: string;
}

/** Tout ce que le modele doit savoir, a une seule lecture d'horloge. */
export interface NeedInput {
  panes?: PaneNeed[];
  routines?: RoutineNeed[];
  asks?: AskNeed[];
  attention?: AttentionNeed[];
  now: number;
}

function sinceOf(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Une question attend encore : sans reponse, et pas reportee au dela de `now`.
 * Un report expire la ramene la ou elle etait.
 */
function isOpen(ask: AskNeed, now: number): boolean {
  if (ask.answered === true) return false;
  const until = sinceOf(ask.snoozed_until);
  return until === null || until <= now;
}

/** Le plus ancien d'abord, puis le type, puis la cle : un ordre total, stable d'un tick a l'autre. */
function byAge(a: NeedItem, b: NeedItem): number {
  if (a.since !== b.since) return a.since - b.since;
  if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Les elements d'un type portes par un pane, dans aucun ordre particulier. */
function paneItems(
  panes: readonly PaneNeed[],
  kind: NeedKind,
  sinceOfPane: (pane: PaneNeed) => number | null,
): NeedItem[] {
  const out: NeedItem[] = [];
  for (const pane of panes) {
    const since = sinceOfPane(pane);
    if (since === null) continue;
    out.push({
      kind,
      key: `pane:${pane.id}`,
      pane_id: pane.id,
      since,
      title: pane.title,
      detail: pane.detail ?? '',
    });
  }
  return out;
}

/**
 * Tous les need items, dans l'ordre ou `Next` les parcourt : erreurs du plus ancien au
 * plus recent, puis routines en echec, puis prompts de permission, questions ouvertes et
 * entrees d'attention `now` melanges par age. Une entree d'attention n'a pas de pane :
 * elle ne se replie sur rien.
 *
 * Un pane qui porte a la fois un prompt de permission et une question ouverte est UNE
 * chose a traiter, pas deux : seul le plus ancien des deux est garde, et la question
 * gagne a egalite. Un pane qui porte une erreur et une question garde les deux : deux
 * problemes differents, l'un termine le tour, l'autre le bloque.
 */
export function needItems(input: NeedInput): NeedItem[] {
  const panes = input.panes ?? [];
  const errors = paneItems(panes, 'error', (pane) => sinceOf(pane.error_since)).sort(byAge);

  const routines = (input.routines ?? [])
    .filter((routine) => routine.paused !== true)
    .flatMap((routine): NeedItem[] => {
      const since = sinceOf(routine.failed_at);
      if (since === null) return [];
      return [
        {
          kind: 'failed_routine',
          key: `routine:${routine.name}`,
          pane_id: null,
          since,
          title: routine.name,
          detail: 'Routine failed',
        },
      ];
    })
    .sort(byAge);

  const asks = (input.asks ?? [])
    .filter((ask) => isOpen(ask, input.now))
    .map((ask): NeedItem => ({
      kind: 'ask',
      detail: ask.detail ?? '',
      key: `ask:${ask.id}`,
      pane_id: ask.pane_id ?? null,
      since: ask.created_at,
      title: ask.title,
    }));
  const permissions = paneItems(panes, 'permission', (pane) => sinceOf(pane.permission_since));

  // Un pane, une chose : sa plus ancienne question ouverte et son prompt de permission
  // se replient sur celui qui est apparu en premier.
  const keepAsk = asks.map(() => true);
  const keepPermission = permissions.map(() => true);
  permissions.forEach((permission, pi) => {
    const paneId = permission.pane_id;
    if (paneId === null) return;
    let oldest = -1;
    asks.forEach((ask, ai) => {
      if (!keepAsk[ai] || ask.pane_id !== paneId) return;
      if (oldest === -1 || ask.since < asks[oldest]!.since) oldest = ai;
    });
    if (oldest === -1) return;
    if (asks[oldest]!.since <= permission.since) keepPermission[pi] = false;
    else keepAsk[oldest] = false;
  });

  const attention = (input.attention ?? [])
    .filter((entry) => entry.level === 'now')
    .map((entry): NeedItem => ({
      kind: 'attention',
      key: `attention:${entry.id}`,
      pane_id: null,
      since: entry.since,
      title: entry.title,
      detail: '',
    }));

  const merged = [
    ...permissions.filter((_, i) => keepPermission[i]),
    ...asks.filter((_, i) => keepAsk[i]),
    ...attention,
  ].sort(byAge);

  return [...errors, ...routines, ...merged];
}

/**
 * Ce qu'un humain doit repondre maintenant, dans toute l'app : prompts de permission,
 * questions ouvertes et entrees d'attention `now`, comptes comme `needItems` les dedoublonne. Les erreurs et les runs
 * en echec n'en font pas partie : ils veulent un coup d'oeil, pas une reponse.
 */
export function waitsOnYou(input: NeedInput): number {
  let count = 0;
  for (const item of needItems(input)) {
    if (item.kind === 'permission' || item.kind === 'ask' || item.kind === 'attention') count += 1;
  }
  return count;
}
