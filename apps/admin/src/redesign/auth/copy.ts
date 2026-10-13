/**
 * Words for the public auth pages (sign in, forgotten password, accept invite).
 *
 * Lifted verbatim from the boards: `RV/Main`, `RV/SignIn-Errors`, `RV/SignIn-Help`,
 * `RV/SignIn-Forgot`, `RV/Shell-SignedOut` and the `STF/Accept*` / `STF/Session*` boards.
 * Strings marked `D1/Q3` were made false by owner decision D1 (PR #623: two-step sign-in is
 * opt-in for staff) and are rewritten to neutral, true wording until the owner approves
 * them (manifest §7.2 Q3). `[ON-CALL NAME]` and `[ON-CALL PHONE]` stay placeholders (Q12).
 */
import { formatTime } from '../data/format';

export const OPERATIONS = 'Operations';

export const SIGN_IN = {
  title: 'Sign in',
  /** D1/Q3: was "For HalalGoes staff. Every staff account signs in with a password and a code from an authenticator app." */
  intro: 'For HalalGoes staff. Sign in with your work email and password.',
  email: 'Work email',
  password: 'Password',
  code: 'Authentication code',
  codeHelper: '6 digits from your authenticator app. The code changes every 30 seconds.',
  codeError: 'Enter the 6-digit code from your authenticator app.',
  emailMissing: 'Enter your work email.',
  passwordMissing: 'Enter your password.',
  submit: 'Sign in',
  submitUnavailable: 'Sign in, unavailable for a few minutes',
  help: 'Forgotten your password or lost your authenticator?',
  lostAuthenticator: 'Lost your authenticator?',
  invite: 'Setting up a new staff account? Open the link in your invite email.',
  timeouts: 'You are signed out after 30 minutes without activity, and 12 hours after you sign in.',
} as const;

export const SIGN_IN_ALERTS = {
  /** Board copy, used once the code field is showing. */
  credentialsWithCode: { title: 'The email, password or code isn’t right', body: 'Check all three and try again.' },
  /** D1/Q3: before a code is asked for there are two fields, not three. */
  credentials: { title: 'The email or password isn’t right', body: 'Check both and try again.' },
  /** D1/Q3: was "Staff accounts need a code every time you sign in". */
  codeNeeded: { title: 'This account uses two-step sign-in', body: 'Enter the 6-digit code from your authenticator app.' },
  locked: { title: 'Too many attempts', body: 'Wait a few minutes, then try again.' },
  rateLimited: (until: Date) => ({
    title: 'Too many requests from this device',
    body: `Try again at ${formatTime(until)}.`,
  }),
  /** Not drawn: 503 (password checking at capacity). */
  busy: { title: 'Sign-in is busy right now', body: 'Nothing was sent. Try again in a moment.' },
  /** Not drawn: transport failure / offline. */
  offline: { title: 'We couldn’t reach HalalGoes', body: 'Check your connection, then try again. What you typed is still here.' },
  /** Not drawn: a 5xx or an answer the page cannot read. */
  failed: { title: 'Sign-in didn’t finish', body: 'Nothing was changed. Try again in a moment.' },
  /** Not drawn: 403 ACCOUNT_NOT_ACTIVE. */
  notActive: { title: 'This account can’t sign in right now', body: 'Ask a super admin to check your account.' },
  /** Not drawn: the credentials were right but the account holds no staff role. */
  wrongAccount: { title: 'This account can’t use the admin console', body: 'Sign in with your HalalGoes staff account.' },
} as const;

export const SIGNED_OUT = {
  title: 'You’re signed out',
  body: 'You signed out of HalalGoes on this device. Sign in again to continue.',
} as const;

export const HELP = {
  title: 'Can’t sign in?',
  forgotHeading: 'Forgotten your password?',
  forgotBody: 'Reset it yourself. We email a link that works for 30 minutes.',
  forgotAction: 'Reset my password',
  lostHeading: 'Lost the phone with your authenticator app?',
  lostBody:
    'Ask a super admin. They call you back on the phone number on your account and check two account details before they reset it. Then you sign in with your password and set up your authenticator app again.',
  /** D1/Q3: was "There are no recovery codes. HalalGoes staff accounts use a password and an authenticator code every time." */
  noRecovery: 'There are no recovery codes.',
  back: 'Back to sign in',
} as const;

/** `STF/SessionLostAuthenticator`, opened from the code step. */
export const LOST_AUTHENTICATOR = {
  title: 'Lost your authenticator app?',
  body: 'There are no recovery codes. Ask a super admin to reset your two-step sign-in. They’ll call you back on the phone number on your account and check two account details first, then you sign in with your password and set up your authenticator app again.',
  compromised:
    'If you think someone else has your phone or password, tell a super admin now so they can remove your access while you sort it out.',
  /** Manifest §2.1: until a reset API exists (G-STF-1) the platform on-call engineer resets it. Placeholders: Q12. */
  onCall: 'Until a super admin can reset it from the console, the platform on-call engineer does it: [ON-CALL NAME], [ON-CALL PHONE].',
  back: 'Back to sign in',
} as const;

export const RESET = {
  askTitle: 'Reset your password',
  askIntro:
    'Enter your work email. If it belongs to a staff account, we send a link to choose a new password. It works for 30 minutes, once.',
  email: 'Work email',
  send: 'Send reset link',
  sendingNote: 'Sending the link. The email field is read-only until the server answers.',
  lostInstead: 'Lost your authenticator app instead?',
  notSent: { title: 'We couldn’t send the link.', body: 'Nothing was changed. Try again.' },
  /** No forgot-password board draws it; lifted from `STF/InviteValidation`. Also the server's 422. */
  invalidEmail: 'Enter an email address like name@halalgoes.ca.',
  sentTitle: 'Check your email',
  sentBody: (email: string) =>
    `If ${email} is a staff account, a reset link is on its way. It works for 30 minutes. Nothing changes until you choose a new password.`,
  sentHint: 'No email after a few minutes? Check spam, or ask a super admin.',
  back: 'Back to sign in',
  chooseTitle: 'Choose a new password',
  newPassword: 'New password',
  /** D1/Q3: dropped "and an authenticator code" after "Then sign in with your new password". */
  chooseNote:
    'Saving signs you out everywhere, on every device, and we email you to say the password changed. Then sign in with your new password.',
  save: 'Save password',
  savingNote: 'Saving. The field is read-only until the server answers.',
  notSaved: { title: 'Your password wasn’t changed.', body: 'Try again; the link still works until it expires.' },
  breached:
    'This password has appeared in a data breach, so it isn’t safe. Choose a different one of at least 12 characters.',
  expired: {
    title: 'This link has expired or was already used',
    body: 'Reset links work for 30 minutes, once. Nothing was changed. Ask for a new link.',
  },
  askAgain: 'Ask for a new link',
  doneTitle: 'Password saved',
  doneBody: 'You’ve been signed out everywhere. Sign in with your new password.',
  goToSignIn: 'Go to sign in',
} as const;

export const ACCEPT = {
  title: 'Set up your HalalGoes admin account',
  /**
   * D1/Q3 + G-AUTH-2: was "Step 1 of 2" above, and "You were invited as an Admin by Aminah
   * Rahman. Choose a password, then set up two-step sign-in. You need both before you can use
   * the console." There is no second step, and no lookup gives the role or the inviter.
   */
  intro: 'You were invited to the HalalGoes admin console. Choose a password to finish setting up your account.',
  newPassword: 'New password',
  helper: 'At least 12 characters. We check it against passwords exposed in data breaches.',
  breached:
    'This password has appeared in a data breach, so it isn’t safe. Choose a different one of at least 12 characters.',
  submit: 'Continue',
  submitOffline: 'Continue, available when you’re back online',
  offline: { title: 'You’re offline', body: 'What you typed is still here. Continue works again when you’re back online.' },
  /** Adapted from `STF/AcceptLookupError` (the lookup itself does not exist: G-AUTH-2). */
  noAnswer: {
    title: 'The server didn’t answer',
    body: 'Your link hasn’t been used and still works until it expires. Try again in a moment.',
  },
  invalidTitle: 'This invite link doesn’t work',
  invalidBody:
    'It may be incomplete or mistyped. Open it again from the invite email. If it still doesn’t work, ask the super admin who invited you for a new one.',
  /**
   * `400 TOKEN_CONSUMED` is one answer for expired and used links, so `STF/AcceptExpired` and
   * `STF/AcceptUsed` merge. D1/Q3: dropped "and a code from your authenticator app";
   * G-AUTH-2: no inviter name.
   */
  spentTitle: 'This invite link has expired or was already used',
  spentBody:
    'Invite links work for 72 hours, once. If you already set up your account, sign in with your work email and your password. If not, ask the super admin who invited you for a new link. Nothing was changed.',
  doneTitle: 'Your account is ready',
  /**
   * D1/Q3: was "Keep your authenticator app safe: …" plus "Sign in with your work email, your
   * password and a code from your authenticator app. After that the console opens on Live
   * alerts." The landing page depends on the role, so that sentence is dropped too.
   */
  doneBody: 'Setting up doesn’t sign you in. Sign in with your work email and your password.',
  goToSignIn: 'Go to sign in',
} as const;

/** Shared 429 copy for the link pages. */
export function tooManyRequests(until: Date): { title: string; body: string } {
  return SIGN_IN_ALERTS.rateLimited(until);
}
