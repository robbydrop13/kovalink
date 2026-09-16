/** Modes de permission observes dans le JSONL (ligne `permission-mode`). */
export const PERMISSION_MODES = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'bypassPermissions',
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value as string);
}

/** Modes qui ne produiront jamais de prompt : ils portent le badge `bypass` (A2). */
export function isBypassMode(mode: PermissionMode | null): boolean {
  return mode === 'bypassPermissions' || mode === 'auto';
}

export interface ChildProcess {
  name: string;
  pid: number;
  version: string | null;
}

/** Pane tel qu'expose a l'app : champs Kova bruts, plus les champs calcules. */
export interface Pane {
  id: number;
  window: number;
  tab: number;
  cwd: string;
  title: string | null;
  focused: boolean;
  pid: number;
  child_processes: ChildProcess[];
  is_idle: boolean;
  working: boolean;
  awaiting: boolean;
  awaiting_since: string | null;
  awaiting_seen: boolean;
  /**
   * LE bit de non lu de Kova (`PaneFlags::is_unread`, `kova/src/window/sidebar.rs`) : marque
   * manuelle (Cmd+U), ou bien quelque chose de neuf depuis que le pane a ete regarde
   * (question, fin de tour, cloche, completion, drapeau du hook). C'est celui qui pilote
   * Cmd+J, la pastille Next et Cmd+U sur le Mac : le telephone s'en sert comme SOURCE DE
   * VERITE pour que « non lu » veuille dire la meme chose des deux cotes.
   *
   * ABSENT (`undefined`) chez un Kova qui ne l'expose pas encore. Absent n'est pas `false` :
   * `false` dirait « Kova affirme que ce pane est lu », alors que l'absence fait retomber
   * l'app sur sa regle locale (les `Prompt` synthetises par le daemon).
   */
  unread?: boolean;
  minimized: boolean;
  agent: string | null;
  agent_session_id: string | null;
  agent_session_name: string | null;
  claude_session_id: string | null;
  claude_session_name: string | null;
  /**
   * La conversation que le bouton `Resume` de Kova rouvrirait dans ce pane (un pane
   * restaure au lancement dont la derniere commande est `claude --resume <id>`), `null`
   * sinon. Toujours `null` avec un Kova qui ne les expose pas encore. Le daemon ne tape
   * jamais `resume_command` : il demande `resume-pane` a Kova.
   */
  resume_agent: string | null;
  resume_session_id: string | null;
  resume_command: string | null;
  // Calcules par le daemon.
  projectName: string;
  hasTranscript: boolean;
  /** A5 : rendu chat reserve a l'agent claude, repli monospace sinon. */
  chatCapable: boolean;
  permissionMode: PermissionMode | null;
  /**
   * Couleur de l'ONGLET qui porte ce pane, recopiee ici parce que la liste mobile
   * affiche une ligne par pane. Index Kova de 0 (rouge) a 5 (violet), `null` si
   * l'onglet n'en porte aucune.
   */
  color: number | null;
  /**
   * Identifiant Kova de l'ONGLET qui porte ce pane. Kova ne le donne pas sur le pane
   * (seulement `tab`, un INDEX qui change a chaque deplacement d'onglet) : le daemon le
   * resout en lisant `list-tabs` et `list-panes` au meme instant. C'est la cle de
   * regroupement de l'app ; `(window, tab)` n'est qu'un repli quand il vaut `null`.
   * Une jointure sur l'index entre deux listes lues a des moments differents nommait
   * l'onglet « Link » « Notes » apres un reordonnancement sur le Mac.
   */
  tabId: number | null;
  /**
   * `claude` vient d'etre lance dans ce pane par le daemon (nouvel onglet, pane ajoute,
   * relance) et Kova ne voit pas encore l'agent : Claude Code met quelques secondes a
   * ecrire sa session, plus si l'ecran de confiance du dossier attend. Pendant cette
   * fenetre (`LAUNCH_GRACE_MS` cote daemon) l'app montre « Claude demarre », jamais
   * « session perimee ». Retombe a `false` des que l'agent apparait ou a l'echeance.
   */
  launching: boolean;
  /** 3 etats exclusifs, `awaiting` l'emporte sur `working` (PRD A2). */
  liveState: 'awaiting' | 'working' | 'idle';
}

export interface Tab {
  id: number;
  window: number;
  tab_index: number;
  title: string | null;
  pane_count: number;
  focused_pane_id: number;
  active: boolean;
  has_bell: boolean;
  has_completion: boolean;
  has_running: boolean;
  /**
   * Index de couleur, 0 (rouge) a 5 (violet), `null` si aucune.
   *
   * MESURE : Kova 1.11.0 ne renvoie la couleur ni dans `list-tabs` ni dans
   * `list-panes`. `set-tab-color` est une commande d'ecriture seule. Le daemon lit
   * donc la valeur dans `~/.config/kova/session.json`, ou elle est persistee par
   * onglet, et la joint par `(window, tab_index)`.
   */
  color: number | null;
}

/**
 * Contenu d'un pane. V2 : un pane inexistant renvoie `ok:true` avec une erreur par
 * element. L'union discriminee est imposee des le client IPC, aucun appelant ne voit
 * la forme brute.
 */
export type PaneContent =
  | {
      id: number;
      text: string;
      cols: number;
      rows: number;
      cursor: { row: number; col: number };
    }
  | { id: number; error: string };

export function isPaneContentError(p: PaneContent): p is { id: number; error: string } {
  return 'error' in p;
}

/**
 * Commandes Kova exposees hors `KeyGate` : elles n'ecrivent rien dans le pane.
 * Union litterale fermee, `dispatch-action` est retire du protocole (C7).
 */
export type PaneCommand =
  | { cmd: 'focus-pane' }
  | { cmd: 'set-pane-status'; status: 'waiting' | 'none' };

/** Repli monospace du pane visible (~30 lignes), lot 1, pas de xterm.js. */
export interface PaneScreen {
  paneId: number;
  cols: number;
  rows: number;
  /** Dernieres lignes non vides, plafonnees a `SCREEN_FALLBACK_LINES`. */
  lines: string[];
  cursor: { row: number; col: number };
  capturedAt: string;
}

export const SCREEN_FALLBACK_LINES = 30;
