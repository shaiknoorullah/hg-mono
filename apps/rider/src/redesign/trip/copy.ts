/**
 * Every word the pickup leg shows, verbatim from the DL boards (rider manifest Appendix A, DL).
 * Names in the boards ("Zaytoun Grill", "Aisha M.", "HG-4K2M-9T", "9:31 pm") are the data; the
 * functions here put the assignment's own values in their place.
 *
 * Lines no board draws (the pickup-leg offline banner, the no-delivery screen, the "N tries left"
 * count) are marked; each follows the nearest board's voice.
 */
import type { AssignmentState } from './assignment';

export const STEP_SUBTITLE = {
  goToRestaurant: 'Step 1 of 4 · Go to the restaurant',
  atRestaurant: 'Step 2 of 4 · At the restaurant',
  checkBag: 'Step 2 of 4 · Check the bag',
  goToCustomer: 'Step 3 of 4 · Go to the customer',
} as const;

export const PICKUP_TITLE = 'Pickup';
export const DELIVERY_TITLE = 'Delivery';
export const CONTACT_TITLE = 'Contact';

export const goTo = (name: string) => `Go to ${name}`;
export const callName = (name: string) => `Call ${name}`;
export const orderSubtitle = (code: string) => `Order ${code}`;

export const BUTTON = {
  navigate: 'Navigate',
  callRestaurant: 'Call restaurant',
  callSupport: 'Call HalalGoes support',
  call911: 'Call 911',
  somethingWrong: "Something's wrong",
  seeAllMessages: 'See all messages',
  arrived: "I'm at the restaurant",
  arrivedOverride: "Continue: I'm at the restaurant",
  notThereYet: "I'm not there yet",
  tryAgain: 'Try again',
  tryAgainNow: 'Try again now',
  checkItems: 'Check the items',
  notMarkedReady: "They've handed it over, but it isn't marked ready",
  keepWaiting: 'Keep waiting',
  kitchenCantFind: "The kitchen can't find the code",
  backToCode: 'Back to the code',
  gotFood: "I've got the food",
  goToCustomer: 'Go to the customer',
  sendCode: 'Send the code',
  continueFromHere: 'Continue from here',
  backToDelivery: 'Back to the delivery',
  openLocationSettings: 'Open location settings',
  backToHome: 'Back to Home',
} as const;

/** R19 trip shell: DL/Restoring, TripLoading, TripLoadFailed. */
export const RESTORING = {
  title: 'Picking up where you left off',
  body: (saved: number) =>
    saved > 0
      ? `We're loading your delivery and sending ${saved} saved ${saved === 1 ? 'step' : 'steps'}. This takes a moment.`
      : "We're loading your delivery. This takes a moment.",
};

export const LOAD_FAILED = {
  subtitle: 'Order details',
  title: "We couldn't load this delivery",
  body: 'Something went wrong on our side. Your delivery is still yours. Try again, or call support.',
};

/** Not drawn: `trip` opened with no assignment and the server has none either. */
export const NO_DELIVERY = {
  title: "You don't have a delivery right now",
  body: 'Go back to Home to take your next offer.',
};

/** R20 step 1 (DL/PickupEnRoute, PickupReady, PickupStartFailed, PickupStartQueued, PickupArriveFailed). */
export const FOOD = {
  label: 'Food',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  updates: 'This updates by itself if the restaurant changes it.',
  checked: (time: string) => `Food · checked ${time}`,
};

export const DETAILS = {
  dropoff: 'Drop-off',
  orderCode: 'Order code',
  pickupNotes: 'Pickup notes',
  estimatedEarnings: 'Estimated earnings',
  unit: 'Unit',
  buzzer: 'Buzzer',
  payment: 'Payment',
  prepaid: "Prepaid. Don't collect any money.",
};

export const START_FAILED = {
  title: "We couldn't start the trip",
  body: (restaurant: string) =>
    `You accepted the offer; it's yours. We'll keep trying to record that you're on your way. Head to ${restaurant} now.`,
};

export const NOT_SENT = 'Not sent yet';

export const queuedBody = (step: string) =>
  `No internet connection. "${step}" is saved on your phone with the time and sends by itself when you're back online. You can carry on.`;

/** The words a queued step goes by on its row and in the banners. */
export const STEP_NAME: Partial<Record<AssignmentState, string>> = {
  EN_ROUTE_TO_PICKUP: 'On my way',
  ARRIVED_AT_PICKUP: "I'm at the restaurant",
  PICKED_UP: 'Picked up',
  EN_ROUTE_TO_DROPOFF: 'Going to the customer',
  ARRIVED_AT_DROPOFF: "I'm here",
};

export const queuedRow = (step: string, time: string) => `${step} · ${time}`;

export const ARRIVE_FAILED = {
  title: "We couldn't record that you're here",
  body: 'Something went wrong on our side. Try again.',
};

/** DL/PickupGeofence: 422 GEOFENCE_REQUIRED, `override_reason` 5–200 characters. */
export const GEOFENCE = {
  title: "We can't place you at the restaurant",
  body: (restaurant: string) =>
    `Your location doesn't show you at ${restaurant}. If you're there, say why and carry on. We note it for the ops team; it doesn't stop you.`,
  label: "Why you're continuing",
  helper: "At least 5 characters. For example: GPS is off by a block; I'm at the counter.",
};

export const TRACKING = {
  lostTitle: "The customer can't see you on the map",
  lostBody: 'Your location stopped reaching us. The delivery stays yours. Check location is on.',
  degradedTitle: 'Your location is patchy',
  degradedBody: 'The map may lag behind you. The delivery stays yours. Keep the app open if you can.',
};

/** Not drawn for the pickup leg: TripNoConnection's banner with the pickup step named. */
export const NO_CONNECTION = {
  title: 'No internet connection',
  body: 'Steps like "I\'m at the restaurant" are saved and send when you\'re back online.',
};

/** DL/TripSocketLost, as polling (no socket yet, #29; manifest §5 conflict 4). */
export const UPDATES_DELAYED = {
  title: 'Updates may be delayed',
  body: "We'll keep checking the food status. Your steps still send.",
};

export const OUT_OF_DATE = {
  title: 'This delivery had already moved on',
  body: (where: string) => `We have it as ${where}, so we've moved you to this step. Nothing was lost.`,
};

/** "Where it is now" in words, for TripOutOfDate and QueuedRejected. */
export const STATE_WORDS: Record<AssignmentState, string> = {
  ASSIGNED: 'accepted',
  EN_ROUTE_TO_PICKUP: 'going to the restaurant',
  ARRIVED_AT_PICKUP: 'at the restaurant',
  PICKED_UP: 'picked up',
  EN_ROUTE_TO_DROPOFF: 'going to the customer',
  ARRIVED_AT_DROPOFF: "at the customer's door",
  DELIVERED: 'delivered',
  UNDELIVERABLE: "couldn't be delivered",
  RETURNING: 'going back to the restaurant',
  RETURNED: 'returned to the restaurant',
  CANCELLED_BY_PLATFORM: 'cancelled',
  REASSIGNED: 'with another rider',
};

/** R21 at the restaurant (DL/PickupWaiting, PickupLongWait, PickupNotMarkedReady). */
export const WAITING = {
  title: 'Wait for the food',
  body: "Show the order code at the side counter. We'll tell you when the restaurant marks it ready.",
  waited: "You've waited",
  minutes: (n: number) => `${n} min`,
  itemsToCollect: (n: number) => `${n} ${n === 1 ? 'item' : 'items'} to collect`,
  checkItemsHelper: 'Turns on when the restaurant marks the food ready.',
};

export const LONG_WAIT = {
  title: 'Still waiting? Call the restaurant',
  body: 'Ask how long the food will be.',
};

export const NOT_MARKED_READY = {
  title: "The restaurant hasn't marked it ready",
  body: (restaurant: string) =>
    `Ask ${restaurant} to mark the order ready in their app. Check the items turns on as soon as they do.`,
};

/** R22 items and the pickup code (DL/PickupItems, PickupCodeWrong, PickupCodeHelp, PickupCodeLocked). */
export const ITEMS = {
  title: (n: number) => `Check the bag has ${n} ${n === 1 ? 'item' : 'items'}`,
  ready: 'Food is ready',
  match: 'Match order',
  matchTail: 'on the receipt, then count the items.',
  codeTitle: 'Ask the kitchen for the pickup code',
  codeBody: 'They read it from this order on their HalalGoes screen. Type what they read out.',
  codeLabel: 'Pickup code',
  gotFoodHelper: 'Turns on when the code has 4 digits.',
  note: (text: string) => `Note: ${text}`,
};

/**
 * 422 PICKUP_CODE_INCORRECT. The board's line, plus the count from `details.attempts_remaining`
 * (#290; owner question 2 is open, so the count is a separate sentence that can be dropped).
 */
export const wrongCode = (orderCode: string, attemptsRemaining: number | null) => {
  const line = `That isn't the pickup code for this order. Ask the kitchen to read it again from order ${orderCode}.`;
  if (attemptsRemaining == null) return line;
  return `${line} ${attemptsRemaining} ${attemptsRemaining === 1 ? 'try' : 'tries'} left.`;
};

export const CODE_HELP = {
  title: "The kitchen can't find the code",
  body: (orderCode: string) =>
    `It's on order ${orderCode} on their HalalGoes screen, under Pickup code. If they still can't find it, call HalalGoes support.`,
};

export const LOCKED = {
  title: 'Too many wrong codes',
  body: (restaurant: string, orderCode: string) =>
    `Ask ${restaurant} to check the code on order ${orderCode}, then call HalalGoes support to finish the pickup.`,
};

export const RECORDING = {
  title: 'Checking the code and recording your pickup',
  body: 'Stay at the restaurant until this finishes.',
};

export const RECORD_FAILED = {
  title: "We couldn't record your pickup",
  body: 'Something went wrong on our side. Your answer is kept. Try again before you leave.',
};

/** DL/PickupCodeRejectedLater: a saved PICKED_UP whose code was refused when it sent. */
export const REJECTED_LATER = {
  title: "The pickup code you saved wasn't accepted",
  body: (time: string, restaurant: string, orderCode: string) =>
    `Your pickup at ${time} isn't recorded yet. Call ${restaurant} and ask them to read the code for order ${orderCode} again, then type it here.`,
};

/** DL/QueuedRejected: any other saved step the server refused on replay. */
export const QUEUED_REJECTED = {
  title: "A step you saved offline wasn't accepted",
  body: (step: string, time: string) =>
    `You tapped "${step}" at ${time}, but by then the delivery was at a different step on our side.`,
  whereNow: 'Where it is now',
};

/** R30 for the pickup leg (DL/SomethingWrongPickup, SomethingWrongPickupNoSupport). */
export const SOMETHING_WRONG = {
  title: "What's wrong?",
  danger: 'In danger or hurt? Call 911 first.',
  release:
    'Restaurant closed, food never made after 25 minutes, vehicle broken down or you feel unwell: releasing the order from here needs the exception endpoint. Until then, call HalalGoes support; only HalalGoes can move the order to another rider (Reassigned).',
};

/** R33 contact (DL/ContactBeforePickup, RestaurantNotes, ContactLoading, ContactEmpty, ContactError). */
export const CONTACT = {
  beforePickup: (code: string) => `Before pickup · ${code}`,
  afterPickup: (code: string) => `After pickup · ${code}`,
  privateNumber: 'Call through a private number',
  restaurantOnlyHelper: "They don't see your real number.",
  bothHelper: "Neither side sees your real number. A button is missing when that number isn't available.",
  noCalling: "Calling isn't available for this order right now.",
  messagesBefore: 'Messages about this order',
  messagesAfter: 'Notes for you',
  emptyTitle: 'No messages yet',
  emptyBody: 'Messages from the restaurant or HalalGoes appear here.',
  loading: 'Loading…',
  errorTitle: "We couldn't load the contact details",
  errorBody: 'Check your connection and try again. Call 911 from the Something\'s wrong sheet if you need help now.',
};

/** "+18005550142" → "1 800 555 0142", the way the boards print a North American number. */
export function spacedPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  const m = /^(1)?(\d{3})(\d{3})(\d{4})$/.exec(d);
  if (!m) return e164;
  return [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ');
}

/** The helper line under "Call HalalGoes support": the number, then `support_hours` verbatim. */
export const supportHelper = (phone: string, hours: string | null) =>
  hours ? `${spacedPhone(phone)} · ${hours}` : spacedPhone(phone);
