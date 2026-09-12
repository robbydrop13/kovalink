/** Forme d'un identifiant de session Claude Code : un UUID v4 en minuscules. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}
