export const ERROR_CODES = [
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'PROTOCOL_VERSION',
  'BAD_REQUEST',
  'KOVA_DOWN',
  'PANE_NOT_FOUND',
  // 404 sur `POST /v1/kova/tabs/:tabId/reorder` : l'onglet n'est pas dans l'index du daemon.
  'TAB_NOT_FOUND',
  'SESSION_NOT_FOUND',
  'IPC_TIMEOUT',
  'IPC_UNSUPPORTED',
  // 501 : le Kova installe sur le Mac ne connait pas la commande (`move-tab` est arrivee
  // apres la 1.11.0). Le message dit quoi faire : mettre Kova a jour.
  'KOVA_TOO_OLD',
  // 502 : Kova a refuse une commande de controle, son message est relaye mot pour mot.
  'KOVA_ERROR',
  'FORBIDDEN_ACTION',
  'FORBIDDEN_KEY',
  // 409 sur `POST /v1/panes/:id/answer` : le hash ou l'`awaitingSince` ne correspond
  // plus a l'ecran. Rien n'a ete envoye au pane (A6.3, C1).
  'PROMPT_CHANGED',
  // 409 sur `POST /v1/panes/:id/start-claude` : le pane porte deja un agent, un
  // processus, ou un `claude` en cours de demarrage. Rien n'a ete tape dedans.
  'PANE_BUSY',
  'TEXT_TOO_LONG',
  'PATH_DENIED',
  // Bloc C. Chaque refus porte sa cause reelle : « Mac injoignable » pour un chemin
  // en liste noire a deja coute des heures de diagnostic.
  'PATH_NOT_FOUND',
  'NOT_A_DIRECTORY',
  'NOT_A_FILE',
  'READ_DENIED',
  'UPLOAD_NOT_FOUND',
  'OFFSET_MISMATCH',
  'CHECKSUM_MISMATCH',
  'RATE_LIMITED',
  'IO_ERROR',
  'NO_SPACE',
  // Mode vocal : la cle OpenAI (`~/.kovalink/openai-key`) est absente du Mac, ou refusee (401).
  'TRANSCRIPTION_UNAVAILABLE',
  // Mode vocal : Whisper a refuse ou echoue, son message est relaye mot pour mot.
  'TRANSCRIPTION_FAILED',
  // Navigateur : la socket de Mira est absente (503), l'onglet est inconnu de Mira (404),
  // ou Mira a refuse la commande, son message est relaye mot pour mot (502).
  'MIRA_UNAVAILABLE',
  'MIRA_TAB_NOT_FOUND',
  'MIRA_ERROR',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

/** Raison d'un refus d'ecriture. Aucun octet n'a atteint le pane. */
export type ActionReason =
  | 'duplicate'
  | 'prompt_changed'
  | 'not_awaiting'
  | 'pane_gone'
  | 'became_awaiting'
  /** Texte colle puis efface : le TUI n'a jamais honore le retour chariot. */
  | 'not_submitted'
  | 'forbidden'
  | 'kova_down';

/**
 * Reponse des trois routes d'ecriture (`paneAnswer`, `paneInterrupt`, `paneText`).
 * `applied: false` porte toujours sa raison : le daemon ne refuse jamais en silence.
 * Un `prompt_changed` sur `paneAnswer` est rendu en 409 `PROMPT_CHANGED`, pas ici.
 */
export interface ActionResponse {
  applied: boolean;
  reason?: ActionReason;
}
