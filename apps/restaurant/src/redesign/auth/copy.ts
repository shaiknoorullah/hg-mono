/**
 * Sign-in and account access copy (canvas SI, WP2 spec), verbatim. The boards mix straight and
 * curly apostrophes; the app normalises to the house style `’` and changes no words.
 */

export const CONTEXT_LABEL = 'Restaurant partner';

export const SUPPORT = {
  blockLabel: 'Partner support',
  sentenceBefore: 'Need help signing in? Call partner support on ',
  /** "…on {phone}, {hours}." */
  sentenceAfter: (hours: string) => `, ${hours}.`,
  lockedFooter: 'Partner support: ',
  unavailableTitle: 'Partner support isn’t available right now',
  unavailableBody: 'Try again later. What you’ve already sent stays on record.',
  callButton: 'Call partner support',
};

export const COMMON = {
  backToSignIn: 'Back to sign in',
  waitPrefix: 'You can try again in ',
  waitLabel: 'until you can try again',
  waitOver: 'You can try again now.',
  forgotBefore: 'Forgot your password? ',
  forgotLink: 'Reset it by email',
  newBefore: 'New to HalalGoes? ',
  registerLink: 'Register your restaurant',
};

export const SIGN_IN = {
  title: 'Sign in to your restaurant',
  intro: 'Use the email and password you registered with.',
  email: 'Email',
  password: 'Password',
  submit: 'Sign in',
  tryAgain: 'Try again',
  emailMissing: 'Enter your email.',
  passwordMissing: 'Enter your password.',
  invalidTitle: 'Email or password is incorrect',
  invalidBody: 'Check both and try again. Forgot your password? Reset it by email below.',
  unverifiedTitle: 'Confirm your email to sign in',
  unverifiedBody: (email: string) =>
    `We sent a confirmation link to ${email} when you registered. Links work for 24 hours. Signing in won’t work until you’ve opened it.`,
  sendNewLink: 'Send a new link',
  tooManyTitle: 'Too many attempts from this device',
  tooManyBody: 'Wait a moment, then try again. What you typed is kept.',
  lockedTitle: 'Sign-in is paused for this account',
  lockedBody:
    'There were too many unsuccessful attempts, so we’ve paused sign-in for a while to protect it. Call partner support to get back in now, or wait and try again. Forgotten your password? ',
  /** Ref-SupportUnavailable: the "Call partner support" sentence goes with the button. */
  lockedBodyNoSupport:
    'There were too many unsuccessful attempts, so we’ve paused sign-in for a while to protect it. Wait and try again. Forgotten your password? ',
  offlineTitle: 'We couldn’t reach HalalGoes',
  offlineBody: 'Check this device’s internet connection, then try again. What you typed is kept.',
  /** 503 / 5xx / MFA_REQUIRED / unknown: the Offline layout, "try again in a moment" (manifest §1.1). */
  busyTitle: 'HalalGoes couldn’t sign you in just now',
  busyBody: 'Something went wrong on our side. What you typed is kept. Try again in a moment.',
  expiredTitle: 'You’ve been signed out',
  expiredIntro: 'Sign in again to keep receiving orders.',
  expiredAlertTitle: 'New orders can’t reach this screen',
  ordersAtRisk: (minutes: string) =>
    `New orders can’t reach this screen until you sign in. Orders that arrive now will time out after ${minutes}, and two missed orders in a row stop new orders.`,
  acceptedSafe: 'Orders you’ve already accepted are not affected.',
  reuseTitle: 'We signed you out on every device',
  reuseIntro: 'Sign in again on each device to keep receiving orders.',
  reuseAlertTitle: 'Every session ended, including kitchen tablets',
  reuseBody: (phone: string) =>
    `Something looked like a copied sign-in, so we ended every session. Sign in again on each one. If you didn’t expect this, call partner support on ${phone} after signing in.`,
  reuseBodyNoSupport:
    'Something looked like a copied sign-in, so we ended every session. Sign in again on each one. If you didn’t expect this, contact HalalGoes after signing in.',
  notRestaurantTitle: 'This isn’t a restaurant account',
  notRestaurantBody: (email: string) =>
    `${email} signed in, but it has no restaurant on HalalGoes. It may be a customer or rider account. Restaurant partners sign in with the email they registered the restaurant with.`,
  differentEmail: 'Sign in with a different email',
};

export type AccountCardKind = 'locked-permanent' | 'suspended' | 'banned' | 'not-active' | 'deactivated' | 'restaurant-closed';

export const ACCOUNT_CARDS: Record<
  AccountCardKind,
  { icon: 'lock' | 'info'; title: string; body: (email: string, restaurant?: string) => string; bodyNoSupport?: (email: string) => string }
> = {
  'locked-permanent': {
    icon: 'lock',
    title: 'This account is locked',
    body: (email) =>
      `For your security, only partner support can unlock ${email}. They’ll check who you are first. Resetting your password won’t unlock it.`,
    bodyNoSupport: () => 'For your security, it can only be unlocked by HalalGoes.',
  },
  suspended: {
    icon: 'lock',
    title: 'Your sign-in account is suspended',
    body: (email) =>
      `You can’t sign in with ${email} while it is suspended. This is about your own sign-in, not the restaurant. Partner support can tell you why and what you can do next.`,
  },
  banned: {
    icon: 'lock',
    title: 'This sign-in account can’t be used',
    body: (email) => `${email} can’t be used on HalalGoes. If you think this is a mistake, contact partner support.`,
  },
  'not-active': {
    icon: 'lock',
    title: 'This account isn’t active',
    body: (email) => `${email} exists but isn’t active yet. Partner support can tell you what’s needed.`,
  },
  deactivated: {
    icon: 'info',
    title: 'This account has been closed',
    body: (email) => `${email} can no longer be used to sign in. If you think this is a mistake, contact partner support.`,
  },
  'restaurant-closed': {
    icon: 'lock',
    title: 'This restaurant account is closed',
    body: (email, restaurant) =>
      `${restaurant ?? 'This restaurant'}’s account on HalalGoes is closed, so ${email} can’t sign in to it. If you have questions, contact partner support.`,
  },
};

export const UPDATE = {
  title: 'This page needs an update',
  body: 'Your setup has moved to a step this version of the page doesn’t know yet. Refresh to load the latest version. Nothing you’ve done is lost.',
  refresh: 'Refresh',
};

export const REGISTER = {
  title: 'Register your restaurant',
  intro: 'Create the owner account. After you confirm your email, you’ll add your business details and documents.',
  name: 'Restaurant name',
  nameHelp: 'The name customers know you by. You’ll add the legal name later.',
  email: 'Work email',
  emailHelp: 'We’ll send a confirmation link here.',
  password: 'Password',
  passwordHelp: 'At least 12 characters. Use a password you don’t use anywhere else.',
  terms: 'Read the partner terms',
  termsUpdated: 'Read the updated partner terms',
  termsVersion: (v: string) => `Version ${v}`,
  accept: 'I have read and accept the partner terms',
  submit: 'Create account',
  alreadyBefore: 'Already registered? ',
  signIn: 'Sign in',
  summaryTitle: (n: number) =>
    n === 1 ? '1 thing needs changing before we can create your account' : `${n} things need changing before we can create your account`,
  summaryTerms: 'Partner terms',
  nameError: 'Enter at least 2 characters.',
  /** Not drawn (builder copy, to confirm): the contract's 120-character limit. */
  nameTooLong: 'Use a shorter name: this one is over the 120-character limit.',
  /** Not drawn (builder copy, to confirm): a 422 that names no field (#739). */
  nameRefused: 'HalalGoes couldn’t accept this name. Check it, or try a shorter one.',
  emailRefused: 'HalalGoes couldn’t accept this email. Check it, or use a different one.',
  /** Not drawn (builder copy, to confirm): the public config (terms version) failed to load. */
  termsLoadTitle: 'We couldn’t load the partner terms',
  termsLoadBody: 'You can accept them once they load. What you typed is kept. Check your connection, then try again.',
  emailError: 'Enter a full email address, like name@restaurant.ca.',
  passwordError: 'Use at least 12 characters.',
  passwordTooLong: 'Use a shorter password: this one is over the 256-character limit.',
  breached: 'This password appears in known data breaches. Choose a different one.',
  termsError: 'Accept the partner terms to create your account.',
  takenTitle: 'An account already uses this email',
  takenBody: 'Sign in with it instead, or register with a different email. One email can hold one owner account.',
  takenField: 'Already registered. Sign in, or use a different email.',
  termsChangedTitle: 'The partner terms have changed',
  termsChangedBody:
    'They were updated while this page was open. Read the new version and accept it to create your account. Everything else you entered is kept.',
  netTitle: 'Your account wasn’t created',
  netBody:
    'We couldn’t reach HalalGoes, or something went wrong on our side. What you typed is kept. Check your connection and try again. Trying again won’t create a second account.',
};

export const CHECK_EMAIL = {
  title: 'Check your email',
  openBefore: 'Open the link we sent to ',
  /** " to continue setting up {business_name}." — or "." when the name is unknown. */
  openAfter: (business?: string | null) => (business ? ` to continue setting up ${business}.` : '.'),
  noEmail: 'Open the link we sent to your email to continue setting up your restaurant.',
  wrongBefore: 'Wrong email? ',
  wrongLink: 'Register again with the right one',
  help: 'The link works for 24 hours. Can’t find it? Check your spam folder, or send a new link.',
  send: 'Send a new link',
  onItsWay: 'A new link is on its way. Earlier links no longer work, so use the newest email.',
  sendAnotherPrefix: 'You can send another in ',
  dailyTitle: 'You’ve asked for 5 links today',
  dailyBody: 'That’s the daily limit. Use the newest email you have, or call partner support.',
  dailyBodyNoSupport: 'That’s the daily limit. Use the newest email you have.',
  dailyLabel: 'until tomorrow’s limit resets',
  offlineTitle: 'We couldn’t send a new link',
  offlineBody: 'This device seems to be offline. The link we sent earlier still works. Try again when you’re back online.',
};

export const VERIFY = {
  workingTitle: 'Confirming your email',
  workingBody: 'This only takes a moment. You’ll go straight to setting up your restaurant.',
  workingStatus: 'Confirming your email…',
  expiredTitle: 'This link has expired',
  expiredBody: 'Confirmation links work for 24 hours. Enter your email and we’ll send a new one.',
  email: 'Email',
  send: 'Send a new link',
  alreadyBefore: 'Already confirmed your email? ',
  signIn: 'Sign in',
  sendErrorTitle: 'We couldn’t send a new link',
  sendErrorBody: 'Check your connection and try again. Nothing else changed.',
  tryAgain: 'Try again',
  usedTitle: 'This link has already been used',
  /** The board's "…setting up {business name}." — the name is unknown on this page. */
  usedBody: 'Your email is confirmed. Sign in to carry on setting up your restaurant.',
  errorTitle: 'We couldn’t confirm your email',
  errorBody: 'We couldn’t reach HalalGoes. Check your connection and try again. Your link still works.',
  doneTitle: 'Your email is confirmed',
  doneBody: 'Sign in to carry on setting up your restaurant.',
  emailError: 'Enter a full email address, like name@restaurant.ca.',
};

export const FORGOT = {
  title: 'Reset your password',
  intro: 'Enter the email you registered with. We’ll send a link to set a new password.',
  email: 'Email',
  submit: 'Email me a reset link',
  errorTitle: 'We couldn’t send the link',
  errorBody: 'This device seems to be offline, or HalalGoes didn’t answer. Your email is kept. Try again.',
  tryAgain: 'Try again',
  sentTitle: 'Check your email',
  sentBefore: 'If ',
  sentAfter: ' has a HalalGoes partner account, we’ve sent it a link to set a new password.',
  sentHelp: 'The link works for 30 minutes and only once. Can’t find it? Check your spam folder, or ask for another.',
  another: 'Send another link',
  emailError: 'Enter a full email address, like name@restaurant.ca.',
};

export const RESET = {
  title: 'Set a new password',
  intro: 'Choose a new password for your HalalGoes partner account.',
  password: 'New password',
  help: 'At least 12 characters. Any characters are fine; we refuse passwords known from data breaches.',
  signsOut:
    'Setting a new password signs you out on every device, including your order screen. Sign in there again afterwards so new orders keep reaching it.',
  submit: 'Set new password',
  breached: 'This password appears in known data breaches. Choose a different one.',
  tooShort: 'Use at least 12 characters.',
  tooLong: 'Use a shorter password: this one is over the 256-character limit.',
  invalidTitle: 'This link doesn’t work any more',
  invalidBody: 'Reset links work for 30 minutes and only once. Ask for a new one and use the newest email.',
  newLink: 'Email me a new link',
  doneTitle: 'Your new password is set',
  doneBody:
    'You’re signed out on every device, including your order screen. Sign in with your new password, then open the order screen again so new orders reach it.',
  signIn: 'Sign in',
  errorTitle: 'Your password wasn’t changed',
  errorBody: 'This device seems to be offline, or HalalGoes didn’t answer. Your link still works. Try again.',
  tryAgain: 'Try again',
};
