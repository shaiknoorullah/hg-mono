/**
 * Every word the application screens show, verbatim from the SO boards (Onboarding-*, Profile-*,
 * Vehicle-*, Fix-Closed) and the rider manifest's Appendix A. Copy rule (SO overview note):
 * never "verified" or "verification", which are kept for halal certificates. Riders apply, we
 * check, documents are approved.
 *
 * Lines marked "derived" have no board of their own; they follow a drawn sibling's pattern and
 * are listed in the PR for the owner.
 */
import type { VehicleType } from './data';

export const APP_TITLE = 'Your application';
export const BACK_TO_APPLICATION = 'Back to your application';
export const BACK_TO_DETAILS = 'Back to your details';
export const TRY_AGAIN = 'Try again';
export const CONTINUE = 'Continue';
export const SIGN_OUT = 'Sign out';

export const STEP_NAMES = ['your details', 'how you deliver', 'documents', 'we check your documents', 'payouts'] as const;

export const PROGRESS = {
  step: (n: number) => `Step ${n} of 5: ${STEP_NAMES[n - 1]}`,
  done: (pct: number) => `${pct}% done`,
} as const;

export const OFFLINE_TITLE = 'You are offline';

export const HUB = {
  welcomeTitle: 'Apply to ride',
  welcomeLead: 'Four things to do, and one check by our team.',
  inProgressTitle: 'Finish your application',
  rows: [
    { title: 'Your details', description: 'Name, date of birth, email' },
    { title: 'How you deliver', description: 'Car, scooter, motorcycle, bicycle or on foot' },
    { title: 'Documents', description: 'Photos of your ID or licence and papers' },
    { title: 'We check your documents', description: 'A person checks each one, usually within 72 hours' },
    { title: 'Payouts', description: 'Bank details, through Stripe' },
  ],
  /** In progress, rows not reached yet (Onboarding-InProgress). */
  waitingDescription: ['', '', '', 'Starts when you send them', 'After your documents are approved'],
  youAreHere: (description: string) => `${description} · you are here`,
  docsAdded: (added: number, needed: number) => `${added} of ${needed} added`,
  done: 'Done',
  notStarted: 'Not started',
  bring: 'Have your ID or licence nearby. Motorised riders also need vehicle registration and insurance.',
  terms: 'By continuing you agree to the rider terms and privacy notice.',
  readTerms: 'Read the rider terms',
  readPrivacy: 'Read the privacy notice',
  start: 'Start with your details',
  /** Derived: Onboarding-InProgress draws step 3 only ("Continue with documents"). */
  continueVehicle: 'Continue with how you deliver',
  continueDocuments: 'Continue with documents',
  loading: 'Loading your application',
  errorTitle: "We couldn't load your application",
  errorBody: 'Your progress is saved on our side. Try again to pick up where you left off.',
  offlineBody: 'Your progress is saved. You can look around, but nothing new is sent until you are back online.',
  rowDone: (title: string) => `${title}, done`,
  rowCurrent: (title: string) => `${title}, current`,
  rowNotStarted: (title: string) => `${title}, not started`,
} as const;

export const CLOSED = {
  title: 'Your application is closed',
  body: 'Only our support team can reopen it.',
} as const;

export const DETAILS = {
  subtitle: 'Your details',
  title: 'Tell us who you are',
  lead: 'Use your name exactly as it appears on your ID.',
  firstName: 'First name',
  lastName: 'Last name',
  dob: 'Date of birth',
  day: 'Day',
  month: 'Month',
  year: 'Year',
  email: 'Email (optional)',
  emailHelper: 'For receipts and account notices.',
  timezone: 'Time zone',
  timezonePlaceholder: 'Choose a time zone',
  timezoneHelper: 'Used for your earnings days. Set from your phone. Change it if you ride in another zone.',
  timezoneHelperLocked: 'Used for your earnings days.',
  ageHelper: (minAge: number) => `You must be ${minAge} or older to ride.`,
  loading: 'Loading your details',
  summary: (n: number) => (n === 1 ? '1 thing needs fixing' : `${n} things need fixing`),
  firstNameRequired: 'Enter your first name, as it is on your ID.',
  lastNameRequired: 'Enter your last name, as it is on your ID.',
  dobRequired: 'Enter your date of birth: day, month and year.',
  timezoneRequired: 'Choose the time zone you ride in. It sets the days your earnings are grouped by.',
  underage: (minAge: number) => `Check your date of birth. You must be ${minAge} or older to ride with HalalGoes.`,
  underageAgainTitle: (minAge: number) => `You can apply once you turn ${minAge}`,
  underageAgainBody: (minAge: number) =>
    `We can't accept riders under ${minAge}, so these details are locked. If your date of birth is wrong, call support and we'll correct it.`,
  emailInUse: 'This email is already on another account. Use a different one, or leave it blank.',
  /** Derived: a 422 VALIDATION_FAILED on `email` (no board draws it). */
  emailInvalid: 'Enter a full email address, like name@example.ca.',
  serverErrorTitle: "We couldn't save your details",
  serverErrorBody: 'Something went wrong on our side. Your answers are still here.',
  offlineBody: 'Your answers are kept on this phone. Continue works again once you are back online.',
} as const;

const NOUN: Record<VehicleType, string> = {
  CAR: 'car',
  SCOOTER: 'scooter',
  MOTORCYCLE: 'motorcycle',
  BICYCLE: 'bicycle',
  ON_FOOT: 'on foot',
};

/** "a scooter", "a car"; on foot has no article. */
function aNoun(t: VehicleType): string {
  return t === 'ON_FOOT' ? NOUN[t] : `a ${NOUN[t]}`;
}

/** Who the cleared fields do not apply to (Vehicle-Switched, Vehicle-NotApplicable). */
const NOT_NEEDED: Record<'BICYCLE' | 'ON_FOOT', string> = {
  BICYCLE: 'Bicycles',
  /** Derived: the boards draw the bicycle case. */
  ON_FOOT: 'Riders on foot',
};

export const VEHICLE = {
  subtitle: 'How you deliver',
  question: 'How will you deliver?',
  options: [
    { value: 'CAR', label: 'Car', description: 'Licence, registration, insurance and a photo of you' },
    { value: 'SCOOTER', label: 'Scooter', description: 'Licence, registration, insurance and a photo of you' },
    { value: 'MOTORCYCLE', label: 'Motorcycle', description: 'Licence, registration, insurance and a photo of you' },
    { value: 'BICYCLE', label: 'Bicycle', description: 'Government ID and a photo of you' },
    { value: 'ON_FOOT', label: 'On foot', description: 'Government ID and a photo of you' },
  ] as const satisfies readonly { value: VehicleType; label: string; description: string }[],
  label: (t: VehicleType) => VEHICLE.options.find((o) => o.value === t)?.label ?? t,
  about: (t: VehicleType) => `About your ${NOUN[t]}`,
  plate: 'Licence plate',
  make: 'Make (optional)',
  model: 'Model (optional)',
  year: 'Year (optional)',
  colour: 'Colour (optional)',
  loading: 'Loading your vehicle',
  noChoiceTitle: 'Choose how you will deliver',
  noChoiceBody: 'It decides which documents we ask for.',
  noChoiceError: 'Choose one to continue.',
  plateNeeded: (t: VehicleType) => `${capital(NOUN[t])}s need a licence plate. We check it against your registration.`,
  plateRequired: (t: VehicleType) => `Enter the plate on your ${NOUN[t]}, 2 to 8 letters and numbers.`,
  plateInUse: "This plate is on another rider's account. Check it matches your registration.",
  itsMine: "It's my vehicle: call support",
  yearRange: 'Enter a year from 1990 on, like 2021.',
  switchedTitle: (from: VehicleType) => `We cleared your plate and ${NOUN[from]} details`,
  switchedBody: (to: 'BICYCLE' | 'ON_FOOT') => `${NOT_NEEDED[to]} don't need them, so they won't be sent.`,
  saveErrorTitle: "We couldn't save your vehicle",
  notApplicableBody: (to: 'BICYCLE' | 'ON_FOOT') =>
    `${NOT_NEEDED[to]} don't take a plate or vehicle details. We removed them. Try again.`,
  serverErrorBody: 'Something went wrong on our side. Your choice is still here.',
  offlineBody: 'Your choice is kept on this phone. Continue works again once you are back online.',
  docsAdded: (n: number, t: VehicleType) => `You added ${n} ${n === 1 ? 'document' : 'documents'} for ${aNoun(t)}.`,
  changeTitle: (to: VehicleType) => (to === 'ON_FOOT' ? 'Change to on foot?' : `Change to ${aNoun(to)}?`),
  /** Motorised → bicycle is drawn (Vehicle-ChangeAfterDocs); the other directions are derived. */
  changeBody: (to: VehicleType, motorised: boolean) =>
    motorised
      ? `${capital(NOUN[to])}s need a driver's licence, vehicle registration, insurance and a photo of you. Your government ID won't be sent for review. Your photo of you stays.`
      : `${to === 'ON_FOOT' ? 'Riders on foot' : 'Bicycles'} need a government ID and a photo of you. Your licence, registration and insurance won't be sent for review. Your photo of you stays.`,
  changeConfirm: (to: VehicleType) => `Change to ${NOUN[to]}`,
  changeKeep: (from: VehicleType) => `Keep ${NOUN[from]}`,
} as const;

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
