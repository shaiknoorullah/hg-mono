/**
 * Literal answers for sign-in states the fixture set lacks, each derived from a real fixture with
 * the smallest change (mockApi rule: never invent a shape). The missing fixtures are filed as
 * fixture requests in the WP1 PR:
 *
 * - `error_otp_incorrect_attempts_2` / `_attempts_0`: `error_otp_incorrect` with
 *   `details.attempts_remaining` (the contract's verifyOtp description; the backend sends it).
 * - `error_otp_invalid_or_expired`: verifyOtp `400 OTP_INVALID_OR_EXPIRED`.
 * - `error_otp_rate_limited_with_retry`: `error_rate_limited` with `details.retry_after_seconds`.
 * - `error_invalid_phone`: requestOtp `422 INVALID_PHONE`.
 * - `error_service_unavailable`: requestOtp `503 RATE_LIMITER_UNAVAILABLE` (manifest §6 list).
 * - `error_account_not_active`: `403 ACCOUNT_NOT_ACTIVE` (manifest §6 list).
 * - `otp_challenge_resend_open`: `otp_challenge` with `resend_after_s: 0`.
 * - `public_config_phone_support_off`: supplied by #312, not merged yet.
 */
import { payload, type Literal } from '../../test/mockApi';

function errorFrom(scenario: string, status: number, code: string, details?: unknown): Literal {
  const body = payload(scenario);
  body.error.code = code;
  if (details !== undefined) body.error.details = details;
  return { status, body };
}

export const otpIncorrect = (attemptsRemaining: number): Literal =>
  errorFrom('error_otp_incorrect', 401, 'OTP_INCORRECT', { attempts_remaining: attemptsRemaining });

export const otpExpired = (): Literal => errorFrom('error_otp_incorrect', 400, 'OTP_INVALID_OR_EXPIRED');

export const rateLimited = (retryAfterSeconds: number): Literal =>
  errorFrom('error_rate_limited', 429, 'RATE_LIMITED', { retry_after_seconds: retryAfterSeconds });

export const invalidPhone = (): Literal => errorFrom('error_validation_failed', 422, 'INVALID_PHONE');

export const unavailable = (): Literal => errorFrom('error_internal_error', 503, 'RATE_LIMITER_UNAVAILABLE');

export const accountNotActive = (): Literal => errorFrom('error_forbidden', 403, 'ACCOUNT_NOT_ACTIVE');

export const challenge = (over: Record<string, unknown> = {}): Literal => ({
  status: 200,
  body: { data: { ...payload('otp_challenge'), ...over } },
});

export const config = (over: Record<string, unknown> = {}): Literal => ({
  status: 200,
  body: { data: { ...payload('public_config'), ...over } },
});

export const supportOff = (): Literal => config({ support_enabled: false, support_phone_e164: null, support_hours: null });

export const riderMe = (over: Record<string, unknown>): Literal => ({
  status: 200,
  body: { data: { ...payload('rider_me'), ...over } },
});

/** Price-shaped keys no sign-in request may carry (CLAUDE.md invariant 1). */
export function hasPriceField(body: unknown): boolean {
  return /cents|price|amount|total/i.test(JSON.stringify(body ?? {}));
}
