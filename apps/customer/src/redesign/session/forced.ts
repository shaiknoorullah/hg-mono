/**
 * Forced full-screen routes (manifest S5): states that replace whatever is open, with no bottom
 * navigation, because the session or the account can no longer be used.
 *
 * They are raised from one place: the redesign API client's error hook, the refresh exchange, the
 * order socket's close code and `verifyOtp.next_route`. Screens never decide them.
 */
import * as React from 'react';

export type ForcedKind =
  /** SUSPENDED, mid-session 403 ACCOUNT_SUSPENDED: "Your account is on hold". */
  | 'on-hold'
  /** BANNED: "This account can't be used". */
  | 'banned'
  /** DELETED / other non-ACTIVE, 403 ACCOUNT_NOT_ACTIVE / ACCOUNT_DEACTIVATED. */
  | 'unavailable'
  /** Update required, or a `next_route` this build does not know. */
  | 'update'
  /** REFRESH_REUSE_DETECTED: "We signed you out to keep your account safe". */
  | 'security'
  /** SESSION_REVOKED, WS close 4401. */
  | 'revoked'
  /** SESSION_EXPIRED. */
  | 'expired';

export interface ForcedRoute {
  kind: ForcedKind;
  /** Raised while placing an order: the blocked screen adds "That order wasn't placed." */
  midCheckout?: boolean;
}

/** Error codes that force a route, and which one. Everything else is the screen's to handle. */
const CODE_TO_KIND: Record<string, ForcedKind> = {
  ACCOUNT_SUSPENDED: 'on-hold',
  ACCOUNT_BANNED: 'banned',
  ACCOUNT_NOT_ACTIVE: 'unavailable',
  ACCOUNT_DEACTIVATED: 'unavailable',
  REFRESH_REUSE_DETECTED: 'security',
  SESSION_REVOKED: 'revoked',
  SESSION_EXPIRED: 'expired',
};

export function forcedKindForCode(code: string | null | undefined): ForcedKind | null {
  if (!code) return null;
  return CODE_TO_KIND[code] ?? null;
}

/** The WebSocket close code the server uses when the session behind a ticket is revoked. */
export const WS_CLOSE_SESSION_REVOKED = 4401;

export function forcedKindForSocketClose(code: number): ForcedKind | null {
  return code === WS_CLOSE_SESSION_REVOKED ? 'revoked' : null;
}

/** Account status from `getCurrentPrincipal` → blocked kind (null when the account is usable). */
export function forcedKindForStatus(status: string | null | undefined): ForcedKind | null {
  switch (status) {
    case 'ACTIVE':
    case undefined:
    case null:
      return null;
    case 'SUSPENDED':
      return 'on-hold';
    case 'BANNED':
      return 'banned';
    default:
      return 'unavailable';
  }
}

let current: ForcedRoute | null = null;
const listeners = new Set<() => void>();

export function raiseForced(route: ForcedRoute): void {
  // The first cause wins: a revoked session that then 401s everywhere stays "revoked".
  if (current) return;
  current = route;
  for (const fn of listeners) fn();
}

/** Leave the forced route (its exit button signs out and returns to sign-in). */
export function clearForced(): void {
  current = null;
  for (const fn of listeners) fn();
}

export function getForced(): ForcedRoute | null {
  return current;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useForcedRoute(): ForcedRoute | null {
  return React.useSyncExternalStore(subscribe, getForced, getForced);
}
