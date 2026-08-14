/**
 * The access-token holder for the operator session.
 *
 * Web surfaces hold the access token **in memory only** (the contract keeps the refresh
 * token in the `hg_rt` HttpOnly cookie); a reload therefore signs the operator out, which is
 * the intended behaviour for a shared back-of-house terminal. This module has no imports so
 * both `api.ts` (which reads the token before every request) and `auth.ts` (which sets it
 * after `login`) can depend on it without a cycle.
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

/** Subscribe to sign-in/sign-out; returns an unsubscribe. Drives the App auth gate. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
