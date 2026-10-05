// HTTP session for the staging API. One surface per principal.
// Access tokens stay in memory. Reports only see redacted bodies.
import { randomUUID } from 'node:crypto';
import { redact } from './redact.mjs';

const GAP_MS = 280;
let lastAt = 0;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shared gap so the four principals do not burst from one address. */
export async function pace() {
  const wait = lastAt ? lastAt + GAP_MS - Date.now() : 0;
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

export class ApiError extends Error {
  constructor(info) {
    const message = info.message || 'request failed';
    super(typeof message === 'string' ? String(redact(message)) : 'request failed');
    this.name = 'ApiError';
    this.method = info.method;
    this.path = info.path;
    this.status = info.status ?? 0;
    this.code = info.code || null;
    this.details = redact(info.details ?? null);
    this.request = redact(info.request ?? null);
    this.response = redact(info.response ?? null);
  }
}

function webSurface(surface) {
  return surface === 'restaurant-web' || surface === 'admin-web' || surface === 'web';
}

export class Session {
  constructor({ base, surface }) {
    this.base = String(base).replace(/\/$/, '');
    this.surface = surface;
    this.access = null;
    this.refresh = null;
    this.cookies = new Map();
    this.exp = 0;
  }

  absorb(grant) {
    if (!grant?.access_token) return;
    this.access = grant.access_token;
    const ttl = Number(grant.expires_in) || 900;
    this.exp = Date.now() + ttl * 1000;
    if (typeof grant.refresh_token === 'string' && grant.refresh_token.startsWith('hgrt_')) {
      this.refresh = grant.refresh_token;
    }
  }

  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const raw of list) {
      const pair = String(raw).split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async doRefresh() {
    const headers = {
      'X-HG-Client': this.surface,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    };
    let body = '{}';
    if (webSurface(this.surface)) {
      const csrf = this.cookies.get('hg_csrf');
      if (!csrf || !this.cookies.has('hg_rt')) return false;
      headers['X-HG-CSRF'] = csrf;
      headers.Cookie = this.cookieHeader();
    } else if (this.refresh) {
      body = JSON.stringify({ refresh_token: this.refresh });
    } else {
      return false;
    }
    await pace();
    const res = await fetch(`${this.base}/v1/auth/refresh`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(20_000),
    });
    this.storeCookies(res);
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    if (res.status >= 400) return false;
    this.absorb(json?.data ?? json);
    return Boolean(this.access);
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ body?: object, query?: object, expect?: number[], auth?: boolean, _retried?: boolean }} [opts]
   */
  async call(method, path, opts = {}) {
    if (opts.auth !== false && this.access && this.exp - Date.now() < 60_000) {
      await this.doRefresh();
    }
    const url = new URL(this.base + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    const headers = { Accept: 'application/json', 'X-HG-Client': this.surface };
    if (opts.auth !== false && this.access) headers.Authorization = `Bearer ${this.access}`;
    const upper = method.toUpperCase();
    const hasBody = opts.body !== undefined;
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (upper === 'POST' || upper === 'PUT' || upper === 'PATCH') {
      headers['Idempotency-Key'] = randomUUID();
    }
    await pace();
    let res;
    try {
      res = await fetch(url, {
        method: upper,
        headers,
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ApiError({
        method: upper,
        path,
        status: 0,
        code: 'NETWORK',
        message: err.message,
        request: opts.body ?? null,
      });
    }
    this.storeCookies(res);
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = { unparsed: text.slice(0, 300) }; }
    }
    const errObj = json && typeof json.error === 'object' ? json.error : null;
    const code = errObj?.code || null;
    const message = errObj?.message || null;
    const allowed = opts.expect;
    const ok = allowed ? allowed.includes(res.status) : res.status < 400;
    if (res.status === 401 && !opts._retried && opts.auth !== false && (this.refresh || this.cookies.has('hg_rt'))) {
      const refreshed = await this.doRefresh();
      if (refreshed) return this.call(method, path, { ...opts, _retried: true });
    }
    const payload = {
      status: res.status,
      data: json && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json,
      meta: json?.meta ?? null,
      error: errObj ? { code, message, details: errObj.details ?? null } : null,
      body: json,
    };
    if (!ok) {
      throw new ApiError({
        method: upper,
        path,
        status: res.status,
        code,
        message: message || `${upper} ${path} failed`,
        details: errObj?.details ?? null,
        request: opts.body ?? null,
        response: payload.body,
      });
    }
    return payload;
  }
}
