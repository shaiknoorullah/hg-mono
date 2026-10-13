/**
 * The two public calls behind the admin pages our emails link to (issue #329): ask for a
 * reset link, and set a password from one. A staff invitation also sets its first password
 * through `resetPassword` until the invitation flow of #170 exists (#350).
 *
 * The calls, the token checks and the form hooks are shared with the restaurant app in
 * `@hg/ui-web/email-links`; here they are bound to the console's API client. No call here
 * creates a session (#356).
 */
import { emailLinkCalls } from '@hg/ui-web/email-links';
import { api } from './api';

const calls = emailLinkCalls(api);

/** `requestPasswordReset`: the same answer whether or not the account exists. */
export const requestPasswordReset = calls.requestPasswordReset;

/**
 * `resetPassword`: sets the password and signs out every session. An expired, used or
 * unknown link is one generic `400 TOKEN_CONSUMED`, so the page cannot tell them apart.
 */
export const resetPassword = calls.resetPassword;
