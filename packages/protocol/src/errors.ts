export const ERROR_CODES = [
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'PROTOCOL_VERSION',
  'BAD_REQUEST',
  'KOVA_DOWN',
  'PANE_NOT_FOUND',
  'SESSION_NOT_FOUND',
  'IPC_TIMEOUT',
  'IPC_UNSUPPORTED',
  'FORBIDDEN_ACTION',
  'FORBIDDEN_KEY',
  // 409 sur `POST /v1/panes/:id/answer` : le hash ou l'`awaitingSince` ne correspond
  // plus a l'ecran. Rien n'a ete envoye au pane (A6.3, C1).
  'PROMPT_CHANGED',
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
