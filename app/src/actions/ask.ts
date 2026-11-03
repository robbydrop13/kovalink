// Repondre a la question d'un agent (`kova ask`), ou la remettre a plus tard.
//
// Ce qui part est TOUJOURS un des `buttons` de la question, jamais un libelle fabrique par
// l'app : ce mot est celui que l'agent relit, et il finit retape dans un terminal sur le
// Mac. Le texte libre, lui, est le champ de la carte, et il est borne par le protocole.
//
// Aucune file d'attente locale (`db/outbox`), contrairement aux reponses de prompt : une
// question se repond en la regardant, et un echec se dit sur place. Rejouer une reponse
// dix minutes plus tard, sur une question peut etre deja reglee sur le Mac, vaudrait moins
// que la redemander.
import type { AskItem } from '@/protocol';
import { HttpError, postAskAnswer, postAskSnooze } from '@/net/http';
import { askAnswerBody, isAskButton } from '@/features/asks/answer';
import { nonce } from './nonce';

export type AskOutcome =
  | { ok: true }
  /**
   * `cause` porte le message REEL du daemon. Sans lui, une question deja repondue sur le
   * Mac (404) et un Mac eteint donnaient le meme « injoignable ». `gone` est le cas ou
   * il n'y a plus rien a faire : la question a disparu de la carte.
   */
  | { ok: false; kind: 'gone' | 'refused' | 'network'; cause: string };

function outcome(e: unknown): AskOutcome {
  if (e instanceof HttpError) {
    if (e.status === 404) return { ok: false, kind: 'gone', cause: e.message };
    return { ok: false, kind: 'refused', cause: `${e.code}: ${e.message}` };
  }
  return { ok: false, kind: 'network', cause: e instanceof Error ? e.message : String(e) };
}

export async function answerAsk(ask: AskItem, action: string, text: string): Promise<AskOutcome> {
  if (!isAskButton(ask, action)) {
    return { ok: false, kind: 'refused', cause: 'unknown button' };
  }
  try {
    await postAskAnswer(ask.id, { ...askAnswerBody(action, text), nonce: nonce() });
    return { ok: true };
  } catch (e) {
    return outcome(e);
  }
}

export async function snoozeAsk(ask: AskItem, seconds: number): Promise<AskOutcome> {
  try {
    await postAskSnooze(ask.id, seconds, nonce());
    return { ok: true };
  } catch (e) {
    return outcome(e);
  }
}
