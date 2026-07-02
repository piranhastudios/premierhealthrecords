// HMAC + TOTP built on the (polyfilled) Web Crypto digest. Used for the offline
// rotating-QR path. Works in Hermes via the expo-crypto-backed subtle.digest shim
// (src/lib/polyfills.ts) and in the browser via native Web Crypto.

type DigestName = 'SHA-1' | 'SHA-256';

async function digest(name: DigestName, bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = (globalThis as unknown as { crypto: { subtle: SubtleCrypto } }).crypto.subtle;
  const buf = await subtle.digest(name, bytes as unknown as ArrayBuffer);
  return new Uint8Array(buf);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function hmac(name: DigestName, blockSize: number, key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  let k = key;
  if (k.length > blockSize) {
    k = await digest(name, k);
  }
  const padded = new Uint8Array(blockSize);
  padded.set(k);
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = padded[i] ^ 0x36;
    opad[i] = padded[i] ^ 0x5c;
  }
  const inner = await digest(name, concat(ipad, msg));
  return digest(name, concat(opad, inner));
}

export function hmacSha1(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  return hmac('SHA-1', 64, key, msg);
}

export function hmacSha256(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  return hmac('SHA-256', 64, key, msg);
}

/** RFC 6238 TOTP. `step` = floor(epochSeconds / period). */
export async function totp(secret: Uint8Array, step: number, digits = 8): Promise<string> {
  const counter = new Uint8Array(8);
  let value = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  const hash = await hmacSha1(secret, counter);
  const offset = hash[hash.length - 1] & 0x0f;
  const bin =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}
