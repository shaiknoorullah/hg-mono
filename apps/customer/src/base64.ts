/**
 * A minimal base64 decoder, dependency-free for the same reason `sha256.ts` is: RN's JS engine
 * does not reliably ship `atob`, and pulling in a package for one small function is more surface
 * than the capture flow needs.
 */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < CHARS.length; i += 1) LOOKUP[CHARS[i]!] = i;

/** Decodes a base64 string (no data: URI prefix) into raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const len = clean.length;
  const outLen = (len / 4) * 3 - padding;
  const bytes = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e1 = LOOKUP[clean[i]!] ?? 0;
    const e2 = LOOKUP[clean[i + 1]!] ?? 0;
    const e3 = LOOKUP[clean[i + 2]!] ?? 0;
    const e4 = LOOKUP[clean[i + 3]!] ?? 0;
    const triple = (e1 << 18) | (e2 << 12) | (e3 << 6) | e4;
    if (p < outLen) bytes[p++] = (triple >> 16) & 0xff;
    if (p < outLen) bytes[p++] = (triple >> 8) & 0xff;
    if (p < outLen) bytes[p++] = triple & 0xff;
  }
  return bytes;
}
