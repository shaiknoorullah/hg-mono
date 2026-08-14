/**
 * Email + password sign-in for the operator app.
 *
 * `login` calls the contract's `POST /v1/auth/login` (§P-03, `operationId: login`) through
 * the shared `api` client — which already stamps the `X-HG-Client: restaurant-web` header the
 * endpoint requires — and stashes the returned access token in the in-memory holder. On web
 * the refresh token comes back as the `hg_rt` cookie, not in the body, so there is nothing
 * else to persist here.
 */
import { api } from './api';
import { setToken } from './token';

export async function login(email: string, password: string): Promise<void> {
  const { data, error, response } = await api.POST('/v1/auth/login', {
    params: { header: { 'X-HG-Client': 'restaurant-web' } },
    body: { email, password },
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
