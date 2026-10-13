/**
 * WP9 wording and the small formatters it needs. Every string is from the approved
 * payouts-account (PA) boards, verbatim; where a board draws sample data ("Yusuf Ahmed",
 * "4821", "Friday 2 October 2026") the value comes from the contract field the board's Data
 * tag names, and only the words around it are fixed.
 *
 * Copy rules (rider manifest): riders "apply", we "check", documents are "approved"; never
 * "verified". Halal does not appear in the rider app at all.
 */
import type { Schema } from '@hg/api-client';

type VehicleType = Schema['VehicleType'];
type RiderDocType = Schema['RiderDocType'];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * A calendar date as the boards write it. `YYYY-MM-DD` (a `format: date` field such as
 * `valid_until`) is read as that day, never shifted by the phone's zone; a timestamp is shown on
 * the phone's own day.
 */
function toDate(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Monday 12 October 2026". */
export function longDate(input: string): string {
  const d = toDate(input);
  return d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** "28 September 2026" (PA/Suspended-* rows). */
export function dayMonthYear(input: string): string {
  const d = toDate(input);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** Whole days from today (the phone's) to `input`; negative when past. */
export function daysUntil(input: string, now: Date = new Date()): number | null {
  const d = toDate(input);
  if (!d) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

/** "+1 416 555 0134" for a North American number; anything else as sent. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export function fullName(me: { first_name?: string | null; last_name?: string | null }): string {
  return [me.first_name, me.last_name].filter(Boolean).join(' ');
}

/** The time zone names the application's time zone picker offers (SO/Profile tzOptions). */
const TIMEZONES: Record<string, string> = {
  'America/Toronto': 'Eastern time (Toronto)',
  'America/Winnipeg': 'Central time (Winnipeg)',
};

export function timezoneLabel(tz: string | null | undefined): string {
  if (!tz) return '';
  return TIMEZONES[tz] ?? tz;
}

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  CAR: 'Car',
  SCOOTER: 'Scooter',
  MOTORCYCLE: 'Motorcycle',
  BICYCLE: 'Bicycle',
  ON_FOOT: 'On foot',
};

/** The document names the application and Account › Documents use. */
export const DOC_LABEL: Record<RiderDocType, string> = {
  DRIVERS_LICENCE: "Driver's licence",
  VEHICLE_REGISTRATION: 'Vehicle registration',
  VEHICLE_INSURANCE: 'Vehicle insurance',
  GOVERNMENT_ID: 'Government ID',
  WORK_ELIGIBILITY: 'Work permit',
  PROFILE_PHOTO: 'Photo of you',
};

/** The short noun in running text ("Your insurance expires on …", "New insurance in review"). */
export const DOC_SHORT: Record<RiderDocType, string> = {
  DRIVERS_LICENCE: "driver's licence",
  VEHICLE_REGISTRATION: 'registration',
  VEHICLE_INSURANCE: 'insurance',
  GOVERNMENT_ID: 'government ID',
  WORK_ELIGIBILITY: 'work permit',
  PROFILE_PHOTO: 'photo',
};

export function docLabel(type: string): string {
  return DOC_LABEL[type as RiderDocType] ?? type;
}

export function docShort(type: string): string {
  return DOC_SHORT[type as RiderDocType] ?? type;
}

/** "1 thing" / "2 things". */
export function things(n: number): string {
  return n === 1 ? '1 thing' : `${n} things`;
}

export const SUPPORT = {
  call: 'Call support',
  email: 'Email support',
  hours: (h: string) => `Support is open ${h.replace(/\.\s*$/, '')}.`,
  off: "Support isn't available right now. Try again later.",
} as const;

export const ACCOUNT = {
  title: 'Account',
  loading: 'Loading your account',
  errorTitle: "We couldn't load your account",
  errorBody: 'Check your connection and try again. Your deliveries and earnings are not affected.',
  approved: 'Approved · can go online',
  details: 'Your details',
  detailsSub: 'Name, phone, time zone',
  vehicle: 'Vehicle',
  documents: 'Documents',
  payouts: 'Payouts',
  terms: 'Terms and privacy',
  termsSub: 'Rider terms and privacy notice',
  delete: 'Delete account',
  deleteSub: 'Ask HalalGoes to close your account',
  help: 'Help',
  signOut: 'Sign out',
  expiresSoon: (n: number) => (n === 1 ? '1 expires soon' : `${n} expire soon`),
  replacementInReview: (short: string) => `New ${short} in review. You can keep riding.`,
  bankEnding: (last4: string, interval: string) => `Bank account ending ${last4} · ${interval}`,
} as const;

export const SIGN_OUT = {
  title: 'Sign out?',
  body: 'You will stop getting offers on this phone.',
  confirm: 'Sign out',
  cancel: 'Cancel',
  activeTitle: 'You are on a delivery',
  activeBody:
    'Signing out does not end it. The delivery stays yours and the customer is still waiting. It comes back when you sign in.',
  activeConfirm: 'Sign out anyway',
  activeCancel: 'Stay signed in',
  working: 'Signing you out',
  failedTitle: "We couldn't sign you out",
  failedBody: "You're still signed in on this phone. Check your connection and try again.",
  retry: 'Try again',
} as const;

export const DETAILS = {
  title: 'Your details',
  loading: 'Loading your details',
  errorTitle: "We couldn't load your details",
  errorBody: 'Check your connection and try again.',
  name: 'Name',
  mobile: 'Mobile number',
  timezone: 'Time zone',
  note: 'Your name and date of birth were checked against your ID. To change them, call support.',
} as const;

export const VEHICLE = {
  title: 'Vehicle',
  heading: 'Your vehicle',
  loading: 'Loading your vehicle',
  errorTitle: "We couldn't load your vehicle",
  errorBody: 'Check your connection and try again.',
  type: 'Type',
  makeModel: 'Make and model',
  plate: 'Licence plate',
  note: 'To change your vehicle, call support. We check the new vehicle and its documents before you ride with it.',
  call: 'Call support to change your vehicle',
} as const;

export const DOCUMENTS = {
  title: 'Documents',
  loading: 'Loading your documents',
  errorTitle: "We couldn't load your documents",
  errorBody: 'Your documents are safe. Check your connection and try again.',
  emptyTitle: 'No documents on file',
  emptyBody:
    "We couldn't find any documents for your account. This shouldn't happen once you are approved, so call support and we'll check.",
  expiresOn: (short: string, date: string) => `Your ${short} expires on ${date}`,
  expiresBodyInsurance:
    'Add the new policy before then. You can keep riding while we check it. If your current policy expires first, you go offline until the new one is approved.',
  expiresBody:
    'You can keep riding while we check the new one. If your current one expires first, you go offline until the new one is approved.',
  expiredOn: (short: string, date: string) => `Your ${short} expired on ${date}`,
  expiredInReviewBody: (short: string) => `You can't go online until the new ${short} is approved. It is being checked now.`,
  expires: (date: string) => `Expires ${date}`,
  expired: (date: string) => `Expired ${date}`,
  sent: (date: string) => `Sent ${date}`,
  noExpiry: 'No expiry',
  earlier: (label: string) => `${label} (earlier)`,
} as const;

/** SO/Ref-DocumentStates: outline or info only, never brand, green or red. */
export const DOC_BADGE: Record<string, { label: string; variant: 'outline' | 'info' }> = {
  SUBMITTED: { label: 'Sent', variant: 'outline' },
  IN_REVIEW: { label: 'In review', variant: 'info' },
  APPROVED: { label: 'Approved', variant: 'outline' },
  REJECTED: { label: 'New upload needed', variant: 'outline' },
  EXPIRED: { label: 'Expired', variant: 'outline' },
  SUPERSEDED: { label: 'Replaced', variant: 'outline' },
  EXPIRES_SOON: { label: 'Expires soon', variant: 'info' },
};

export const TERMS = {
  title: 'Terms and privacy',
  intro: 'The rider terms and privacy notice. Opening a link shows the current version.',
  readTerms: 'Read the rider terms',
  readPrivacy: 'Read the privacy notice',
} as const;

export const LEGAL = {
  terms: { title: 'Rider terms', opening: 'Opening the rider terms', error: "We couldn't open the rider terms" },
  privacy: { title: 'Privacy notice', opening: 'Opening the privacy notice', error: "We couldn't open the privacy notice" },
  errorBody: 'Check your connection and try again.',
  version: (v: string) => `Version ${v}`,
  retry: 'Try again',
} as const;

export const DELETE = {
  title: 'Delete account',
  heading: 'Delete your account',
  body: "Call or email HalalGoes support and ask us to delete your account. We check it's you, then close it and sign you out. You can't undo it.",
  whatHappens: 'What happens',
  points: [
    "You stop getting offers and can't sign in with this number again.",
    "Money you've already earned is still paid out.",
    "If you're on a delivery, finish it first.",
  ],
} as const;

export const SUSPENDED = {
  title: 'Account paused',
  heading: "You can't go online right now",
  loading: 'Loading your account',
  errorTitle: "We couldn't load your account",
  errorBody: 'Check your connection and try again.',
  paused: 'Your account is paused.',
  paid: "Money you've already earned is still paid out.",
  callToFindOut: 'Call support to find out more.',
  docExpired: (label: string, date: string, short: string) =>
    `Your ${label.toLowerCase()} expired on ${date}. Add your new ${short} and we will check it. Money you've already earned is still paid out.`,
  docInReview: (label: string) =>
    `Your ${label.toLowerCase()} expired. We're checking your new one. You can go online again once a person approves it. Money you've already earned is still paid out.`,
  notify: "We'll send you a notification when your account is active again. This screen also updates as soon as a person decides.",
} as const;

export const PAYOUTS = {
  appTitle: 'Your application',
  title: 'Payouts',
  loading: 'Loading your payout status',
  step5: 'Step 5 of 5: payouts',
  step4: 'Step 4 of 5: we check your documents',
  approved: 'Your documents are approved.',
  oneLeft: 'One step left.',
  getPaid: 'Get paid',
  getPaidBody: 'Stripe pays you. Stripe asks for your bank details and ID. HalalGoes only sees the last 4 digits of your account.',
  continue: 'Continue to Stripe',
  continueWith: 'Continue with Stripe',
  opening: 'Opening Stripe',
  notYetTitle: 'Payouts open after approval',
  notYetBody: 'You can set up payouts once your documents are approved. This screen updates by itself while the app is open.',
  backToReview: 'Back to review',
  createFailedTitle: "We couldn't set up your payout account",
  createFailedBody: 'Nothing was created twice. Check your connection and try again.',
  linkFailedTitle: "Stripe didn't open",
  linkFailedBody: 'Check your connection and try again. Each try opens a fresh, secure link.',
  retry: 'Try again',
  offlineTitle: 'You are offline',
  offlineBody: 'Stripe needs a connection. Continue once you are back online.',
  checking: 'Checking with Stripe',
  checkingBody: 'This can take a minute. This screen updates by itself while the app is open.',
  slow: 'Stripe is still checking your details',
  slowBody: 'This can take longer, sometimes up to a day. You can close the app.',
  slowNotify: "We'll let you know when Stripe finishes.",
  checkAgain: 'Check again',
  returned: "Stripe isn't finished yet",
  returnedBody: 'You left Stripe before the end. Nothing is lost. Carry on where you stopped; it opens a fresh, secure link.',
  due: (n: number) => `Stripe needs ${n === 1 ? '1 more thing' : `${n} more things`} from you`,
  dueBody: 'Stripe will show you exactly what to add. It takes about 5 minutes.',
  later: (n: number) => `Stripe may ask for ${n === 1 ? '1 more thing' : `${n} more things`} later. We'll tell you when.`,
  onHold: 'Payouts are on hold while Stripe checks what you sent.',
  pastDue: (n: number) => `Stripe needs ${things(n)} from you now`,
  pastDueBy: (date: string) => `Stripe needed this by ${date}. Until you add it, Stripe can't pay you.`,
  pastDueNoDate: "Until you add it, Stripe can't pay you.",
  deadline: 'Stripe deadline',
  deadlinePassed: (date: string) => `${date} (passed)`,
  dueBy: (n: number, date: string) => `Stripe needs ${things(n)} by ${date}`,
  dueByBody: 'Payouts keep going until then.',
  forSupport: 'For support',
  copy: 'Copy details for support',
  rejected: "Stripe can't pay out to this account",
  rejectedBody: 'Stripe closed this payout account. Call support to talk about what happens next.',
  rejectedSupport: 'Stripe declined this payout account',
  ready: "You're ready to ride",
  readyBank: (last4: string, interval: string) => `Payouts go to your bank account ending ${last4}, ${interval}.`,
  readyNoBank: (interval: string) => `Payouts go to your bank account, ${interval}.`,
  readyGo: 'Go online from Home when you want to start.',
  goHome: 'Go to Home',
  errorTitle: "We couldn't check your payouts",
  errorBodyApp: 'Try again in a moment.',
  errorBodyAccount: 'Your earnings are still recorded. Try again in a moment.',
  notSetUp: 'Payouts are not set up',
  notSetUpBody: 'Stripe needs your bank details before it can pay you. Your earnings are still recorded.',
  setUp: 'Set up payouts with Stripe',
  bankAccount: 'Bank account',
  ending: (last4: string) => `ending ${last4}`,
  noneYet: 'None yet',
  schedule: 'Schedule',
  stripe: 'Stripe',
  on: 'Payouts on',
  off: 'Payouts off',
  holds: 'Stripe holds your bank details. HalalGoes only sees the last 4 digits.',
  changeBank: 'Change bank details with Stripe',
  eventually: (n: number) => `Stripe will need ${n === 1 ? '1 more thing' : `${n} more things`} later`,
  eventuallyBody: "Nothing to do yet. Payouts keep going. We'll tell you when Stripe needs it.",
  addNow: 'Add it now with Stripe',
} as const;

/** `payout_interval` in the boards' words: "every Monday" (decision S-04: weekly, Monday). */
export function intervalWords(interval: string | null | undefined): { lower: string; title: string } {
  if (interval === 'DAILY') return { lower: 'every day', title: 'Every day' };
  return { lower: 'every Monday', title: 'Every Monday' };
}
