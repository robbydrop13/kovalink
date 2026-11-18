// Un geste du Cockpit et le report d'une carte. Ce qui part est un des mots du protocole,
// jamais un mot fabrique ici : le daemon relit la carte et construit l'argv de Kova. Aucune
// file d'attente locale ni nouvel essai automatique : un geste sans reponse claire se dit
// « Envoi non confirmé », et seul Robin le relance (avec le meme identifiant de clic).
import type { AttentionGestureRequest, AttentionSnoozeRequest } from '@/protocol';
import { HttpError, postAttentionGesture, postAttentionSnooze } from '@/net/http';
import type { GestureCall } from '@/features/cockpit/gesture';
import { nonce } from './nonce';

function failed(e: unknown): GestureCall {
  if (e instanceof HttpError) return { ok: false, kind: 'http', status: e.status, code: e.code, message: e.message };
  return { ok: false, kind: 'network', message: e instanceof Error ? e.message : String(e) };
}

export async function sendCockpitGesture(id: string, body: Omit<AttentionGestureRequest, 'nonce'>): Promise<GestureCall> {
  try {
    return { ok: true, response: await postAttentionGesture(id, { ...body, nonce: nonce() }) };
  } catch (e) {
    return failed(e);
  }
}

export async function snoozeCockpitCard(id: string, body: Omit<AttentionSnoozeRequest, 'nonce'>): Promise<GestureCall> {
  try {
    return { ok: true, response: await postAttentionSnooze(id, { ...body, nonce: nonce() }) };
  } catch (e) {
    return failed(e);
  }
}
