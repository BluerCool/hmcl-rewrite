/**
 * Minimal MD5 digest (RFC 1321) limited to ASCII/UTF-8 strings, mirroring the
 * Java `UUID.nameUUIDFromBytes` derivation used for offline player ids.
 */

/**
 * Per-round shift amounts and sine-derived constants from RFC 1321.
 */
const S: readonly number[] =
  [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

const K: readonly number[] = (() => {
  const table: number[] = new Array(64);
  for (let i = 0; i < 64; i++) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  return table;
})();

/** Left-rotates the 32-bit value `x` by `c` bits. */
function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/**
 * Computes the raw 16-byte RFC 1321 MD5 digest of `input`.
 */
function md5(input: Uint8Array): Uint8Array {
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  const bitLen = input.length * 8;
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) << 6);
  padded.set(input);
  padded[input.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  const m: number[] = new Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(offset + i * 4, true);

    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (bb & cc) | (~bb & dd);
        g = i;
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * i + 5) % 16;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * i) % 16;
      }
      f = (f + aa + K[i]! + m[g]!) >>> 0;
      aa = dd;
      dd = cc;
      cc = bb;
      bb = (bb + rotl(f, S[i]!)) >>> 0;
    }

    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, a, true);
  outDv.setUint32(4, b, true);
  outDv.setUint32(8, c, true);
  outDv.setUint32(12, d, true);
  return out;
}

/** Renders `bytes` as a lowercase hex string. */
function toHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

/**
 * Derives the vanilla offline UUID for `username` (MD5 of
 * `OfflinePlayer:<name>`, version-3/variant IETF bits set).
 */
export function offlineUuid(username: string): string {
  const bytes = new TextEncoder().encode(`OfflinePlayer:${username}`);
  const hash = md5(bytes);
  hash[6] = (hash[6]! & 0x0f) | 0x30;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = toHex(hash);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}