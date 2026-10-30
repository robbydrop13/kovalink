// Envoi libre par nom de session : la montre ne connait pas les paneId. La resolution est
// celle du pont Slack (`resolveSession`), les gardes d'ecriture celles de KeyGate.
import type { ActionResponse, Pane, SessionTextResponse } from '@kovalink/protocol';
import { resolveSession } from '../slack/logic.js';

/**
 * Resout `session` puis emet le texte dans le pane trouve. Nom inconnu ou ambigu rend
 * `applied:false` sans rien emettre ; une `ForbiddenError` de `emitText` remonte telle
 * quelle, la route la traduit en 403.
 */
export async function sendToSession(
  deps: {
    panes: () => readonly Pane[];
    emitText: (paneId: number, text: string, deviceId: string) => Promise<ActionResponse>;
  },
  session: string,
  text: string,
  deviceId: string,
): Promise<SessionTextResponse> {
  const r = resolveSession(session, deps.panes());
  if (!r.ok) {
    return {
      applied: false,
      reason: r.reason === 'ambiguous' ? 'ambiguous_session' : 'unknown_session',
      names: r.names,
    };
  }
  const res = await deps.emitText(r.pane.id, text, deviceId);
  return { ...res, session: r.name };
}
