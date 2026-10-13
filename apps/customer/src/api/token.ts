/**
 * The access-token holder for the customer session.
 *
 * Mobile surfaces hold the tokens in memory only. Closing the app signs the customer out
 * (expo-secure-store is not a dependency yet; persisting there is the follow-up). While the app
 * runs, `client.ts` uses the refresh token to renew the 15-minute access token. This module
 * has no imports so both api.ts (which reads the token before every request) and auth.ts
 * (which sets it after verifyOtp) can depend on it without a cycle.
 */
let accessToken: string | null = null;
let refreshToken: string | null = null;
const listeners = new Set<() => void>();

/** The api-client `getToken` hook: the current bearer, or `null` when signed out. */
export function getToken(): string | null {
  return accessToken;
}

/** The native refresh token (`hgrt_…`), kept beside the access token; memory only. */
export function getRefreshToken(): string | null {
  return refreshToken;
}

export function setToken(token: string | null, refresh?: string | null): void {
  accessToken = token;
  // A null access token (sign-out) always drops the refresh token with it.
  if (token === null) refreshToken = null;
  else if (refresh !== undefined) refreshToken = refresh;
  for (const fn of listeners) fn();
}

export function isAuthed(): boolean {
  return accessToken !== null;
}

/** Subscribe to sign-in/sign-out events; returns an unsubscribe. Drives the App auth gate. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
