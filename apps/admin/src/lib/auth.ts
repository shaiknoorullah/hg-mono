/**
 * Email + password (+ TOTP when turned on) sign-in for the admin console.
 *
 * Two-step sign-in is opt-in: `totp_code` is sent only when the user typed one, and an account
 * that has turned it on answers `403 MFA_REQUIRED` without it. `login` calls the contract's `POST /v1/auth/login` through the shared `api`
 * client and stashes the returned access token in the in-memory holder. On web the refresh
 * token comes back as the `hg_rt` cookie, not in the body, so there is nothing else to
 * persist here.
 */
import { api } from './api';
import { setToken } from './token';

export async function login(email: string, password: string, totpCode: string): Promise<void> {
  const { data, error, response } = await api.POST('/v1/auth/login', {
    params: { header: { 'X-HG-Client': 'admin-web' } },
    body: totpCode ? { email, password, totp_code: totpCode } : { email, password },
  });
  if (error || !data) {
    const message =
      (error as { error?: { message?: string } } | undefined)?.error?.message ??
      `Sign-in failed (${response.status})`;
    throw new Error(message);
  }
  setToken(data.data.access_token);
}

export function logout(): void {
  setToken(null);
}
