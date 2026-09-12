// SHA-256 incrémental, en TypeScript pur.
//
// Pourquoi il existe : `expo-crypto` ne sait hacher qu'un tampon entier, et le fichier de
// 1,2 Go du critère CA-101 ne doit jamais tenir en mémoire (150 Mo résidents au plus). On
// hache donc tranche par tranche, avec les mêmes 4 Mo que l'envoi lit déjà. FIPS 180-4,
// vérifié contre `node:crypto` par `test/sha256.test.ts`.

const K = new Int32Array([
  0x428a2f98, 0x71374491, -0x4a3f0431, -0x164a245b, 0x3956c25b, 0x59f111f1, -0x6dc07d5c, -0x54e3a12b,
  -0x27f85568, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, -0x7f214e02, -0x6423f959, -0x3e640e8c,
  -0x1b64963f, -0x1041b87a, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  -0x67c1aeae, -0x57ce3993, -0x4ffcd838, -0x40a68039, -0x391ff40d, -0x2a586eb9, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, -0x7e3d36d2, -0x6d8dd37b,
  -0x5d40175f, -0x57e599b5, -0x3db47490, -0x3893ae5d, -0x2e6d17e7, -0x2966f9dc, -0x0bf1ca7b, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, -0x7b3787ec, -0x7338fdf8, -0x6f410006, -0x5baf9315, -0x41065c09, -0x398e870e,
]);

export class Sha256 {
  private readonly h = new Int32Array([
    0x6a09e667, -0x4498517b, 0x3c6ef372, -0x5ab00ac6, 0x510e527f, -0x64fa9774, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly w = new Int32Array(64);
  private readonly block = new Uint8Array(64);
  private blockLen = 0;
  /** Longueur totale en octets. Un `number` suffit largement jusqu'à 2^53. */
  private total = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('empreinte déjà close');
    let offset = 0;
    const len = data.length;
    this.total += len;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, len);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      offset = take;
      if (this.blockLen === 64) {
        this.compress(this.block, 0);
        this.blockLen = 0;
      }
    }
    while (offset + 64 <= len) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < len) {
      this.block.set(data.subarray(offset), 0);
      this.blockLen = len - offset;
    }
    return this;
  }

  /** Empreinte hexadécimale en minuscules, 64 caractères. */
  digest(): string {
    if (this.finished) throw new Error('empreinte déjà close');
    this.finished = true;
    const bitLenHi = Math.floor(this.total / 0x20000000);
    const bitLenLo = (this.total << 3) >>> 0;
    this.block[this.blockLen] = 0x80;
    this.blockLen += 1;
    if (this.blockLen > 56) {
      this.block.fill(0, this.blockLen);
      this.compress(this.block, 0);
      this.blockLen = 0;
    }
    this.block.fill(0, this.blockLen, 56);
    writeUint32(this.block, 56, bitLenHi);
    writeUint32(this.block, 60, bitLenLo);
    this.compress(this.block, 0);
    let out = '';
    for (let i = 0; i < 8; i++) out += ((this.h[i] as number) >>> 0).toString(16).padStart(8, '0');
    return out;
  }

  private compress(src: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        ((src[j] as number) << 24) |
        ((src[j + 1] as number) << 16) |
        ((src[j + 2] as number) << 8) |
        (src[j + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    const h = this.h;
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] as number) + a;
    h[1] = (h[1] as number) + b;
    h[2] = (h[2] as number) + c;
    h[3] = (h[3] as number) + d;
    h[4] = (h[4] as number) + e;
    h[5] = (h[5] as number) + f;
    h[6] = (h[6] as number) + g;
    h[7] = (h[7] as number) + hh;
  }
}

function writeUint32(out: Uint8Array, at: number, value: number): void {
  out[at] = (value >>> 24) & 0xff;
  out[at + 1] = (value >>> 16) & 0xff;
  out[at + 2] = (value >>> 8) & 0xff;
  out[at + 3] = value & 0xff;
}

/** Empreinte d'un tampon complet. Pour les gros volumes, préférer `Sha256` par tranches. */
export function sha256Hex(data: Uint8Array): string {
  return new Sha256().update(data).digest();
}

export type DigestVerdict = 'ok' | 'mismatch' | 'unverified';

/**
 * Verdict d'un téléchargement (CA-101, sens Mac vers iPhone). `expected` est l'en-tête
 * `x-kovalink-sha256` du Mac ; s'il est absent ou malformé, le fichier est `unverified`,
 * ce qui est dit à l'écran plutôt que confondu avec un succès. La comparaison ignore
 * la casse : l'hexadécimal n'en a pas.
 */
export function digestVerdict(expected: string | null | undefined, actual: string): DigestVerdict {
  if (!expected || !/^[0-9a-fA-F]{64}$/.test(expected)) return 'unverified';
  return expected.toLowerCase() === actual.toLowerCase() ? 'ok' : 'mismatch';
}
