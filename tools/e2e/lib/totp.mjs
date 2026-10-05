// A time-based one-time code (RFC 6238: 30-second steps, 6 digits, HMAC-SHA1), the same codes
// an authenticator app shows for a staff account. The seed writes each staff member's secret to
// the world file; tests sign in with the code of the moment. No dependency on purpose.
import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(text) {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error(`not a base32 TOTP secret: unexpected "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit code for `secret` at `when` (default: now). */
export function totp(secret, when = Date.now()) {
  const counter = Math.floor(when / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(bin).padStart(6, '0');
}

/**
 * A code that stays valid for at least `minSeconds` more, waiting for the next 30-second step
 * when the current one is about to run out, so a slow form submit is not refused.
 */
export async function freshTotp(secret, minSeconds = 8) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < minSeconds) await new Promise((r) => setTimeout(r, (left + 1) * 1000));
  return totp(secret);
}

// CLI: node tools/e2e/lib/totp.mjs <secret>
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv[2]) {
    console.error('usage: node tools/e2e/lib/totp.mjs <base32 secret>');
    process.exit(2);
  }
  console.log(totp(process.argv[2]));
}
