/**
 * Every word the WP11 screens show, verbatim from the boards: HW/Deliveries, HW/DeliveryDetail,
 * HW/WhatsNew (and their variants' data blocks), PA/Account-DocView*, PA/Account-Replace-*.
 *
 * Lines marked "derived" have no board of their own; they follow a drawn sibling's pattern and
 * are listed in the PR for the owner.
 */
import type { Schema } from '@hg/api-client';

import { DOC } from '../documents/copy';
import type { RiderDocType } from '../documents/data';
import { PAUSED } from '../earnings/copy';
import type { StateCopy } from '../earnings/copy';

/** The paused body every money screen shares (HW Deliveries-not-active, Delivery-not-active). */
const PAUSED_BODY = PAUSED.summary.body;

/* ------------------------------------------------------------------ R41 Deliveries */

export const DELIVERIES = {
  title: 'Deliveries',
  back: 'Earnings',
  intro: 'Completed deliveries, newest first. Tap one for its times, addresses and items.',
  loading: 'Loading deliveries',
  offlineSaved: (at: string) => ({ title: "You're offline", body: `These deliveries are as saved at ${at}.` }),
  noDetail: 'Details aren’t available for this one.',
  reversed: 'Reversed',
  more: 'Show older deliveries',
  loadingMore: 'Loading older deliveries',
  moreError: { title: "We couldn't load older deliveries", body: 'The deliveries above are up to date.', action: 'Try again' },
  moreOffline: "Older deliveries load when you're back online.",
  end: "That's every delivery so far.",
  empty: {
    title: 'No deliveries yet',
    body: 'Each delivery you complete shows here, grouped by day, with what it earned.',
    more: 'Go online from Home to get offers.',
    action: 'Go to Home',
  },
  error: {
    title: 'We couldn’t load your deliveries',
    body: 'Your signal may be weak. What you earned is not affected. Try again in a moment.',
    action: 'Try again',
  },
  offline: { title: 'You’re offline', body: 'Deliveries load when you’re back online. What you earned is not affected.', action: 'Try again' },
  rateLimited: { title: 'Too many tries in a row', body: 'What you earned is not affected. This screen just needs a short pause.', action: 'Try again' },
  paused: { title: "Your account is paused, so deliveries can't be shown", body: PAUSED_BODY, action: 'Go to Account' },
} satisfies Record<string, unknown>;

/* ------------------------------------------------------------------ R42 One delivery */

export const DELIVERY_BACK = { deliveries: 'Deliveries', entry: 'Delivery earnings', tip: 'Tip' } as const;

type AssignmentState = Schema['AssignmentState'];

/** The status line's word and icon (StatusLabel stand-in). Only the two drawn terminal views. */
export const DELIVERY_STATE: Partial<Record<AssignmentState, { word: string; icon: 'check' | 'close' }>> = {
  DELIVERED: { word: 'Delivered', icon: 'check' },
  CANCELLED_BY_PLATFORM: { word: 'Order cancelled', icon: 'close' },
};

export const DELIVERY = {
  title: 'Delivery',
  loading: 'Loading this delivery',
  cancelledAfterArrival: 'The order was cancelled after you reached the restaurant.',
  /** Derived: cancelled before the rider reached the restaurant (the note says only that it was cancelled). */
  cancelled: 'The order was cancelled.',
  earned: 'You earned',
  earnedPending: 'You earned (pending)',
  /** Derived: a reversed DELIVERY line never reads as paid (HW Deliveries-reversed). */
  earnedReversed: 'You earned (reversed)',
  workedOut: 'See how it was worked out',
  earnPlaceholderTitle: 'Earnings for this job',
  earnPlaceholderLink: 'See Earnings activity',
  where: 'Where',
  pickup: 'Pickup',
  dropoff: 'Drop-off',
  streetOnly: 'Only the street is kept after a delivery.',
  beforePickup: 'This job ended before pickup.',
  distance: 'Paid distance',
  when: 'When',
  times: {
    accepted: 'Accepted',
    atRestaurant: 'At the restaurant',
    pickedUp: 'Picked up',
    atDropoff: 'At the drop-off',
    delivered: 'Delivered',
  },
  waited: (wait: string) => `You waited ${wait} at the restaurant.`,
  noWait: 'Wait time wasn’t recorded for this delivery.',
  items: 'Items',
  handover: 'Handover',
  problemTitle: 'Problem with this delivery?',
  problemBody: 'Ask HalalGoes support',
  tryAgain: 'Try again',
  seeEarned: 'See what it earned',
  error: { title: 'We couldn’t load this delivery', body: 'What you earned for it is not affected. Try again in a moment.', action: 'Try again' },
  offline: {
    title: 'You’re offline',
    body: 'This delivery loads when you’re back online. What you earned for it is not affected, and its earnings line is still on this phone.',
    action: 'Try again',
  },
  rateLimited: { title: 'Too many tries in a row', body: 'What you earned for it is not affected. This screen just needs a short pause.', action: 'Try again' },
  unavailable: {
    title: "This delivery isn't available",
    body: 'It may have been passed to another rider before pickup. Anything you earned for it is in your earnings activity.',
    action: 'Go to Earnings activity',
  },
  paused: { title: "Your account is paused, so this delivery can't be shown", body: PAUSED_BODY, action: 'Go to Account' },
} satisfies Record<string, unknown>;

/** The Earnings line's link to its job (EA/EntryDetail "Delivery details"), drawn on WP10's screen. */
export const LINE_DELIVERY = { title: 'Delivery details', sub: 'Times, addresses and items' } as const;

/** HandoverMethod → the Handover card's line. "Left at the door" is drawn; the rest are derived from the DL attestation wording. */
export const HANDOVER: Record<Schema['HandoverMethod'], string> = {
  LEFT_AT_DOOR: 'Left at the door',
  HANDED_TO_CUSTOMER: 'Handed to the customer',
  LEFT_WITH_RECEPTION: 'Left with reception',
  HANDED_TO_OTHER_PERSON: 'Handed to someone at the address',
};

/** PodMethod → the proof line under it, only when `pod_recorded`. OTP is derived from DL/DeliveredOtp. */
export const POD: Record<Schema['PodMethod'], string> = {
  PHOTO: 'Photo taken at the door.',
  PHOTO_WITH_ATTESTATION: 'Photo and your statement recorded.',
  OTP: 'Customer’s code confirmed.',
};

/** "14 minutes", "1 minute"; under a minute is derived. */
export function waitWords(seconds: number): string {
  const m = Math.round(Math.max(0, seconds) / 60);
  if (m < 1) return 'less than a minute';
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/* ------------------------------------------------------------------ R49 Account documents */

/** The sentence noun: the insurance boards say "policy". */
function nounOf(type: RiderDocType): string {
  return type === 'VEHICLE_INSURANCE' ? 'policy' : DOC[type].noun;
}

export const DOC_VIEW = {
  back: 'Documents',
  status: 'Status',
  expires: 'Expires',
  noExpiry: 'No expiry',
  loading: 'Loading the document',
  download: 'Download a copy',
  downloadNote: 'The download link works for 2 minutes, to keep your document private.',
  replace: 'Replace this document',
  error: { title: "We couldn't get your document", body: 'It may have been replaced, or the connection dropped. Try again.', action: 'Try again' },
  expired: {
    title: 'The download link has closed',
    body: 'Links close after 2 minutes to keep your document private. Get a new one.',
    action: 'Get a new link',
  },
  why: 'Why',
  note: "Reviewer's note",
  quoted: (note: string) => `“${note}”`,
  takeNew: 'Take a new photo',
  choosePdf: 'Choose a PDF instead',
  rejectedAnnounce: (lower: string, noun: string) =>
    `Your new ${lower} needs a new upload. You can keep riding until your current ${noun} expires.`,
} as const;

export const REPLACE = {
  title: 'Documents',
  confirmTitle: (type: RiderDocType) => `Replace your ${DOC[type].lower}?`,
  confirmBody: (type: RiderDocType) =>
    type === 'PROFILE_PHOTO'
      ? // Derived: a photo of you has no expiry.
        'A person checks your new photo, usually within 72 hours. You can keep riding while we check it.'
      : `A person checks your new ${nounOf(type)}, usually within 72 hours. You can keep riding while we check it, as long as your current ${nounOf(type)} hasn't expired.`,
  confirm: 'Take a new photo',
  cancel: 'Keep current',
  newRow: (label: string) => `${label} (new)`,
  earlierRow: (label: string) => `${label} (earlier)`,
  currentRow: (label: string) => `${label} (current)`,
  addedHeading: (type: RiderDocType) => `Send your new ${DOC[type].noun}`,
  addedBody: (type: RiderDocType) =>
    `It is added but not sent yet. A person checks it once you send it, usually within 72 hours. You can keep riding while we check it, as long as your current ${nounOf(type)} hasn't expired.`,
  addedLine: 'Added · not sent yet',
  added: 'Added',
  send: 'Send for review',
  /** Derived: submitRiderDocuments after approval is Needs API (manifest §5 #42), so Send stays off. */
  sendUnavailable: "Sending a replacement for review isn't in the app yet. Call support and we'll check it for you.",
  takeNew: 'Take a new photo',
  uploading: 'Uploading',
  failedAnnounce: (type: RiderDocType) => `Your new ${DOC[type].noun} didn't upload`,
  /** Account-Replace-TooSmall / -TooLarge / -LinkExpired, under the current row. */
  unchanged: (type: RiderDocType) => `Nothing was replaced. Your current ${nounOf(type)} is unchanged until a new one uploads.`,
  /** Account-Replace-Rejected: the earlier document, still valid, is the one in use. */
  inUse: 'In use',
  keepRidingUntil: (type: RiderDocType, date: string) =>
    `You can keep riding until your current ${DOC[type].noun} expires on ${date}. Upload a new one before then. Money you've already earned is still paid out.`,
  inReviewTitle: (type: RiderDocType) => `We're checking your new ${DOC[type].noun}`,
  inReviewLines: (type: RiderDocType) => [
    'A person checks it, usually within 72 hours.',
    `You can keep riding while we check it, as long as your current ${nounOf(type)} hasn't expired.`,
  ],
} as const;

/* ------------------------------------------------------------------ R43 What's new */

export const WHATS_NEW = {
  title: "What's new",
  back: 'Account',
  newIn: (v: string) => `New in version ${v}`,
  newSince: (v: string) => `New since version ${v}`,
  version: (v: string) => `Version ${v}`,
  reread: "You can read these again in Account, under What's new.",
  gotIt: 'Got it',
  row: "What's new",
  onVersion: (v: string) => `You're on version ${v}`,
  pageLead: (v: string) => `You're on version ${v}. Newest first.`,
  isNew: 'New',
  loading: 'Loading release notes',
  empty: { title: 'No release notes yet', body: 'When the app is updated, what changed for riders shows here.' },
  error: {
    title: "We couldn't open the release notes",
    body: 'Nothing else in the app is affected. Try again, or check after the next update.',
    action: 'Try again',
  },
} as const;

export type { StateCopy };
