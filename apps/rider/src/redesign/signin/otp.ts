/**
 * The two sign-in calls, classified into the states the SO sign-in boards draw.
 *
 * Called on the raw client (not `unwrap`) because two answers live outside the body: a 429's
 * wait is the `Retry-After` header (the backend sets it; `details.retry_after_seconds` is the
 * contract's documented fallback), and a wrong code's status differs between the contract
 * fixture (401) and the backend (400). Branches on `error.code` only, never on the message.
 *
 * `X-HG-Client: rider-app` is passed at the call site, as the contract's `ClientHeader`
 * requires (the client also stamps it): it is what makes a first sign-in a rider grant.
 */
import { HgApiError, type Schema } from '@hg/api-client';

import { registerForPush } from '../../push';
import { getToken, setToken } from '../../token';
import { rider } from '../data/client';
import { toRiderError, type RiderError } from '../data/errors';

export type OtpChallenge = Schema['OtpChallenge'];

const CLIENT = { 'X-HG-Client': 'rider-app' } as const;

/** Codes that mean "this rider account is closed" (SO `SignIn-Deactivated`). */
const CLOSED = new Set(['ACCOUNT_NOT_ACTIVE', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_BANNED']);

export type RequestOutcome =
  | { ok: true; challenge: OtpChallenge }
  /** 422 INVALID_PHONE / VALIDATION_FAILED. */
  | { ok: false; kind: 'invalid' }
  /** 429: wait this many seconds before asking again. */
  | { ok: false; kind: 'too-many'; retryAfterS: number | null }
  /** 503 RATE_LIMITER_UNAVAILABLE or any 5xx: the problem is ours. */
  | { ok: false; kind: 'unavailable' }
  | { ok: false; kind: 'offline' }
  | { ok: false; kind: 'other'; error: RiderError };

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; kind: 'incorrect'; attemptsRemaining: number | null }
  /** OTP_INVALID_OR_EXPIRED: the challenge is gone (expired, or every try used). */
  | { ok: false; kind: 'expired' }
  /** 429: sign-in paused for this number. */
  | { ok: false; kind: 'locked'; retryAfterS: number | null }
  | { ok: false; kind: 'closed' }
  | { ok: false; kind: 'unavailable' }
  | { ok: false; kind: 'offline' }
  | { ok: false; kind: 'other'; error: RiderError };

interface RawError {
  error?: { code?: string; details?: unknown };
}

function retryAfter(response: Response, body: RawError | undefined): number | null {
  const header = Number(response.headers.get('Retry-After'));
  if (Number.isFinite(header) && header > 0) return header;
  const details = body?.error?.details as { retry_after_seconds?: unknown } | null | undefined;
  const fromBody = Number(details?.retry_after_seconds);
  return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : null;
}

function codeOf(body: RawError | undefined): string {
  return String(body?.error?.code ?? '');
}

/** Ask for a sign-in code. Inside an open challenge the server re-sends the same code. */
export async function requestCode(phoneE164: string): Promise<RequestOutcome> {
  let result;
  try {
    result = await rider.POST('/v1/auth/otp/request', {
      params: { header: CLIENT },
      body: { phone_e164: phoneE164, purpose: 'SIGN_IN' },
    });
  } catch {
    return { ok: false, kind: 'offline' };
  }
  const { data, error, response } = result;
  if (data) return { ok: true, challenge: data.data };
  const body = error as RawError | undefined;
  const code = codeOf(body);
  if (code === 'INVALID_PHONE' || code === 'VALIDATION_FAILED' || response.status === 422) return { ok: false, kind: 'invalid' };
  if (response.status === 429 || code === 'RATE_LIMITED') return { ok: false, kind: 'too-many', retryAfterS: retryAfter(response, body) };
  if (response.status >= 500 || code === 'RATE_LIMITER_UNAVAILABLE') return { ok: false, kind: 'unavailable' };
  return { ok: false, kind: 'other', error: errorFrom(response.status, body) };
}

/**
 * Check the code. On success the session starts here: the token holder flips, `SessionGate`
 * leaves sign-in for the splash, and push registration starts (never awaited: push is a
 * convenience, not a gate, as in `src/auth.ts`).
 */
export async function verifyCode(challengeId: string, code: string): Promise<VerifyOutcome> {
  let result;
  try {
    result = await rider.POST('/v1/auth/otp/verify', {
      params: { header: CLIENT },
      body: { challenge_id: challengeId, code },
    });
  } catch {
    return { ok: false, kind: 'offline' };
  }
  const { data, error, response } = result;
  if (data) {
    setToken(data.data.access_token, data.data.refresh_token ?? null);
    void registerForPush();
    return { ok: true };
  }
  const body = error as RawError | undefined;
  const errCode = codeOf(body);
  if (errCode === 'OTP_INCORRECT') {
    const details = body?.error?.details as { attempts_remaining?: unknown } | null | undefined;
    const n = Number(details?.attempts_remaining);
    return { ok: false, kind: 'incorrect', attemptsRemaining: Number.isFinite(n) && details?.attempts_remaining != null ? n : null };
  }
  if (errCode === 'OTP_INVALID_OR_EXPIRED') return { ok: false, kind: 'expired' };
  if (response.status === 429 || errCode === 'RATE_LIMITED') return { ok: false, kind: 'locked', retryAfterS: retryAfter(response, body) };
  if (CLOSED.has(errCode)) return { ok: false, kind: 'closed' };
  if (response.status >= 500 || errCode === 'RATE_LIMITER_UNAVAILABLE') return { ok: false, kind: 'unavailable' };
  return { ok: false, kind: 'other', error: errorFrom(response.status, body) };
}

/**
 * Revoke the session on the server, best effort. Call it just before the local sign-out: the
 * bearer is read now, because the sign-out clears the holder before the request goes out.
 */
export async function revokeSession(): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await rider.POST('/v1/auth/logout', { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // Offline: the local sign-out still happens; the session expires on its own.
  }
}

function errorFrom(status: number, body: RawError | undefined): RiderError {
  return toRiderError(new HgApiError(status, body as never));
}
