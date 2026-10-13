/**
 * Every word the WP8 screens show, verbatim from the SO boards (Docs-*, Capture-*, Notify-Prime,
 * Review-*, Fix-*, Ref-RejectionReasons, Ref-DocumentStates) and the rider manifest's Appendix A.
 * Copy rule (SO overview): never "verified" or "verification" (kept for halal certificates).
 * Riders apply, we check, documents are approved.
 *
 * Lines marked "derived" have no board of their own; they follow a drawn sibling's pattern and
 * are listed in the PR for the owner.
 */
import type { RejectionCode, RiderDocType } from './data';
import { minutes } from '../signin/copy';

export const BACK_TO_DOCUMENTS = 'Back to documents';
/** Derived: the fix screens' Back (the boards draw the AppBar gap, not its label). */
export const BACK_TO_FIX = 'Back to fix documents';

interface DocCopy {
  /** Row title and AppBar title. */
  label: string;
  /** In a sentence ("Add driver's licence"). */
  lower: string;
  /** What the rider holds up to the camera ("licence"). */
  noun: string;
  /** Row description before it is added. */
  description: string;
}

export const DOC: Record<RiderDocType, DocCopy> = {
  DRIVERS_LICENCE: { label: "Driver's licence", lower: "driver's licence", noun: 'licence', description: 'Front, with expiry date' },
  VEHICLE_REGISTRATION: { label: 'Vehicle registration', lower: 'vehicle registration', noun: 'registration', description: 'With expiry date' },
  VEHICLE_INSURANCE: { label: 'Vehicle insurance', lower: 'vehicle insurance', noun: 'insurance', description: 'With expiry date' },
  GOVERNMENT_ID: { label: 'Government ID', lower: 'government ID', noun: 'ID', description: 'Photo ID, with expiry date' },
  PROFILE_PHOTO: { label: 'Photo of you', lower: 'photo of you', noun: 'photo', description: 'Your face, clearly lit' },
  WORK_ELIGIBILITY: {
    label: 'Work permit',
    lower: 'work permit',
    noun: 'work permit',
    description: "Only if you're not a Canadian citizen or permanent resident. It must not be expired.",
  },
};

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const word = (n: number) => WORDS[n] ?? String(n);

/** "For a scooter we need these four"; on foot is derived (the boards draw a bicycle). */
function forVehicle(vehicle: string, n: number): string {
  const who = vehicle === 'on foot' ? 'To deliver on foot' : `For a ${vehicle}`;
  return `${who} we need these ${word(n)}, plus a work permit if you have one.`;
}

export const DOCS = {
  subtitle: 'Documents',
  loading: 'Loading your documents',
  leadStart: (vehicle: string, n: number) => `${forVehicle(vehicle, n)} Take a clear photo of each, with all four corners showing.`,
  leadReady: (vehicle: string, n: number) =>
    `${forVehicle(vehicle, n)} ${n === 2 ? 'Both are added.' : `All ${word(n)} are added.`} A person will check each document.`,
  leadShort: (vehicle: string, n: number) => forVehicle(vehicle, n),
  leadCooldown: (vehicle: string, n: number) => `${forVehicle(vehicle, n)} Your documents are ready to go.`,
  leadSubmitError: (vehicle: string, n: number) => `${forVehicle(vehicle, n)} Your documents are still added.`,
  add: 'Add',
  addDoc: (lower: string) => `Add ${lower}`,
  /** Derived: only the expiry date is missing (Docs-AddExpiry's heading). */
  addExpiry: 'Add the expiry date',
  submit: 'Submit for review',
  submitting: 'Sending your documents',
  tryAgain: 'Try again',
  retake: 'Retake',
  retakeDoc: (lower: string) => `Retake ${lower}`,
  replaceDoc: (lower: string) => `Replace ${lower}`,
  takePhoto: 'Take a photo',
  chooseAnother: 'Choose another file',
  cancelUpload: 'Cancel upload',
  expires: (date: string) => `Expires ${date}`,
  noExpiry: 'No expiry',
  notAddedYet: 'Not added yet',
  needsDateLine: 'Add the expiry date',
  uploading: 'Uploading',
  counter: (added: number, n: number) => `${added} of ${n} added. You can send them for review once all ${n} are added.`,
  tooSmallHint: 'For a photo that is too small, fill the frame with the document.',
  failedStatus: (n: number) => (n === 1 ? "1 document didn't upload" : `${n} documents didn't upload`),
  pausedStatus: (n: number) =>
    n === 1 ? "1 upload stopped. It carries on when you're back online." : `${n} uploads stopped. They carry on when you're back online.`,
  missingTitle: (n: number) => (n === 1 ? '1 thing is missing' : `${n} things are missing`),
  missingDoc: (label: string) => `${label} is not added.`,
  missingExpiry: (lower: string) => `The expiry date for the ${lower} is missing.`,
  cooldownTitle: (mins: number) => `You can send these in ${minutes(mins)}`,
  cooldownBody: 'We limit how often documents are sent, so each set gets a full check.',
  submitErrorTitle: "We couldn't send your documents",
  submitErrorBody: 'Nothing was lost. Check your connection and try again.',
  offlineBody: 'You can check your documents. Sending for review works again once you are back online.',
  pausedOfflineBody: 'Uploads carry on when you are back online. Nothing you added is lost.',
  loadErrorTitle: "We couldn't load your documents",
  loadErrorBody: 'Anything you already added is safe with us.',
} as const;

/** KycDocumentState → badge (Ref-DocumentStates). Outline or info only: never orange, green or red. */
export const BADGE = {
  added: 'Added',
  sent: 'Sent',
  inReview: 'In review',
  approved: 'Approved',
  rejected: 'New upload needed',
  expired: 'Expired',
  replaced: 'Replaced',
  notAdded: 'Not added',
  needsDate: 'Needs a date',
  failed: "Didn't upload",
  paused: 'Paused',
} as const;

/** Why a row's upload stopped, and what its own button does (Docs-UploadErrors, -Mixed, -Interrupted). */
export const FAILURE = {
  'too-small': { line: 'Too small to read. Retake it closer.', action: 'Retake' },
  checksum: { line: "Didn't arrive complete. Try again.", action: 'Try again' },
  'too-large': { line: 'This file is over 15 MB. Choose a smaller file or take a photo instead.', action: 'Take a photo' },
  unreadable: { line: "We can't open this file. Choose a PDF or a photo.", action: 'Choose another file' },
  paused: { line: "Upload paused because you went offline. It carries on when you're back, or try now.", action: 'Try again' },
  'link-closed': { line: 'The upload took too long and its link closed. Try again to send it.', action: 'Try again' },
  /** Derived: the server's 30-day check disagreed with the phone's (clock skew). */
  'too-soon': { line: 'This document expires less than 30 days from today. Add it once you have the renewed one.', action: 'Retake' },
  /** Derived: a 5xx while sending. */
  server: { line: "Something went wrong on our side. Try again.", action: 'Try again' },
} as const;

export const DOC_VIEW = {
  expiry: 'Expiry date',
  status: 'Status',
  notSent: 'Not sent yet. It goes to review with the rest when you submit.',
  takeNew: 'Take a new photo',
  addExpiryTitle: 'Add the expiry date',
  addExpiryBody: (noun: string) => `Your ${noun} photo is added. Type the expiry date printed on it.`,
  saveExpiry: 'Save expiry date',
  takeNewInstead: 'Take a new photo instead',
  /** Derived: AddExpiry when this phone no longer holds the photo it attached (KycDocument has no stored_object_id). */
  addExpiryNoPhoto: 'Take a new photo of it to add the date.',
} as const;

export const CAPTURE = {
  starting: 'Starting the camera',
  fit: (noun: string) => `Fit the whole ${noun} inside the frame`,
  flat: 'Lay it flat. Turn off the torch if you see glare.',
  torch: 'Torch',
  takePhoto: 'Take photo',
  chooseFile: 'Choose a file (PDF or photo)',
  choosePdf: 'Choose a PDF instead',
  deniedTitle: 'Allow the camera to add documents',
  deniedBody: 'HalalGoes uses the camera only when you take a document photo. Turn it on in your phone settings, or choose a PDF instead.',
  openSettings: 'Open settings',
  reviewCheck: 'Can you read every word, and are all four corners showing? If not, retake it.',
  expiryLabel: (noun: string) => `Expiry date on the ${noun}`,
  expiryHelper: (noun: string) => `As printed on the ${noun}. Must be at least 30 days from today.`,
  expiryHelperShort: 'Must be at least 30 days from today.',
  /** Derived: a date that is not a real day. */
  expiryInvalid: 'Enter the expiry date: day, month and year.',
  day: 'Day',
  month: 'Month',
  year: 'Year',
  usePhoto: 'Use this photo',
  retake: 'Retake',
  useFile: 'Use this file',
  chooseDifferent: 'Choose a different file',
  takeInstead: 'Take a photo instead',
  fileSent: (noun: string) => `We send the whole file. Check it shows the front of your ${noun} and the expiry date.`,
  tooLargeTitle: 'This file is over 15 MB',
  tooLargeBody: 'Choose a smaller file, or take a photo instead.',
  unreadableTitle: "We can't open this file",
  unreadableBody: 'Choose a PDF or a photo.',
  tooSoon: (noun: string, date: string) =>
    `This ${noun} expires on ${date}, less than 30 days away. Add it once you have the renewed ${noun}; your other documents are saved.`,
  changeDate: 'Change the date',
  wrongDate: 'If you entered the wrong date',
  selfieFit: 'Fit your face inside the oval',
  selfieBody: 'Face the camera in good light. Take off sunglasses. Head coverings worn every day are fine.',
  selfieCheck: 'Is your whole face clear and well lit? This photo has no expiry date.',
  selfieDeniedTitle: 'Allow the camera to take your photo',
  selfieDeniedBody:
    'The photo of you has to be taken live with the front camera, so there is no file option. Turn the camera on in your phone settings.',
  selfieTooSmallTitle: 'This photo is too small to check',
  selfieTooSmallBody: 'Hold the phone closer so your face fills the oval, then take it again.',
  interruptedOffline: 'Uploads carry on when you are back online.',
  interruptedTitle: "Your photo didn't finish sending",
  interruptedBody: "It carries on when you're back online, or try now. You don't need to take it again.",
  /** Derived: the camera failed to take the picture. */
  shotFailed: "The photo didn't take. Try again.",
  size: (bytes: number) => `· ${(bytes / 1_048_576).toFixed(1)} MB`,
} as const;

export const NOTIFY = {
  sentTitle: 'Your documents are sent',
  sentBody: 'A person will check them.',
  title: 'Get told when we decide on your application',
  body: 'Turn on notifications so we can reach you. Once you ride, delivery offers also come this way when the app is closed. Either choice leaves your documents sent.',
  turnOn: 'Turn on notifications',
  notNow: 'Not now',
} as const;

export const REVIEW = {
  subtitle: 'Review',
  loading: 'Checking for updates',
  sentTitle: 'Your documents are sent',
  sentBody: "They're waiting for a person to pick them up. We aim to decide within 72 hours.",
  waitingTitle: "We're checking your documents",
  waitingBody: 'A person checks every document. We aim to decide within 72 hours.',
  checkedSoFar: (done: number, n: number) => `${done} of ${n} checked so far.`,
  liveRejected: (label: string) => `${label} needs a new upload. You can fix it once we've finished checking the rest.`,
  willNotify: "We'll send you a notification when we decide.",
  slowTitle: 'This is taking longer than usual',
  slowBody: "We aim to decide within 72 hours, and yours has taken longer. Your documents are still with us. You don't need to send them again.",
  slowNotify: "We'll send you a notification when we decide. If you want to ask about it, call support.",
  notifOffTitle: 'Notifications are off',
  notifOffBody: 'When you open the app, this screen shows the decision. Turn notifications on in Settings to hear about it straight away.',
  openSettings: 'Open settings',
  reconnectTitle: 'Reconnecting for live updates',
  reconnectBody: 'This screen may be out of date. Check now to see the latest.',
  checkNow: 'Check now',
  sent: 'Sent',
  closeApp: "You can close the app. You can't go online until your documents are approved.",
  approvedTitle: 'Your documents are approved',
  approvedBody: (date: string) => `Checked ${date}. One step left: tell Stripe where to send your pay.`,
  /** Derived: approved with no decision date on the status. */
  approvedBodyNoDate: 'One step left: tell Stripe where to send your pay.',
  setUpPayouts: 'Set up payouts',
  errorTitle: "We couldn't check for updates",
  errorBody: 'Your documents are still with us. Nothing is lost.',
} as const;

/** DocumentRejectionReasonCode → the "Why" line (Ref-RejectionReasons). OTHER has none: the note is the reason. */
export const WHY: Record<RejectionCode, string | null> = {
  ILLEGIBLE: "We couldn't read it",
  EXPIRED: 'It has expired',
  WRONG_DOCUMENT_TYPE: "It's a different document",
  NAME_MISMATCH: "The name doesn't match your details",
  DOB_MISMATCH: "The date of birth doesn't match your details",
  ADDRESS_MISMATCH: "The address doesn't match",
  PLATE_MISMATCH: "The plate doesn't match your vehicle",
  UNRECOGNISED_CERTIFIER: "We don't recognise who issued it",
  SUSPECTED_FORGERY: "We couldn't confirm it is genuine",
  SUSPECTED_ALTERATION: 'It looks edited or changed',
  INCOMPLETE_PAGES: 'Pages or corners are missing',
  OTHER: null,
};

export const FIX = {
  subtitle: 'Fix documents',
  progress: 'Fix your documents',
  loading: 'Loading your documents',
  title: (n: number) => (n === 1 ? 'Fix 1 document' : `Fix ${n} documents`),
  badgePlate: 'Check your plate',
  badgeDetails: 'Check your details',
  badgeSupport: 'Call support',
  badgeUpload: 'New upload needed',
  why: 'Why',
  note: "Reviewer's note",
  quoted: (note: string) => `“${note}”`,
  nameEntered: 'Name you entered',
  plateEntered: 'Plate you entered',
  twoSteps: 'Two steps, in this order',
  stepName: 'Fix your name in your details.',
  stepDob: 'Fix your date of birth in your details.',
  stepPlate: 'Fix the plate you entered.',
  stepPhoto: (noun: string) => `Take a new photo of your ${noun}.`,
  done: 'Done.',
  fixDetails: 'Fix your details, then take a new photo',
  fixPlate: 'Fix your plate, then take a new photo',
  takeNew: 'Take a new photo',
  takeNewOf: (lower: string) => `Take a new photo of ${lower}`,
  rightDocument: 'Take a photo of the right document',
  choosePdf: 'Choose a PDF instead',
  forgeryLine: 'You can’t replace this document in the app. Our support team will go through it with you.',
  partialTitle: 'Everything else is approved',
  partialBody: 'Only this document is checked again.',
  finalTitle: 'This is your last chance to resend',
  finalBody: 'If a document is turned down again, your application closes and only support can reopen it. Check each photo carefully.',
  newPhoto: (date: string | null) => (date ? `New photo · expires ${date}` : 'New photo'),
  onlyNew: (lower: string) => `Only the new ${lower} will be checked.`,
  /** Derived: more than one replaced. */
  onlyNewMany: 'Only the new documents will be checked.',
  send: 'Send for review again',
  resending: (lower: string) => `Sending your new ${lower} for review.`,
  resendingStatus: 'Sending your document',
  cooldownTitle: (mins: number) => `You can send this in ${minutes(mins)}`,
  cooldownBody: 'We limit how often documents are sent, so each one gets a full check.',
  errorTitle: "We couldn't send your document",
  errorBody: 'Nothing was lost. Try again.',
  offlineBody: 'Nothing was sent. Connect to mobile data or Wi-Fi, then try again.',
  waiting: (noun: string) => `Your new ${noun} is added and waiting to be sent.`,
  nothingTitle: (lower: string) => `Add a new photo of your ${lower}`,
  nothingBodyPlate: (noun: string) => `Your plate is saved, but we can only check your ${noun} again with a new photo of it.`,
  /** Derived: the details twin of the plate line. */
  nothingBodyDetails: (noun: string) => `Your details are saved, but we can only check your ${noun} again with a new photo of it.`,
  /** Derived: Fix-Error's twin for a failed load. */
  loadErrorTitle: "We couldn't load your documents",
} as const;

export const FIX_EDIT = {
  detailsTitle: 'Your details',
  vehicleTitle: 'Your vehicle',
  dobLabel: 'Enter your date of birth as it is on your licence',
  detailsNext: 'Next, take a new photo of your licence. We can only check it again with a new photo.',
  plateNext: 'Next, take a new photo of your registration. We can only check it again with a new photo.',
  save: 'Save and take a new photo',
  savingDetails: 'Saving your details.',
  savingPlate: 'Saving your plate.',
  underage: (minAge: number) => `Check your date of birth. You must be ${minAge} or older to ride with HalalGoes. If this date is right, call support.`,
  detailsErrorTitle: "We couldn't save your details",
  detailsServerBody: 'Something went wrong on our side. Your answers are still here.',
  emailInUseBody: "The email on your application is now on another account. Call support and we'll sort out your email. Your other answers are still here.",
  detailsOfflineBody: "Your details aren't saved yet. They're kept on this phone. Try again once you are back online.",
  plateErrorTitle: "We couldn't save your plate",
  plateServerBody: 'Something went wrong on our side. Your answer is still here.',
  plateOfflineBody: "Your plate isn't saved yet. It's kept on this phone. Try again once you are back online.",
} as const;
