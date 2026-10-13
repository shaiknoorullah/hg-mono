/**
 * What the sign-in page remembers between visits, in this module's memory only (a reload
 * forgets it, as it forgets the session).
 *
 * - Whether the person signed out ON PURPOSE (`RV/Shell-SignedOut`). This is recorded
 *   explicitly by the Sign out buttons (`markSignedOutOnPurpose`, through `app/signOut.ts`),
 *   never guessed from the session changing: a session that ends under the page (a 401 on a
 *   redesigned or a legacy screen) raises the session-ended dialog instead, and a person who was
 *   not the one to sign out must never read "You signed out of HalalGoes on this device".
 * - The work email of the last sign-in, so the signed-out page starts with it filled in.
 */
import { getSession, subscribeSession } from '../data/session';

let signedOutOnPurpose = false;
let lastEmail = '';

// A new session forgets the last sign-out.
subscribeSession(() => {
  if (getSession().principal !== null) signedOutOnPurpose = false;
});

/** Called by a Sign out button just before the session ends. */
export function markSignedOutOnPurpose(): void {
  signedOutOnPurpose = true;
}

export function wasSignedOutOnPurpose(): boolean {
  return signedOutOnPurpose;
}

export function rememberedEmail(): string {
  return lastEmail;
}

/** Called after a successful staff sign-in, before the session starts. */
export function rememberSignIn(email: string): void {
  lastEmail = email;
  signedOutOnPurpose = false;
}

/** Tests only: forget everything. */
export function resetAuthMemory(): void {
  signedOutOnPurpose = false;
  lastEmail = '';
}

/**
 * "Lost your authenticator app instead?" on the reset page is a plain link to the sign-in
 * page's lost-authenticator help (`RV/SignIn-Forgot` draws a link, not an expander).
 */
export const LOST_AUTHENTICATOR_HREF = '/?help=lost';

/** Read once at first render of the sign-in page: was it opened on the lost-authenticator help? Strips the query. */
export function takeLostAuthenticatorRequest(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('help') !== 'lost') return false;
  params.delete('help');
  const rest = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  return true;
}
