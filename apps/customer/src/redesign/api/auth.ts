/**
 * Phone sign-in for the customer redesign (ported from #635 `api/auth.ts` onto the redesign API
 * client, so a 403 `ACCOUNT_SUSPENDED` from `verifyOtp` raises its forced route like any other
 * call, and a transport failure marks the app offline).
 *
 * - `requestOtp` opens (or re-sends) a challenge. `verifyOtp` consumes it, holds the tokens and
 *   hands the `SessionGrant` back so the sign-in flow routes on `principal.next_route`.
 * - Every failure becomes an `AuthFailure` the screens branch on. Clients branch on the contract's
 *   `ErrorCode` and status, never on `error.message`, so no server wording reaches the customer.
 * - Waits are anchored to the server: a 429's `Retry-After` and a challenge's `resend_after_s`
 *   count from the response's `Date` header when it has one, else from when it arrived. There is
 *   no client-side 15-minute timer (manifest §5 G40).
 * - `logout` always works on this phone: the session is cleared at once and the server is told
 *   best-effort; if that cannot reach the server it is retried when the phone is back online, and
 *   the signed-out screen says so (`SI/Main-signedout`, pending variant).
 */
import * as React from 'react';
import type { Schema } from '@hg/api-client';

import { disablePush, enablePush } from '../../api/push';
import { getRefreshToken, getToken, setToken } from '../../api/token';
import { getNow } from '../lib/now';
import { noteSignedOut, type SignedOutNote } from '../session/session';
import { api, postDirect } from './client';

export type OtpChallenge = Schema['OtpChallenge'];
export type SessionGrant = Schema['SessionGrant'];
export type NextRoute = Schema['NextRoute'];

/** What went wrong, in the terms the sign-in screens draw. */
export type AuthFailure =
  /** 422 `INVALID_PHONE` (or a validation failure on the number). */
  | { kind: 'invalid_phone' }
  /** 422 `UNSUPPORTED_COUNTRY`: not a Canadian number. */
  | { kind: 'unsupported_country' }
  /** 429: wait until `at` + `retryAfterS` (Retry-After, else `details.retry_after_seconds`). */
  | { kind: 'rate_limited'; retryAfterS: number; at: number }
  /** 503 `RATE_LIMITER_UNAVAILABLE`: the problem is on our side; no code can be sent or checked. */
  | { kind: 'unavailable' }
  /** `OTP_INCORRECT`; `attemptsRemaining` is `details.attempts_remaining` when the server sends it. */
  | { kind: 'incorrect'; attemptsRemaining: number | null }
  /** `OTP_INVALID_OR_EXPIRED`: the code ran out, was used, or the challenge is spent. */
  | { kind: 'expired' }
  /** 403 from verify: the account cannot sign in (its forced route is already raised). */
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

/** The server's clock for this response (its `Date` header), else the app's clock on arrival. */
export function serverTimeOf(response: Response): number {
  const header = response.headers.get('Date');
  const parsed = header ? Date.parse(header) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : getNow();
}

function retryAfterOf(response: Response, body: ErrorBody | undefined): number {
  const header = Number(response.headers.get('Retry-After'));
  if (Number.isFinite(header) && header > 0) return header;
  const details = body?.error?.details as { retry_after_seconds?: unknown } | undefined;
  const fromBody = Number(details?.retry_after_seconds);
  return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : 60;
}

export function classifyAuthError(response: Response, body: ErrorBody | undefined): AuthFailure {
  const code = body?.error?.code ?? '';
  if (response.status === 429) {
    return { kind: 'rate_limited', retryAfterS: retryAfterOf(response, body), at: serverTimeOf(response) };
  }
  if (code === 'RATE_LIMITER_UNAVAILABLE' || response.status === 503) return { kind: 'unavailable' };
  if (code === 'INVALID_PHONE') return { kind: 'invalid_phone' };
  if (code === 'UNSUPPORTED_COUNTRY') return { kind: 'unsupported_country' };
  if (code === 'OTP_INCORRECT') {
    const details = body?.error?.details as { attempts_remaining?: unknown } | undefined;
    const raw = details?.attempts_remaining;
    const left = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : Number.NaN;
    return { kind: 'incorrect', attemptsRemaining: Number.isFinite(left) ? left : null };
  }
  if (code === 'OTP_INVALID_OR_EXPIRED') return { kind: 'expired' };
  if (response.status === 403) return { kind: 'blocked', code };
  if (code === 'VALIDATION_FAILED' && response.status === 422) return { kind: 'invalid_phone' };
  return { kind: 'server', status: response.status };
}

/** A challenge, stamped with the server time it was sent (OtpChallenge has no `created_at`). */
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
  if (error || !data) throw new AuthError(classifyAuthError(response, error as ErrorBody | undefined));
  return { challenge: data.data, receivedAt: serverTimeOf(response) };
}

/**
 * Verify the code. On success the session is live (tokens held in memory, push enabled in the
 * background) and the grant comes back for routing. Call `beginVerify()` first so the session
 * store leaves the landing to the sign-in flow.
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
  if (error || !data) throw new AuthError(classifyAuthError(response, error as ErrorBody | undefined));
  setToken(data.data.access_token, data.data.refresh_token ?? null);
  // Fire and forget: push must never hold up sign-in (src/api/push.ts).
  void enablePush();
  return data.data;
}

// ---------------------------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------------------------

/**
 * A sign-out the server has not heard about yet (memory only): the tokens the phone held, so the
 * session can still be revoked after the 15-minute access token has run out.
 */
interface PendingLogout {
  access: string;
  refresh: string | null;
}

let pendingLogout: PendingLogout | null = null;
const pendingListeners = new Set<() => void>();

function setPending(next: PendingLogout | null): void {
  pendingLogout = next;
  for (const fn of pendingListeners) fn();
}

/** The session is already over on the server: nothing left to revoke. */
const SESSION_GONE = new Set(['SESSION_REVOKED', 'SESSION_EXPIRED', 'REFRESH_REUSE_DETECTED']);

/**
 * Revoke the session on the server. Done only on a 2xx, or when the server says the session is
 * already gone. An access token that has simply run out (401 AUTHENTICATION_REQUIRED) is exchanged
 * once with the kept refresh token and the logout is sent again with the new one. A transport
 * failure or a 5xx keeps the sign-out pending, with whichever tokens are current, for later.
 *
 * Straight through the transport (`postDirect`), not the shared client: the session is already
 * cleared on this phone, so a 401 here must neither refresh it back nor raise a forced route.
 */
async function tellServer(p: PendingLogout): Promise<void> {
  let current = p;
  const done = () => {
    if (pendingLogout === p || pendingLogout === current) setPending(null);
  };
  try {
    let res = await postDirect('/v1/auth/logout', { token: current.access });
    if (res.status === 401 && !SESSION_GONE.has(res.code ?? '') && current.refresh) {
      const refreshed = await postDirect('/v1/auth/refresh', { body: { refresh_token: current.refresh } });
      const grant = refreshed.data as { access_token?: string; refresh_token?: string | null } | null;
      if (refreshed.status >= 500) {
        setPending(current);
        return;
      }
      if (refreshed.status >= 300 || !grant?.access_token) {
        // Refused (revoked, expired or reused): the session is already over.
        done();
        return;
      }
      current = { access: grant.access_token, refresh: grant.refresh_token ?? current.refresh };
      res = await postDirect('/v1/auth/logout', { token: current.access });
    }
    if (res.status >= 500) setPending(current);
    else done();
  } catch {
    setPending(current);
  }
}

/**
 * Sign this phone out. It always works: the session is cleared at once, whatever the network
 * does, and the server is asked to revoke it best-effort. The refresh token is kept aside first,
 * because clearing the session drops it.
 */
export function logout(): void {
  const token = getToken();
  const refresh = getRefreshToken();
  disablePush(token);
  setToken(null);
  if (token) void tellServer({ access: token, refresh });
}

/** Sign out to the signed-out screen ("You're signed out", or the "Not you?" variant). */
export function signOut(note: SignedOutNote = 'signedOut'): void {
  noteSignedOut(note);
  logout();
}

/** Back online: finish a sign-out the server has not heard about. */
export function retryPendingLogout(): void {
  if (pendingLogout) void tellServer(pendingLogout);
}

export function isLogoutPending(): boolean {
  return pendingLogout !== null;
}

function subscribePending(fn: () => void): () => void {
  pendingListeners.add(fn);
  return () => pendingListeners.delete(fn);
}

export function useLogoutPending(): boolean {
  return React.useSyncExternalStore(subscribePending, isLogoutPending, isLogoutPending);
}

/** Tests only. */
export function resetAuthForTests(): void {
  setPending(null);
}
