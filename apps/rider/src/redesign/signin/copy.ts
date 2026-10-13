/**
 * Sign-in and routing copy, verbatim from the SO boards (rider manifest Appendix A and the board
 * bodies). Screen-specific error copy lives here, not in `data/errors.ts`.
 *
 * One deliberate change from the boards: the code screen says "We sent a 6-digit code to the
 * number ending …" without "by text message". The channel (SMS or WhatsApp) is Needs API
 * (`OtpChallenge` has no channel; SO `Ref-NeedsAPI`, manifest §5 item 32), so the wording stays
 * neutral until it lands.
 */

export const minutes = (n: number): string => (n === 1 ? '1 minute' : `${n} minutes`);

/** Seconds → whole minutes, rounded up, never less than 1. */
export const minutesFromMs = (ms: number): number => Math.max(1, Math.ceil(ms / 60_000));

export const PHONE = {
  title: 'Sign in or apply to ride',
  lead: "Enter your mobile number. We'll send a 6-digit code. New riders start here too.",
  label: 'Mobile number',
  helper: 'Canadian numbers only (+1).',
  invalid: 'Enter all 10 digits of a Canadian mobile number, like 416 555 0134.',
  send: 'Send code',
  tryAgain: 'Try again',
  sending: 'Sending your code',
  offlineTitle: 'You are offline',
  offlineBody: 'Nothing was sent. Connect to mobile data or Wi-Fi, then try again.',
  signedOutTitle: 'You were signed out',
  signedOutBody: 'Sign in again to keep working.',
  tooManyTitle: 'Too many codes requested',
  tooManyBody: (m: number) => `For your security, wait ${minutes(m)} before asking for another code.`,
  unavailableTitle: "We can't send codes right now",
  unavailableBody: 'The problem is on our side, not your phone. Try again in a few minutes.',
} as const;

export const CODE = {
  appBar: 'Sign in',
  backTo: 'phone number',
  title: 'Enter your code',
  sentTo: (last4: string) => `We sent a 6-digit code to the number ending ${last4}.`,
  label: '6-digit code',
  helper: 'We check the code as soon as all 6 digits are in.',
  pasted: 'Filled in from your messages.',
  checking: 'Checking your code',
  verify: 'Verify',
  resend: 'Send the code again',
  sendNew: 'Send a new code',
  differentNumber: 'Use a different number',
  resendIn: (s: number) => `You can ask for a new code in ${s} s.`,
  incorrect: (n: number) => `That code is not right. You have ${n === 1 ? '1 try' : `${n} tries`} left.`,
  incorrectNoCount: 'That code is not right.',
  triesUsedTitle: 'That code no longer works',
  triesUsedBody: "You've used every try for this code. Ask for a new one to keep going.",
  expiredTitle: 'This code has expired',
  expiredBody: 'Codes last 5 minutes. Ask for a new one to keep going.',
  resendLimitTitle: "We've sent 3 codes",
  resendLimitBody: (m: number) => `Use the latest one. If it has expired, you can ask for a new code in ${minutes(m)}.`,
  lockedTitle: 'Too many tries',
  lockedBody: (m: number) => `Sign-in is paused for this number. Try again in ${minutes(m)}.`,
} as const;

export const SPLASH = {
  loading: 'Getting your account ready.',
  slowTitle: 'This is taking longer than usual',
  slowBody: 'We are still trying. Check your signal, or try again now.',
  errorTitle: "We couldn't open your account",
  errorBody: 'You are still signed in. Check your connection and try again.',
  tryAgain: 'Try again',
  signOut: 'Sign out',
  noSupportShort: "Support isn't available right now.",
} as const;

export const TERMINAL = {
  updateTitle: 'Update the app to continue',
  updateBody: 'This version of the HalalGoes rider app is out of date. Update it from your app store, then open it again.',
  openStore: 'Open the app store',
  wrongRoleTitle: 'Something is wrong with your account setup',
  wrongRoleBody: "Updating the app won't fix this. Call support and we'll sort it out.",
  wrongRoleBodyNoSupport: "Updating the app won't fix this.",
  closedTitle: 'This rider account is closed',
  closedBody:
    "You can no longer sign in with this number. Money you've already earned is still paid out. If you think this is a mistake, call our support team.",
  closedBodyNoSupport: "You can no longer sign in with this number. Money you've already earned is still paid out.",
  backToSignIn: 'Back to sign in',
  signOut: 'Sign out',
  noSupport: "Support isn't available right now. Try again later.",
  hours: (h: string) => `Support is open ${h.replace(/\.\s*$/, '')}.`,
} as const;

export const CALL_SUPPORT = 'Call support';

/** The contract's challenge window: a 4th send inside it answers 429 (OtpChallenge, requestOtp). */
export const CHALLENGE_WINDOW_MS = 15 * 60_000;
export const MAX_SENDS = 3;
