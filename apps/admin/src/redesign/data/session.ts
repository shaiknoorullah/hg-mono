/**
 * The redesign's session store: who is signed in, with which staff role, and whether the
 * session has just ended under the page.
 *
 * The access token itself stays in the legacy holder (`src/lib/token.ts`), in memory only, so
 * legacy screens mounted as route fallbacks see the same session. A reload signs the person out,
 * as it does today: the refresh token is an HttpOnly cookie on the API's origin, which this
 * static bundle cannot read for the CSRF double-submit.
 *
 * A 401 on any call made while signed in does not drop the page. It marks the session ended,
 * and the shell raises the one blocking dialog the console has (`ASS/SessionExpired`,
 * `ASS/SessionRevoked`); the list or draft underneath stays where it was.
 */
import type { Schema } from '@hg/api-client';

import { getToken, setToken, subscribe as subscribeToken } from '../../lib/token';

export type StaffRole = 'SUPPORT_AGENT' | 'ADMIN' | 'SUPER_ADMIN';
export type Principal = Schema['Principal'];

/** Why the session ended under the page. `null` while it is live or signed out on purpose. */
export type SessionEnd = 'expired' | 'revoked' | null;

interface SessionState {
  readonly principal: Principal | null;
  readonly ended: SessionEnd;
}

let state: SessionState = { principal: null, ended: null };
const listeners = new Set<() => void>();

function emit(next: SessionState): void {
  state = next;
  for (const fn of listeners) fn();
}

// The token cleared by anyone other than this module (a legacy fallback screen's 401 handler in
// `src/lib/api.ts`) is a session that ended under the page, not a sign-out: the principal is kept
// and the session-ended dialog is raised over the page. `endSession` and `markSessionEnded`
// update the state before they clear the token, so their own clears never reach this branch.
subscribeToken(() => {
  if (getToken() === null && state.principal !== null && state.ended === null) {
    emit({ principal: state.principal, ended: 'expired' });
  }
});

export function getSession(): SessionState {
  return state;
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called with a fresh `SessionGrant` after `login`. */
export function startSession(accessToken: string, principal: Principal): void {
  setToken(accessToken);
  emit({ principal, ended: null });
}

/**
 * Ends the session in this tab: the Sign out button, the dialog's Sign out, or after sign out
 * everywhere. Whether it was on purpose is recorded by the caller (`auth/memory.ts`).
 */
export function endSession(): void {
  emit({ principal: null, ended: null });
  setToken(null);
}

/**
 * The server refused the session mid-page. The principal is kept so the page underneath keeps
 * its role-shaped layout behind the dialog; every call fails until the person signs in again.
 *
 * The dead access token is dropped. Kept, the client would send it as `Authorization` on every
 * request, the dialog's own `login` included, and the server rejects a request carrying a bad
 * bearer (401 AUTHENTICATION_REQUIRED) before any handler runs, public ones too.
 */
export function markSessionEnded(reason: Exclude<SessionEnd, null>): void {
  if (state.principal === null || state.ended !== null) return;
  emit({ principal: state.principal, ended: reason });
  setToken(null);
}

/** The highest staff role the principal holds, or `null` when it holds none. */
export function staffRoleOf(principal: Principal | null): StaffRole | null {
  if (!principal) return null;
  const roles = principal.roles.map((grant) => grant.role);
  if (roles.includes('SUPER_ADMIN')) return 'SUPER_ADMIN';
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('SUPPORT_AGENT')) return 'SUPPORT_AGENT';
  return null;
}

/** The role label the sidebar footer shows ("Signed in as Super admin"). */
export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  SUPPORT_AGENT: 'Support',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super admin',
};
