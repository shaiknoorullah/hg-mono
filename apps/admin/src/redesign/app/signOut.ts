/**
 * Signing out on purpose, from the sidebar's Sign out or the session-ended dialog's Sign out.
 *
 * Records the deliberate sign-out first (the sign-in page then shows `RV/Shell-SignedOut`), then
 * forgets what belonged to that person in this tab (queue counts, unsent drafts) and ends the
 * session. The caller navigates to `/` before calling this so the next person starts at their
 * own landing page.
 */
import { markSignedOutOnPurpose } from '../auth/memory';
import { clearAllDrafts } from '../data/drafts';
import { endSession } from '../data/session';
import { resetQueueDepth } from '../realtime/queueDepth';

export function finishSignOut(): void {
  markSignedOutOnPurpose();
  resetQueueDepth();
  clearAllDrafts();
  endSession();
}
