/**
 * Email + password + TOTP sign-in for the admin console.
 *
 * Admin MFA is mandatory — `POST /v1/auth/login` returns 401 MFA_REQUIRED if `totp_code`
 * is absent. `login` calls the contract's `POST /v1/auth/login` through the shared `api`
 * client and stashes the returned access token in the in-memory holder. On web the refresh
 * token comes back as the `hg_rt` cookie, not in the body, so there is nothing else to
 * persist here.
 */
import { api } from './api';
import { setToken } from './token';

export async function login(email: string, password: string, totpCode: string): Promise<void> {
  const { data, error, response } = await api.POST('/v1/auth/login', {
    params: { header: { 'X-HG-Client': 'admin-web' } },
    body: { email, password, totp_code: totpCode },
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
