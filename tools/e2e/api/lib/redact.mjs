// Strip credentials before anything is printed or written to a report.

const SECRET_KEYS = new Set([
  'password',
  'totp_code',
  'totp',
  'otp_code',
  'access_token',
  'refresh_token',
  'client_secret',
  'authorization',
  'secret',
  'qr_token',
  'token',
  'seed_password',
  'totp_secret',
]);

const SECRET_VALUE = /sk_(?:test|live)_[A-Za-z0-9]+|hgrt_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/;

export function redact(value, depth = 0) {
  if (value == null || depth > 8) return value;
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) return '[redacted]';
    if (value.includes('X-Amz-Signature') || value.includes('X-Amz-Credential')) {
      try {
        const u = new URL(value);
        return `${u.origin}${u.pathname}?[signature redacted]`;
      } catch {
        return '[presigned url redacted]';
      }
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    if (key === 'code' && typeof v === 'string' && /^\d{4,8}$/.test(v)) {
      out[k] = '[redacted]';
      continue;
    }
    if (SECRET_KEYS.has(key)) {
      out[k] = v == null ? v : '[redacted]';
      continue;
    }
    out[k] = redact(v, depth + 1);
  }
  return out;
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
