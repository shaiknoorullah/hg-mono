/**
 * The four public calls behind the pages our emails link to (issue #329): confirm an
 * email, send a new confirmation link, ask for a reset link, and set a new password.
 *
 * The calls, the token checks and the form hooks are shared with the admin console in
 * `@hg/ui-web/email-links`; here they are bound to this app's API client. No call here
 * creates a session: `verifyEmail` still answers with one, which is dropped (#356).
 */
import { emailLinkCalls } from '@hg/ui-web/email-links';
import { api } from './api';

const calls = emailLinkCalls(api);

/**
 * `verifyEmail`: confirms the email. The API also issues a session in its answer; that is
 * dropped on purpose, because opening a link must never sign anyone in (#356).
 */
export const verifyEmail = calls.verifyEmail;

/** `resendEmailVerification`: the same answer whether or not the account exists. */
export const resendVerification = calls.resendVerification;

/** `requestPasswordReset`: the same answer whether or not the account exists. */
export const requestPasswordReset = calls.requestPasswordReset;

/**
 * `resetPassword`: sets the password and signs out every session. An expired, used or
 * unknown link is one generic `400 TOKEN_CONSUMED`, so the page cannot tell them apart.
 */
export const resetPassword = calls.resetPassword;
