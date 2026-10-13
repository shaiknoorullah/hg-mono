/**
 * The pages our emails link to (issue #329): the restaurant app's verify-email and
 * reset-password pages, and the admin console's reset-password and accept-invite pages.
 *
 * Each app keeps its own routes, screens and copy. What they do alike lives here once: the
 * public calls (`emailLinkCalls`, bound to the app's API client), the token checks, and the
 * hooks behind the forms. The token capture that runs at boot is `@hg/ui-web/link-token`, a
 * separate entry that imports nothing.
 */

export {
  PASSWORD_MIN,
  emailLinkCalls,
  formatClockTime,
  isWellFormedToken,
  passwordTooLong,
} from './calls.js';
export type { EmailLinkCalls, LinkFailure, LinkOutcome } from './calls.js';

export { useLinkToken, useRequestLinkForm, useRetryWindow, useSetPasswordForm } from './hooks.js';
export type { RequestLinkForm, RetryWindow, SetPasswordForm, SetPasswordFormOptions } from './hooks.js';
