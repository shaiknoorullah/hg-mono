// RFC 6238: 30-second steps, 6 digits, HMAC-SHA1. No dependency.
// The secret never leaves the caller. This module does not print it.
import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(text) {
  const clean = String(text).replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('TOTP secret is not base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Six-digit code for `secret` at `when` (milliseconds). */
export function totp(secret, when = Date.now()) {
  const counter = Math.floor(when / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(bin).padStart(6, '0');
}

/** A code with at least `minSeconds` left in its 30-second window. */
export async function freshTotp(secret, minSeconds = 8) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < minSeconds) await new Promise((r) => setTimeout(r, (left + 1) * 1000));
  return totp(secret);
}
