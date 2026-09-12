/**
 * Format d'appairage : le contenu du QR code affiche par le Mac et lu par l'app.
 *
 * Ce format vivait auparavant en double, invente separement de chaque cote, avec des
 * noms de champs, un encodage et une enveloppe differents. Le QR ne pouvait donc pas
 * fonctionner. Il est desormais ici, et personne ne le redeclare.
 */

/** Port d'ecoute par defaut du daemon. Declare ici pour que les deux moities
 * ne puissent pas en inventer un chacune de leur cote. */
export const DEFAULT_PORT = 8765;

/** Duree de validite d'un code d'appairage. */
export const PAIRING_TTL_MS = 5 * 60_000;

/** Schema d'URL porte par le QR. */
export const PAIRING_URL_SCHEME = 'kovalink://pair#';

/** Version du format. Un lecteur qui ne la reconnait pas doit refuser, pas deviner. */
export const PAIRING_PAYLOAD_VERSION = 1;

export interface PairPayload {
  /** Version du format. */
  v: number;
  /** Code d'appairage, sensible a la casse, usage unique. */
  code: string;
  /** Nom MagicDNS du Mac, celui que porte le certificat. */
  tsDns: string;
  /** Port d'ecoute du daemon. Jamais de valeur par defaut implicite. */
  port: number;
  /** Nom lisible du Mac, affiche pendant l'appairage. */
  name?: string;
  /** Expiration en millisecondes epoch, pour afficher le temps restant. */
  exp?: number;
}

// Encodage base64url pur, sans Buffer, btoa ni atob : ce module est partage entre un
// daemon Node et une app React Native, et il doit compiler sans aucun global d'execution.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function utf8Decode(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i] ?? 0;
    let c: number;
    if (b < 0x80) { c = b; i += 1; }
    else if (b < 0xe0) { c = ((b & 31) << 6) | ((bytes[i + 1] ?? 0) & 63); i += 2; }
    else if (b < 0xf0) { c = ((b & 15) << 12) | (((bytes[i + 1] ?? 0) & 63) << 6) | ((bytes[i + 2] ?? 0) & 63); i += 3; }
    else { c = ((b & 7) << 18) | (((bytes[i + 1] ?? 0) & 63) << 12) | (((bytes[i + 2] ?? 0) & 63) << 6) | ((bytes[i + 3] ?? 0) & 63); i += 4; }
    if (c > 0xffff) { c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff)); }
    else s += String.fromCharCode(c);
  }
  return s;
}

function toBase64Url(json: string): string {
  const bytes = utf8Encode(json);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    out += b === undefined ? '' : B64.charAt((n >> 6) & 63);
    out += c === undefined ? '' : B64.charAt(n & 63);
  }
  return out;
}

function fromBase64Url(value: string): string {
  const bytes: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of value) {
    const v = B64.indexOf(ch === '+' ? '-' : ch === '/' ? '_' : ch);
    if (v < 0) { if (ch === '=') continue; throw new Error('base64url invalide'); }
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
  }
  return utf8Decode(bytes);
}

/** Construit l'URL a encoder dans le QR. */
export function encodePairPayload(payload: PairPayload): string {
  return `${PAIRING_URL_SCHEME}${toBase64Url(JSON.stringify(payload))}`;
}

/**
 * Lit ce qui a ete scanne. Accepte l'URL complete, la charge utile base64url seule,
 * ou du JSON brut, pour rester tolerant aux lecteurs de QR. Renvoie `null` plutot que
 * de deviner un champ manquant : un appairage a moitie devine est pire qu'un echec.
 */
export function decodePairPayload(raw: string): PairPayload | null {
  const trimmed = raw.trim();
  const body = trimmed.startsWith(PAIRING_URL_SCHEME)
    ? trimmed.slice(PAIRING_URL_SCHEME.length)
    : trimmed;

  let json = body;
  if (!body.startsWith('{')) {
    try {
      json = fromBase64Url(body);
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(json) as Partial<PairPayload>;
    if (parsed.v !== PAIRING_PAYLOAD_VERSION) return null;
    if (typeof parsed.code !== 'string' || parsed.code.length === 0) return null;
    if (typeof parsed.tsDns !== 'string' || parsed.tsDns.length === 0) return null;
    if (typeof parsed.port !== 'number' || !Number.isInteger(parsed.port)) return null;
    return {
      v: parsed.v,
      code: parsed.code,
      tsDns: parsed.tsDns,
      port: parsed.port,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      exp: typeof parsed.exp === 'number' ? parsed.exp : undefined,
    };
  } catch {
    return null;
  }
}
