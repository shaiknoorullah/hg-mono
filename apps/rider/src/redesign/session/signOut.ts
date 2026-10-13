/**
 * Signing out on purpose vs. being signed out. A rider who taps "Sign out" sees the plain
 * sign-in screen; a session that ended under them (refresh failed, revoked) sees
 * `SignIn-Phone-SignedOut` ("you were signed out"). The outbox is never emptied either way.
 */
import { logout } from '../../auth';

let voluntary = false;

export function signOut(): void {
  voluntary = true;
  logout();
}

/** Read once when the session ends: was it the rider's own tap? Resets after reading. */
export function consumeVoluntarySignOut(): boolean {
  const v = voluntary;
  voluntary = false;
  return v;
}
