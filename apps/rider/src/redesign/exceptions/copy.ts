/**
 * Every word the exception screens show, verbatim from the DL boards (rider manifest Appendix A,
 * DL, and the board text): Something's wrong (R30), Can't deliver and the return (R31), the trip
 * ended (R32). Names in the boards ("Zaytoun Grill", "Aisha M.", "HG-4K2M-9T", "10:12 pm") are
 * the data; the functions here put the assignment's own values in their place.
 *
 * Lines no board draws are marked "Not drawn"; each follows the nearest board's voice. Lines the
 * boards draw for a "Needs API" gap (the call-attempt count, the restaurant- and
 * customer-cancelled headings keyed on `order.cancelled.by`) are left out: the contract has no
 * field for them.
 */

export const TITLE = {
  pickup: 'Pickup',
  dropoff: 'Drop-off',
  returning: 'Return the food',
  returned: 'Food returned',
  cancelled: 'Order cancelled',
  moved: 'Delivery moved',
};

export const EX_BUTTON = {
  cantDeliver: "I can't deliver this order",
  backToReturn: 'Back to the return',
  returnIt: 'Return it to the restaurant',
  leaveAtDoor: 'Leave it at the door with a photo and a statement',
  keepGoing: 'Keep going',
  keepTrying: 'Keep trying',
  returned: "I've returned it",
  returnedOverride: "Confirm: I've returned it",
  keepGoingToRestaurant: 'Keep going to the restaurant',
  doneFood: "Done — I've dealt with the food",
  dealtWithFood: "I've dealt with the food",
  doneBag: "Done — I've handed the bag over",
  handedOver: "I've handed it over",
  goOffline: 'Go offline',
};

/* ------------------------------------------------------------------ R30 Something's wrong */

/** DL/SomethingWrong*: the sheet's title and the 911 box are the same on every leg. */
export const MENU = {
  title: "What's wrong?",
};

/* ------------------------------------------------------------------ R31 can't deliver */

/** DL/CantDeliverEnRoute, CantDeliverConfirm. */
export const CANT = {
  title: "Can't deliver this order?",
  enRoute: (name: string) =>
    `Can't get this order to ${name}? You can take it back to the restaurant. If you reach the address, more options open there.`,
  atDoorLeave: (name: string) => `Tried to reach ${name} and can't hand it over? ${name} asked for it to be left at the door.`,
  noWait: (name: string) => `Leaving it at the door, as ${name} asked, has no wait.`,
  /** Not drawn: at the door without LEAVE_AT_DOOR, only the return shows (board note). */
  atDoor: (name: string) => `Tried to reach ${name} and can't hand it over? You can take it back to the restaurant.`,
};

/** DL/CantDeliverSending. */
export const CANT_SENDING = {
  title: "Recording that you can't deliver",
  body: (restaurant: string) => `Keep the food with you. Next we'll ask you to take it back to ${restaurant}.`,
};

/** DL/CantDeliverFailed: 5xx on UNDELIVERABLE; Try again is the same request. */
export const CANT_FAILED = {
  title: "We couldn't record that",
  body: 'Something went wrong on our side. Keep the food with you and try again.',
};

/** The words a saved step goes by on its row (DL/CantDeliverQueued, ReturnedQueued). */
export const SAVED_NAME = {
  UNDELIVERABLE: "Can't deliver",
  RETURNED: 'Returned',
  /** The banner names the button the rider tapped. */
  RETURNED_TAP: "I've returned it",
};

/* ------------------------------------------------------------------ R31 the return leg */

/** DL/Returning, ReturningNoConnection. */
export const RETURNING = {
  heading: (restaurant: string) => `Take the food back to ${restaurant}`,
  body: "The order couldn't be delivered. Hand the bag to the counter staff and say it's a return for this order code.",
  orderCode: 'Order code',
  offlineTitle: 'No internet connection',
  offlineBody: (restaurant: string) =>
    `Keep going to ${restaurant}. "I've returned it" saves on your phone with the time and sends when you're back online.`,
};

/** DL/ReturnedSending. */
export const RETURN_SENDING = {
  title: 'Recording the return',
  body: 'Stay at the restaurant until this finishes.',
};

/** DL/ReturnedFailed: 5xx on RETURNED; Try again is the same request. */
export const RETURN_FAILED = {
  title: "We couldn't record the return",
  body: 'Something went wrong on our side. Try again before you leave the restaurant.',
};

/** DL/ReturnedGeofence: 422 GEOFENCE_REQUIRED on RETURNED, `override_reason` 5–200 characters. */
export const RETURN_GEOFENCE = {
  title: (restaurant: string) => `You look far from ${restaurant}`,
  body: "If you've handed the food back, say what happened. Otherwise go to the restaurant first.",
  label: 'What happened',
  helper: 'At least 5 characters. For example: handed it to staff at the back door.',
};

/** DL/ReturnedQueued: "I've returned it" saved offline. */
export const RETURN_QUEUED = {
  body: `No internet connection. "I've returned it" is saved on your phone with the time and sends by itself when you're back online. The delivery closes once it has sent.`,
};

/* ------------------------------------------------------------------ R31 returned, R32 ended */

export const ENDED = {
  wasGoingTo: 'Was going to',
  /** DL/Returned, ReturnedPaid. */
  returned: (restaurant: string) => `Returned to ${restaurant}`,
  closed: 'This delivery is closed.',
  /** DL/ReturnedPaid, OrderCancelled: a CANCELLATION_COMPENSATION line from the ledger. */
  paidForTime: 'Paid for your time',
  /** DL/OrderCancelled (by SUPPORT / ADMIN / SYSTEM, the only heading the contract can key). */
  cancelled: 'HalalGoes cancelled this order',
  cancelledLine: (restaurant: string, offline: boolean) =>
    offline ? `Don't go to ${restaurant}. You're offline now.` : `Don't go to ${restaurant}. You're back to waiting for offers.`,
  /** DL/OrderCancelledAfterPickup. */
  dontDeliver: "Don't deliver it. You have the food with you.",
  foodInstruction: 'The instruction for the food will appear here. Until then, call HalalGoes support and ask.',
  newOffers: 'You may get new offers once you leave this screen.',
  /** DL/Reassigned. */
  moved: 'This delivery went to another rider',
  movedLine: (restaurant: string, offline: boolean) =>
    offline
      ? `Our team moved it. You don't need to go to ${restaurant}. You're offline now.`
      : `Our team moved it. You don't need to go to ${restaurant}. You're back to waiting for offers.`,
  /** DL/ReassignedAfterPickup. */
  keepBag: "Keep the bag with you. Don't deliver it or leave it anywhere.",
  bagInstruction: 'Where to hand the bag over will appear here. Until then, call HalalGoes support and ask.',
};

/** DL/CancelledFoodConfirm, CancelledFoodConfirmReassigned: one local confirmation, nothing sent. */
export const CONFIRM = {
  foodHeading: "Don't deliver it",
  foodTitle: 'Have you dealt with the food?',
  foodBody: "What you did with the food isn't sent to HalalGoes. If you're not sure what to do with it, call support.",
  bagTitle: 'Have you handed the bag over?',
  bagBody: "Handing the bag over isn't sent to HalalGoes. If you're not sure who to give it to, call support.",
};

/**
 * "88 Brimley Rd, Scarborough, ON" → "Brimley Rd, Scarborough": after the delivery ends the
 * address is cut back to street level (DL/Returned, OrderCancelled: "address cut to street level").
 * The server already sends that form once an assignment is cancelled or moved; a returned one
 * still carries the house number, so the phone cuts it the same way.
 */
export function streetLevel(address: string): string {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const street = (parts[0] ?? '').replace(/^\d+[A-Za-z]?(-\d+)?\s+/, '');
  const area = parts[1] && !/^[A-Z]{2}(\s|$)/.test(parts[1]) ? parts[1] : null;
  return area ? `${street}, ${area}` : street;
}
