/**
 * The access-token holder for the rider session.
 *
 * Mobile surfaces hold the access token in memory only. A reload signs the rider out, which is
 * acceptable for V0; a future iteration will persist to SecureStore. This module has no imports so
 * both api.ts (which reads the token before every request) and auth.ts (which sets it after
 * verifyOtp) can depend on it without a cycle.
 */
let accessToken: string | null = null;
let refreshToken: string | null = null;
const listeners = new Set<() => void>();

/** The api-client `getToken` hook: the current bearer, or `null` when signed out. */
export function getToken(): string | null {
  return accessToken;
}

/** The native refresh token from sign-in (memory only; expo-secure-store is not a dependency). */
export function getRefreshToken(): string | null {
  return refreshToken;
}

/** Store a rotated token pair without treating it as a sign-in/out event (no auth-gate flicker). */
export function setTokens(access: string, refresh: string | null): void {
  accessToken = access;
  refreshToken = refresh;
}

export function setToken(token: string | null, refresh: string | null = null): void {
  accessToken = token;
  refreshToken = token === null ? null : refresh;
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
