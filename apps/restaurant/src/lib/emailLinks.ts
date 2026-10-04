/**
 * The four public calls behind the pages our emails link to (issue #329): confirm an
 * email, send a new confirmation link, ask for a reset link, and set a new password.
 *
 * Each call returns an outcome the page switches on, never a thrown error, so every page
 * draws the same states: the link no longer works, the password was refused, too many
 * attempts, or HalalGoes could not be reached.
 *
 * The link token is a credential. It is taken out of the address bar at boot
 * (`linkToken.ts`), kept only in memory, and sent only to our own API in a POST body.
 * Nothing here logs it, and no call here creates a session: `verifyEmail` still answers
 * with one, which is dropped (#356).
 */
import { useEffect, useState } from 'react';
import { api } from './api';
import { linkTokenFor } from './linkToken';

/** Why a call did not succeed, in the terms a page shows. */
export type LinkFailure =
  /** The link was used already (only `verifyEmail` can tell this apart). */
  | { kind: 'used' }
  /** The link expired, was never valid, or (for `resetPassword`) was used already. */
  | { kind: 'expired' }
  /** `BREACHED_PASSWORD`: the new password is on the breached-password list. */
  | { kind: 'breached' }
  /** `VALIDATION_FAILED` on the password: shorter than 12 or longer than 256. */
  | { kind: 'invalid-password' }
  /** `VALIDATION_FAILED` on the email address. */
  | { kind: 'invalid-email' }
  /** 429: wait until `retryAt`. */
  | { kind: 'rate-limited'; retryAt: Date }
  /** No answer, a dropped connection or a 5xx. Retrying is safe. */
  | { kind: 'unreachable' };

export type LinkOutcome<T = undefined> = { ok: true; data: T } | ({ ok: false } & LinkFailure);

/**
 * The token format the API accepts (`minLength: 32`, `maxLength: 128`, base64url). A link
 * cut short by an email client fails this before anything is sent.
 */
export function isWellFormedToken(token: string | null): token is string {
  return token !== null && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

/** The contract's `Password`: 12 to 256 characters. The server counts bytes for the maximum. */
export const PASSWORD_MIN = 12;
export function passwordTooLong(password: string): boolean {
  return new TextEncoder().encode(password).length > 256;
}

const TIME_12H = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });

/** A 12-hour clock time, e.g. "2:05 p.m.". */
export function formatClockTime(at: Date): string {
  return TIME_12H.format(at);
}

/** `Retry-After` as seconds or an HTTP date; one minute when absent or unreadable. */
function retryAtFrom(response: Response): Date {
  const raw = response.headers.get('Retry-After')?.trim() ?? '';
  if (/^\d+$/.test(raw)) return new Date(Date.now() + Number(raw) * 1000);
  const at = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(at) ? new Date(at) : new Date(Date.now() + 60_000);
}

interface RawResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Turns an `openapi-fetch` call into an outcome. `mapCode` names the failures specific to
 * one operation; everything it does not name is "unreachable" for a 5xx and "expired" for
 * any other 4xx, so an unknown code still lands on a screen with a way forward.
 */
async function settle<T, D>(
  call: () => Promise<RawResult<T>>,
  pick: (data: T | undefined) => D,
  mapCode: (code: string, status: number) => LinkFailure | null,
): Promise<LinkOutcome<D>> {
  let result: RawResult<T>;
  try {
    result = await call();
  } catch {
    return { ok: false, kind: 'unreachable' };
  }
  const { response } = result;
  if (response.ok) return { ok: true, data: pick(result.data) };
  if (response.status === 429) return { ok: false, kind: 'rate-limited', retryAt: retryAtFrom(response) };
  if (response.status >= 500) return { ok: false, kind: 'unreachable' };
  const code = (result.error as { error?: { code?: string } } | undefined)?.error?.code ?? '';
  return { ok: false, ...(mapCode(code, response.status) ?? { kind: 'expired' }) };
}

/**
 * `verifyEmail`: confirms the email. The API also issues a session in its answer; that is
 * dropped here on purpose, because opening a link must never sign anyone in (#356).
 */
export function verifyEmail(token: string): Promise<LinkOutcome> {
  return settle(
    () => api.POST('/v1/auth/email/verify', { body: { token } }),
    () => undefined,
    (code) => (code === 'VERIFICATION_TOKEN_USED' ? { kind: 'used' } : null),
  );
}

/** The email-only calls answer 2xx whatever the account; a 4xx is the address itself. */
function emailFailure(_code: string, status: number): LinkFailure {
  return status === 422 ? { kind: 'invalid-email' } : { kind: 'unreachable' };
}

/** `resendEmailVerification`: the same answer whether or not the account exists. */
export function resendVerification(email: string): Promise<LinkOutcome> {
  return settle(
    () => api.POST('/v1/auth/email/resend', { body: { email } }),
    () => undefined,
    emailFailure,
  );
}

/** `requestPasswordReset`: the same answer whether or not the account exists. */
export function requestPasswordReset(email: string): Promise<LinkOutcome> {
  return settle(
    () => api.POST('/v1/auth/password/forgot', { body: { email } }),
    () => undefined,
    emailFailure,
  );
}

/**
 * `resetPassword`: sets the password and signs out every session. An expired, used or
 * unknown link is one generic `400 TOKEN_CONSUMED`, so the page cannot tell them apart.
 */
export function resetPassword(token: string, newPassword: string): Promise<LinkOutcome> {
  return settle(
    () => api.POST('/v1/auth/password/reset', { body: { token, new_password: newPassword } }),
    () => undefined,
    (code, status) => {
      if (code === 'BREACHED_PASSWORD') return { kind: 'breached' };
      if (status === 422) return { kind: 'invalid-password' };
      return null;
    },
  );
}

/** The token this page's email link carried, captured at boot (`linkToken.ts`). */
export function useLinkToken(path: string): string | null {
  const [token] = useState<string | null>(() => linkTokenFor(path));
  return token;
}

/**
 * A 429's wait: `until` is the time the server allows another try, and clears itself then,
 * so the disabled button comes back without a reload. The page names the time once (a
 * 12-hour clock time), rather than counting down every second.
 */
export function useRetryWindow(): { until: Date | null; start: (at: Date) => void } {
  const [until, setUntil] = useState<Date | null>(null);
  useEffect(() => {
    if (!until) return;
    const timer = setTimeout(() => setUntil(null), Math.max(0, until.getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  return { until, start: setUntil };
}
