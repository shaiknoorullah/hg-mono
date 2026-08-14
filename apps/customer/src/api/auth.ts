/**
 * Phone OTP sign-in for the customer app.
 *
 * `requestOtp` opens a challenge (POST /v1/auth/otp/request); `verifyOtp` consumes it and
 * stashes the returned access token in the in-memory holder. Both stamp the contract's
 * X-HG-Client header at the call site as the operation requires.
 */
import { api } from './client';
import { setToken } from './token';

/** Request a phone OTP challenge. Returns the challenge_id to pass to verifyOtp. */
export async function requestOtp(phone: string): Promise<string> {
  const { data, error, response } = await api.POST('/v1/auth/otp/request', {
    params: { header: { 'X-HG-Client': 'customer-app' } },
    body: { phone_e164: phone, purpose: 'SIGN_IN' },
  });
  if (error || !data) {
    const message =
      (error as { error?: { message?: string } } | undefined)?.error?.message ??
      `OTP request failed (${response.status})`;
    throw new Error(message);
  }
  return data.data.challenge_id;
}

/** Verify the OTP code and sign the customer in. */
export async function verifyOtp(challengeId: string, code: string): Promise<void> {
  const { data, error, response } = await api.POST('/v1/auth/otp/verify', {
    params: { header: { 'X-HG-Client': 'customer-app' } },
    body: { challenge_id: challengeId, code },
  });
  if (error || !data) {
    const message =
      (error as { error?: { message?: string } } | undefined)?.error?.message ??
      `OTP verification failed (${response.status})`;
    throw new Error(message);
  }
  setToken(data.data.access_token);
}

export function logout(): void {
  setToken(null);
}
