/**
 * Phone OTP sign-in for the customer app.
 *
 * `requestOtp` opens a challenge (POST /v1/auth/otp/request); `verifyOtp` consumes it, stashes the
 * returned tokens in the in-memory holder and hands the `SessionGrant` back so the sign-in flow can
 * route on `principal.next_route` (the server decides where a customer lands, not the app). Both
 * stamp the contract's X-HG-Client header at the call site as the operation requires.
 *
 * Every failure is classified into an `AuthFailure` the screens branch on. Clients branch on the
 * contract's `ErrorCode` and status, never on `error.message` (contracts/openapi.yaml,
 * `ErrorEnvelope`), so no server wording reaches the customer.
 */
import type { Schema } from '@hg/api-client';

import { api } from './client';
import { disablePush, enablePush } from './push';
import { getToken, setToken } from './token';

export type OtpChallenge = Schema['OtpChallenge'];
export type SessionGrant = Schema['SessionGrant'];
export type NextRoute = Schema['NextRoute'];

/** What went wrong, in the terms the sign-in screens draw. */
export type AuthFailure =
  /** 422 INVALID_PHONE or a validation failure on the number. */
  | { kind: 'invalid_phone' }
  /** 429: wait `retryAfterS` seconds (Retry-After, else `details.retry_after_seconds`). */
  | { kind: 'rate_limited'; retryAfterS: number }
  /** 503 RATE_LIMITER_UNAVAILABLE: the problem is on our side; no code can be sent or checked. */
  | { kind: 'unavailable' }
  /** OTP_INCORRECT; `attemptsRemaining` is `details.attempts_remaining` when the server sends it. */
  | { kind: 'incorrect'; attemptsRemaining: number | null }
  /** OTP_INVALID_OR_EXPIRED: the code ran out, was used, or the challenge is spent. */
  | { kind: 'expired' }
  /** 403 from verify: the account cannot sign in (ACCOUNT_SUSPENDED, ACCOUNT_NOT_ACTIVE, …). */
  | { kind: 'blocked'; code: string }
  /** No response at all: offline, DNS, a dropped connection. */
  | { kind: 'network' }
  /** Any other non-2xx. */
  | { kind: 'server'; status: number };

export class AuthError extends Error {
  readonly failure: AuthFailure;
  constructor(failure: AuthFailure) {
    super(`auth: ${failure.kind}`);
    this.name = 'AuthError';
    this.failure = failure;
  }
}

/** The failure an unknown throw stands for; anything that is not an `AuthError` is a network drop. */
export function authFailureOf(e: unknown): AuthFailure {
  return e instanceof AuthError ? e.failure : { kind: 'network' };
}

interface ErrorBody {
  error?: { code?: string; details?: unknown };
}

function retryAfterOf(response: Response, body: ErrorBody | undefined): number {
  const header = Number(response.headers.get('Retry-After'));
  if (Number.isFinite(header) && header > 0) return header;
  const details = body?.error?.details as { retry_after_seconds?: unknown } | undefined;
  const fromBody = Number(details?.retry_after_seconds);
  return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : 60;
}

function classify(response: Response, body: ErrorBody | undefined): AuthFailure {
  const code = body?.error?.code ?? '';
  if (response.status === 429) return { kind: 'rate_limited', retryAfterS: retryAfterOf(response, body) };
  if (code === 'RATE_LIMITER_UNAVAILABLE' || response.status === 503) return { kind: 'unavailable' };
  if (code === 'INVALID_PHONE') return { kind: 'invalid_phone' };
  if (code === 'OTP_INCORRECT') {
    const details = body?.error?.details as { attempts_remaining?: unknown } | undefined;
    const left = Number(details?.attempts_remaining);
    return { kind: 'incorrect', attemptsRemaining: Number.isFinite(left) ? left : null };
  }
  if (code === 'OTP_INVALID_OR_EXPIRED') return { kind: 'expired' };
  if (response.status === 403) return { kind: 'blocked', code };
  if (code === 'VALIDATION_FAILED' && response.status === 422) return { kind: 'invalid_phone' };
  return { kind: 'server', status: response.status };
}

/** A challenge, stamped with when this phone received it (OtpChallenge has no created_at). */
export interface ReceivedChallenge {
  challenge: OtpChallenge;
  receivedAt: number;
}

/** Request (or re-send) a phone OTP. `phoneE164` is the full `+1…` number. */
export async function requestOtp(phoneE164: string): Promise<ReceivedChallenge> {
  let result;
  try {
    result = await api.POST('/v1/auth/otp/request', {
      params: { header: { 'X-HG-Client': 'customer-app' } },
      body: { phone_e164: phoneE164, purpose: 'SIGN_IN' },
    });
  } catch {
    throw new AuthError({ kind: 'network' });
  }
  const { data, error, response } = result;
  if (error || !data) throw new AuthError(classify(response, error as ErrorBody | undefined));
  return { challenge: data.data, receivedAt: Date.now() };
}

/**
 * Verify the code. On success the session is live (tokens held in memory, push enabled in the
 * background) and the grant comes back for routing.
 */
export async function verifyOtp(challengeId: string, code: string): Promise<SessionGrant> {
  let result;
  try {
    result = await api.POST('/v1/auth/otp/verify', {
      params: { header: { 'X-HG-Client': 'customer-app' } },
      body: { challenge_id: challengeId, code },
    });
  } catch {
    throw new AuthError({ kind: 'network' });
  }
  const { data, error, response } = result;
  if (error || !data) throw new AuthError(classify(response, error as ErrorBody | undefined));
  setToken(data.data.access_token, data.data.refresh_token ?? null);
  // Fire and forget: push must never hold up sign-in (src/api/push.ts).
  void enablePush();
  return data.data;
}

/**
 * Sign this phone out. It always works: the local session is cleared at once, whatever the
 * network does, and the server is asked to revoke the session best-effort (the Sign-in canvas,
 * "Sign out always works on this phone").
 */
export function logout(): void {
  const token = getToken();
  disablePush(token);
  if (token) {
    // Its own request, carrying the token read before it is cleared; a failure changes nothing
    // on this phone (POST /v1/auth/logout is idempotent server-side).
    void fetchLogout(token);
  }
  setToken(null);
}

async function fetchLogout(token: string): Promise<void> {
  try {
    await api.POST('/v1/auth/logout', { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    /* offline: the access token lapses on its own within 15 minutes */
  }
}

/** POST /v1/auth/email/resend — the verification link for the customer's email, again. */
export async function resendEmailVerification(email: string): Promise<void> {
  let result;
  try {
    result = await api.POST('/v1/auth/email/resend', { body: { email } });
  } catch {
    throw new AuthError({ kind: 'network' });
  }
  if (result.error) throw new AuthError(classify(result.response, result.error as ErrorBody));
}
