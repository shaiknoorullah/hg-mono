/**
 * The access-token holder for the customer session.
 *
 * Mobile surfaces hold the access token in memory only. A reload signs the customer out,
 * which is acceptable for V0; a future iteration will persist to SecureStore. This module
 * has no imports so both api.ts (which reads the token before every request) and auth.ts
 * (which sets it after verifyOtp) can depend on it without a cycle.
 */
let accessToken: string | null = null;
const listeners = new Set<() => void>();

/** The api-client `getToken` hook: the current bearer, or `null` when signed out. */
export function getToken(): string | null {
  return accessToken;
}

export function setToken(token: string | null): void {
  accessToken = token;
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
