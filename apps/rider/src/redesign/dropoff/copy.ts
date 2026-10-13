/**
 * Every word the drop-off leg shows, verbatim from the DL boards (rider manifest Appendix A, DL,
 * and the board text). Names in the boards ("Aisha M.", "88 Brimley Rd", "HG-4K2M-9T",
 * "9:58 pm") are the data; the functions here put the assignment's own values in their place.
 *
 * Lines no board draws are marked "Not drawn"; each follows the nearest board's voice. The OTP
 * wrong-code and locked lines are redrawn for contract PR #290 (manifest §5 conflict 1: no photo
 * after a locked code; support takes over).
 */
import type { Schema } from '@hg/api-client';

import type { HandoverMethod, PodMethod } from './routes';

type DeliveryInstruction = Schema['DeliveryInstruction'];

export const DROPOFF_TITLE = 'Drop-off';
export const HANDOVER_TITLE = 'Hand it over';
export const PROOF_TITLE = 'Proof of delivery';
export const DELIVERED_TITLE = 'Delivered';

export const SUBTITLE = {
  goToCustomer: 'Step 3 of 4 · Go to the customer',
  handOver: 'Step 4 of 4 · Hand it over',
  handoverOrder: (code: string) => `Step 4 of 4 · ${code}`,
  proof: (code: string) => `Step 4 of 4 · Proof · ${code}`,
};

export const DROP_BUTTON = {
  arrived: "I'm here",
  arrivedOverride: "Continue: I'm here",
  callCustomer: 'Call customer',
  handOver: 'Hand it over',
  checkCode: 'Check the code',
  checkingCode: 'Checking the code',
  cantFindCode: "The customer can't find the code",
  markDelivered: 'Mark as delivered',
  takePhoto: 'Take photo',
  takeThePhoto: 'Take the photo',
  retake: 'Retake',
  retakePhoto: 'Retake photo',
  uploadAgain: 'Try uploading again',
  uploading: 'Uploading photo',
  openSettings: 'Open Settings',
  enterCode: "Enter the customer's code",
  goOnline: 'Go online',
};

/** Step 3 heading (DL/DropoffEnRoute, DropoffDoNotCall). */
export const enRouteHeading = (name: string, instructions: readonly DeliveryInstruction[]) =>
  instructions.includes('MEET_IN_LOBBY') ? `Meet ${name} in the lobby` : `Go to ${name}`;

/** Step 4 heading, from `delivery_instructions` (DL/DropoffArrived note). */
export const doorHeading = (name: string, instructions: readonly DeliveryInstruction[]) => {
  if (instructions.includes('LEAVE_AT_DOOR')) return `Leave it at ${name}'s door`;
  if (instructions.includes('MEET_IN_LOBBY')) return `Meet ${name} in the lobby`;
  return `Hand over to ${name}`;
};

export const CUSTOMER_ASKED = 'Customer asked';
export const ADDRESS = 'Address';
export const PROOF_NEEDED = 'Proof needed';
export const PROOF_NEEDED_NEXT = 'Proof needed next';

/** The "Customer asked" rows, one per `DeliveryInstruction` (MEET_AT_DOOR is not drawn). */
export const INSTRUCTION: Record<DeliveryInstruction, string> = {
  LEAVE_AT_DOOR: 'Leave at the door',
  DO_NOT_RING_BELL: "Don't ring the bell",
  DO_NOT_CALL: "Please don't call",
  MEET_AT_DOOR: 'Meet at the door',
  MEET_IN_LOBBY: 'Meet in the lobby',
};

/** A sentence that ends on a name: "Aisha M." already carries its full stop. */
const endSentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);

/** "88 Brimley Rd, Scarborough, ON" → "88 Brimley Rd". */
export const street = (address: string) => address.split(',')[0]!.trim();

/** `special_instructions`, verbatim and never truncated, in quotes as drawn. */
export const quoted = (text: string) => `"${text}"`;

/**
 * "Proof needed" on step 3 and "Proof needed next" on the handover, from `required_pod_method`
 * (DL/DropoffEnRoute note: OTP = "The customer's code"; DL/Handover, HandoverOtp).
 */
export const PROOF_LABEL: Record<PodMethod, string> = {
  PHOTO: 'A photo at the door',
  OTP: "The customer's code",
  PHOTO_WITH_ATTESTATION: 'A photo and a short statement',
};

/** The line under the address at the door, keyed on `required_pod_method` (DL/DropoffArrived). */
export const doorLine = (method: PodMethod, name: string) => {
  switch (method) {
    case 'OTP':
      return `Ask ${name} for their 4-digit code.`;
    case 'PHOTO_WITH_ATTESTATION':
      return 'Take a photo and write what happened.';
    default:
      return 'Put the bag down, take the photo, then mark it as delivered.';
  }
};

export const DO_NOT_CALL_LINE = "They asked not to be called. Call only if you can't find them.";

/** DL/DropoffArriving. */
export const ARRIVING = {
  title: "Recording that you're here",
  body: 'Stay where you are until this finishes.',
};

/** DL/DropoffArriveFailed. */
export const ARRIVE_FAILED = {
  title: "We couldn't record that you're here",
  body: (name: string) => endSentence(`Something went wrong on our side. Try again. You can still call ${name}`),
};

/** DL/DropoffGeofence: 422 GEOFENCE_REQUIRED on ARRIVED_AT_DROPOFF. */
export const GEOFENCE = {
  title: "We can't place you at the drop-off",
  /** The street only, as drawn ("at 88 Brimley Rd."): the address up to its first comma. */
  body: (address: string) => `Your location doesn't show you at ${street(address)}. If you're there, say why and carry on.`,
  label: "Why you're continuing",
  /** Not drawn for the drop-off (the board names the helper only): the pickup sheet's line, at the door. */
  helper: "At least 5 characters. For example: GPS is off by a block; I'm at the door.",
};

/** DL/TripNoConnection, DropoffArriveQueued: proof never queues, the bag stays with the rider. */
export const KEEP_BAG = {
  title: "Keep the bag until you're back online",
  queuedBody: 'The proof needs a connection. Step outside or toward a window.',
  offlineBody: (name: string) =>
    `The proof needs a connection. Step outside or toward a window, then carry on. Call ${name} to say you're here.`,
  bannerBody: 'Proof of delivery needs a connection. Steps like "I\'m here" are saved and send when you\'re back online.',
  helper: 'Turns on when your connection is back.',
};

/* ------------------------------------------------------------------ R25 hand it over */

export const HANDOVER = {
  title: 'How will you hand it over?',
  otpTitle: 'Who will you hand it to?',
  otpBody: "This order needs the customer's code. Keep hold of the bag until their code is accepted.",
};

/** The roomy radio rows (DL/Handover, HandoverOtp). */
export const HANDOVER_LABEL: Record<HandoverMethod, string> = {
  HANDED_TO_CUSTOMER: 'To the customer',
  LEFT_AT_DOOR: 'Leave it at the door',
  LEFT_WITH_RECEPTION: 'Leave it with reception or concierge',
  HANDED_TO_OTHER_PERSON: 'To someone else at the address',
};

export const HANDOVER_OTP_LABEL: Partial<Record<HandoverMethod, string>> = {
  HANDED_TO_CUSTOMER: 'The customer',
  HANDED_TO_OTHER_PERSON: 'Someone else at the address',
  LEFT_WITH_RECEPTION: 'Leave it with reception or concierge',
};

/** The handover board's primary: what it opens, or what to do first. */
export const nextLabel = (method: PodMethod, picked: boolean) => {
  if (method === 'OTP') return picked ? "Next: enter the customer's code" : 'Choose who you will hand it to';
  if (!picked) return 'Choose how you will hand it over';
  return method === 'PHOTO_WITH_ATTESTATION' ? 'Next: photo and a short statement' : 'Next: take the photo';
};

/* ------------------------------------------------------------------ R26 the customer's code */

export const OTP = {
  title: 'Ask the customer for their 4-digit code',
  body: "It's on their order and tracking screens in the HalalGoes app. Type what they read out.",
  label: "Customer's code",
  helper: 'Turns on when the code has 4 digits.',
  helpTitle: "The customer can't find the code",
  helpBody: "It's on their order and tracking screens in the HalalGoes app, under Delivery code.",
  acceptedTitle: 'Code accepted',
  accepted: (name: string) => `Code accepted. Hand the bag to ${name} now.`,
  lockedTitle: 'The code is locked after 5 tries',
  /** Redrawn (#290): no photo after a lock, HalalGoes support takes over (manifest §5 conflict 1). */
  lockedBody: 'HalalGoes support is taking over this delivery. Keep the bag with you and call HalalGoes support to finish it.',
  /** Not drawn as a sentence: 5xx while checking (PodAttestationFailed's voice). */
  failedTitle: "We couldn't check the code",
  failedBody: 'Your code is kept. Stay nearby and try again.',
};

/**
 * 422 DELIVERY_CODE_INCORRECT, redrawn for #290: the board's "After 5 wrong codes, you'll take a
 * photo instead" is gone (no photo fallback), and the count comes from `attempts_remaining`.
 */
export const wrongOtp = (attemptsRemaining: number | null) => {
  const line = "That isn't the customer's code. Ask them to read it again from their order.";
  if (attemptsRemaining == null) return line;
  return `${line} ${attemptsRemaining} ${attemptsRemaining === 1 ? 'try' : 'tries'} left.`;
};

/* ------------------------------------------------------------------ R27 photo */

export const PHOTO = {
  title: 'Take a photo of the bag at the door',
  body: "Show the bag and the door or unit number in one photo. Don't include people.",
  bagFor: 'Bag for',
  camera: 'Camera view',
  reviewTitle: 'Check the photo',
  reviewBody: 'Make sure the bag and the door or unit number are clear.',
  yourPhoto: (time: string) => `Your photo, ${time}`,
  uploadingTitle: 'Uploading your photo',
  uploadingBody: "Keep the app open. It's kept on your phone until it's sent.",
  failedTitle: "Your photo didn't upload",
  failedBody: "It's kept on your phone. Try again when you have signal. The delivery isn't marked done until it uploads.",
  /** Not drawn: the camera would not open (no camera on the device). */
  noCameraTitle: "We couldn't open the camera",
  noCameraBody: 'Close other apps that use the camera, then try again.',
};

export const CAMERA_OFF = {
  title: 'Camera is off for HalalGoes',
  photoBody: 'The proof photo needs the camera. Allow it in Settings, then come back here.',
  attestationBody: 'The photo for your statement needs the camera. Allow it in Settings, then come back here.',
};

/** DL/PodMethodMismatch: 422 POD_METHOD_MISMATCH. */
export const MISMATCH = {
  title: 'This order needs a different proof',
  otpBody: "The customer's delivery choice asks for their 4-digit code instead of a photo.",
  /** Not drawn: the other direction (a photo is needed). */
  photoBody: "The customer's delivery choice asks for a photo at the door instead of a code.",
};

/** DL/DeliveredPodMissing: 422 POD_REQUIRED on DELIVERED. */
export const POD_MISSING = {
  title: 'We need a photo before this counts as delivered',
  body: 'This order needs a photo at the door. Take it now, then you\'re done.',
};

/* ------------------------------------------------------------------ R28 photo and statement */

export const ATTESTATION = {
  title: 'Photo and a short statement',
  leftAtDoorTitle: 'Leave it at the door with a photo and a statement',
  leftAtDoorBody: (name: string) =>
    `${name} asked for it to be left at the door. Take a photo of the bag where you left it and say what happened.`,
  photoTaken: (time: string) => `Photo taken ${time}`,
  label: 'What happened',
  helper: "At least 5 characters. For example: the customer's code was locked; I handed it to them at the door.",
  leftAtDoorHelper: 'At least 5 characters. For example: no answer at the door or by phone; left it by the door as asked.',
  /** Not drawn as a visible line (a board note): when the primary turns on. */
  submitHelper: 'Turns on once there is a photo, the statement has text and the box is ticked.',
  failedTitle: "We couldn't save your proof",
  failedBody: 'Your photo and statement are kept. Stay nearby and try again.',
};

/** The checkbox, never pre-ticked, built from the HandoverMethod chosen. */
export const ATTEST_LABEL: Record<HandoverMethod, string> = {
  HANDED_TO_CUSTOMER: 'I confirm I handed the order to the customer at this address',
  LEFT_AT_DOOR: 'I confirm I left the order at the door of this address',
  LEFT_WITH_RECEPTION: 'I confirm I left the order with reception at this address',
  HANDED_TO_OTHER_PERSON: 'I confirm I handed the order to someone at this address',
};

/* ------------------------------------------------------------------ R29 mark delivered, delivered */

export const MARKING = {
  title: 'Marking as delivered',
  body: 'Stay by the door until this finishes.',
};

export const DELIVER_FAILED = {
  title: 'Stay nearby until this sends',
  body: "We couldn't mark it as delivered. Your proof is saved. Try again.",
  row: 'Proof saved · delivery not sent yet',
};

export const DELIVERED = {
  title: (name: string) => `Delivered to ${name}`,
  orderSubtitle: (code: string) => `Order ${code}`,
  recorded: (method: PodMethod, time: string) => {
    switch (method) {
      case 'OTP':
        return `Customer's code confirmed at ${time}.`;
      case 'PHOTO_WITH_ATTESTATION':
        return `Photo and your statement recorded at ${time}.`;
      default:
        return `Photo proof recorded at ${time}.`;
    }
  },
  estimate: 'Estimated earnings for this delivery',
  estimateNote: "This is an estimate. The final amount appears in Earnings once it's finalised.",
  /** Not drawn as a heading: the lines once the ledger has them. */
  earnings: 'Earnings for this delivery',
  offlineTitle: "You're now offline",
  offlineBody: "You asked to go offline after this delivery. You won't get offers.",
};
