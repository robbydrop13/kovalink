// Un geste sur une ligne de la file d'attention. Ce qui part est TOUJOURS un des boutons
// de la liste fermee du protocole, jamais un mot fabrique ici : le daemon en tire l'argv
// de `attn`. Aucune file d'attente locale, comme pour les questions : un echec se dit sur
// place, un geste rejoue plus tard sur une entree deja fermee ne vaudrait rien.
import { isAttentionButton, type AttentionActResponse, type AttentionButton } from '@/protocol';
import { HttpError, postAttentionAct } from '@/net/http';
import { nonce } from './nonce';

export type AttentionOutcome =
  | { ok: true; result: AttentionActResponse }
  /** `gone` : l'entree n'est plus ouverte (fermee sur le Mac entre temps). */
  | { ok: false; kind: 'gone' | 'refused' | 'network'; cause: string };

export async function actOnAttention(id: string, button: AttentionButton, text = ''): Promise<AttentionOutcome> {
  if (!isAttentionButton(button)) return { ok: false, kind: 'refused', cause: 'unknown button' };
  try {
    const body = text.trim().length > 0 ? { button, text: text.trim(), nonce: nonce() } : { button, nonce: nonce() };
    return { ok: true, result: await postAttentionAct(id, body) };
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 404) return { ok: false, kind: 'gone', cause: e.message };
      return { ok: false, kind: 'refused', cause: `${e.code}: ${e.message}` };
    }
    return { ok: false, kind: 'network', cause: e instanceof Error ? e.message : String(e) };
  }
}
