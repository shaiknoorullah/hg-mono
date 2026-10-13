/**
 * The offer's words, verbatim from the approved Shift & offers boards (SH canvas, section 2
 * "Offer — 30 seconds, full screen, not dismissable"; rider manifest R17 and Appendix A).
 *
 * Nothing here says "seal": pickup is the typed code (WP4). Nothing here names a halal state:
 * the rider app shows no halal badge.
 */
import type { Schema } from '@hg/api-client';

export type RejectReason = Schema['OfferRejectReasonCode'];

export const OFFER_TITLE = 'Delivery offer';

export const LABEL = {
  earnings: 'Estimated earnings',
  toAnswer: 'to answer',
  left: 'left',
  tripLeg: 'pickup to drop-off',
  carry: 'to carry',
  pickup: 'Pickup',
  dropoffArea: 'Drop-off area',
  dropoff: 'Drop-off',
  fullAddressLater: 'You get the full address when you accept.',
  base: 'Base fare',
  distance: 'Distance pay',
  surge: 'Busy-time extra',
  tip: 'Tip so far (can still change)',
  you: 'You',
} as const;

export const BUTTON = {
  accept: 'Accept',
  accepting: 'Accepting',
  acceptAgain: 'Try accepting again',
  decline: 'Decline',
  keep: 'Keep the offer',
  moreReasons: 'More reasons',
  backToWaiting: 'Back to waiting',
  backToHome: 'Back to Home',
  goToRestaurant: 'Go to the restaurant',
} as const;

/** SH/OfferDecline: the sheet over the offer. */
export const DECLINE_TITLE = 'Why are you declining?';

/**
 * SH/OfferDecline: one tap declines. Five frequent reasons first, the rest behind "More
 * reasons". `OTHER` is not offered: its typed note is the Needs API alternative
 * `OfferDeclineOther` (gap 17), not built.
 */
export const FREQUENT_REASONS: ReadonlyArray<{ code: RejectReason; label: string }> = [
  { code: 'TOO_FAR_PICKUP', label: 'Pickup is too far' },
  { code: 'TOO_FAR_DROPOFF', label: 'Drop-off is too far' },
  { code: 'EARNINGS_TOO_LOW', label: 'Earnings are too low' },
  { code: 'ENDING_SHIFT', label: 'Ending my shift' },
  { code: 'PERSONAL_BREAK', label: 'Taking a break' },
];

export const MORE_REASONS: ReadonlyArray<{ code: RejectReason; label: string }> = [
  { code: 'TOO_FAR', label: 'Too far overall' },
  { code: 'TOO_LONG_WAIT', label: 'Wait looks too long' },
  { code: 'RESTAURANT_TOO_SLOW', label: 'This restaurant is often slow' },
  { code: 'ORDER_TOO_LARGE', label: 'Order is too large to carry' },
  { code: 'VEHICLE_UNSUITABLE', label: 'Not right for my vehicle' },
  { code: 'SAFETY_CONCERN', label: 'Safety concern' },
];

/** Persistent slate alerts inside the live offer (never toasts, never red). */
export const ALERT = {
  connectionLost: {
    title: 'No internet connection',
    body: "Accept may not reach us. We'll send it the moment you're back online, until the time runs out.",
  },
  acceptFailed: {
    title: "Your accept didn't reach us",
    body: 'The offer is still open. Try again while the timer runs.',
  },
  declineFailed: {
    title: "Your decline didn't reach us",
    body: 'The offer is still open. Tap your reason again, or keep the offer.',
  },
} as const;

/** The screens that replace the offer once it is over. They stay until the rider moves on. */
export type ResultKind = 'expired' | 'taken' | 'cancelled' | 'withdrawn' | 'not-available' | 'accept-expired';

export const RESULT: Record<ResultKind, { title: string; body: readonly string[]; button: string; primary: boolean }> = {
  // SH/OfferExpired
  expired: {
    title: 'This offer expired',
    body: ["You're still online and can get the next one.", 'If 3 offers in a row expire, we set you offline.'],
    button: BUTTON.backToWaiting,
    primary: false,
  },
  // SH/OfferTaken
  taken: {
    title: 'Another rider took this order first',
    body: ["Some offers go to more than one rider, and the first to accept gets it. You're still online."],
    button: BUTTON.backToWaiting,
    primary: false,
  },
  // SH/OfferWithdrawn: 409 ORDER_CANCELLED / OFFER_WITHDRAWN.
  cancelled: {
    title: 'This order was cancelled',
    body: ["It was cancelled before anyone accepted it, so the offer was withdrawn. There's nothing for you to do."],
    button: BUTTON.backToWaiting,
    primary: false,
  },
  // SH/OfferWithdrawn, "withdrawn, no reason": the poll says WITHDRAWN and carries no reason.
  withdrawn: {
    title: 'This offer was withdrawn',
    body: ['The order changed.'],
    button: BUTTON.backToWaiting,
    primary: false,
  },
  // SH/OfferNotAvailable: 409 RIDER_NOT_AVAILABLE.
  'not-available': {
    title: "You can't take this offer",
    body: ["Your status changed while the offer was open, so we couldn't give it to you. Home shows your status now."],
    button: BUTTON.backToHome,
    primary: false,
  },
  // SH/OfferAcceptExpired: 409 OFFER_EXPIRED on accept. Makes no promise about counting (gap 18).
  'accept-expired': {
    title: 'This offer ended before your accept reached us',
    body: ["You're still online and can get the next one."],
    button: BUTTON.backToWaiting,
    primary: true,
  },
};

/** SH/OfferAccepted. */
export const ACCEPTED_TITLE = "You've got this delivery";
export function acceptedBody(restaurant: string): string {
  return `Go to ${restaurant}. Your route and the order code are on the next screen.`;
}

export function itemsLabel(n: number): string {
  return n === 1 ? '1 item' : `${n} items`;
}

/** "4.8 km" (one decimal, as drawn). */
export function kmLabel(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** "about 14 min" (never under a minute). */
export function minutesLabel(seconds: number): string {
  return `about ${Math.max(1, Math.round(seconds / 60))} min`;
}

/** "0:24": the countdown numeral (Countdown stand-in). */
export function clockLabel(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
