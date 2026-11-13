import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { clickKeyPath } from '../attention.js';

/**
 * Signature d'un `send-keys` (Kova 748bded, docs/ipc.md de Kova, « Signed send ») : elle
 * dit a Kova que ces octets sont un geste de Robin (telephone, montre, Slack), pas le
 * texte d'un outil. Cle : la cle de clic d'`attn`, la meme que pour ses clics, relue a
 * chaque envoi, jamais journalisee, jamais en argument ni dans une erreur.
 */
export const SIG_BY = 'kovalink';

export interface SendSig {
  by: string;
  ts: number;
  mac: string;
}

/** Octets signes : cinq parties jointes par `\n`, sans saut de ligne final. */
export function signedMessage(by: string, paneId: number, ts: number, text: string): string {
  const textSha = createHash('sha256').update(text, 'utf8').digest('hex');
  return ['kova-send-keys-v1', by, String(paneId), String(ts), textSha].join('\n');
}

export function signSendKeys(key: string, paneId: number, text: string, ts: number, by = SIG_BY): SendSig {
  const mac = createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(signedMessage(by, paneId, ts, text), 'utf8')
    .digest('hex');
  return { by, ts, mac };
}

/** Une ligne, rognee. Absente ou illisible : null, l'envoi part sans signature. */
function readKey(): string | null {
  try {
    const key = readFileSync(clickKeyPath(), 'utf8').trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Kova refuse une signature deja vue : deux envois identiques vers le meme pane dans la
 * meme milliseconde seraient un rejeu. L'horodatage est donc strictement croissant.
 */
let lastTs = 0;
function nextTs(now: number): number {
  lastTs = Math.max(now, lastTs + 1);
  return lastTs;
}

/** Signature fraiche pour cet envoi, ou null sans cle. */
export function sigFor(paneId: number, text: string, now = Date.now()): SendSig | null {
  const key = readKey();
  if (key === null) return null;
  return signSendKeys(key, paneId, text, nextTs(now));
}

/** Un Kova anterieur a 748bded rejette le champ : on repasse sans signature. */
export function isUnknownSigField(error: string | undefined): boolean {
  return typeof error === 'string' && error.includes('unknown field "sig"');
}
