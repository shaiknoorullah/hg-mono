/**
 * What the live map pane says, as plain data (`admin/orders/LiveMapPane` and its sixteen state
 * boards). Every word and every pin is read off the order the server sent; nothing is invented:
 * no position is drawn that the server did not send, and a destination is never drawn while the
 * address is masked, even if the response carried coordinates (blurring it in the browser would
 * protect nothing, so the page does not draw it at all).
 *
 * The map is never the only way to know where the order is: `Text` below carries the same
 * facts in words and is what the map points at as its description.
 */
import type { Schema } from '@hg/api-client';
import type { LiveMapPlace, LiveMapRider } from '../../ds';
import { fixFromRest, isStale, type RiderFix } from '@hg/ui-web/live';

import { formatTime, formatTimeWithSeconds } from '../../data/format';

type Order = Schema['OrderAdminView'];
type OrderState = Schema['OrderState'];
type DispatchState = Schema['DispatchState'];

/** How this browser is hearing about the order, in the words of the "Your connection" chip. */
export type Link = 'live' | 'reconnecting' | 'offline' | 'signed-out' | 'connecting' | 'not-connected' | 'not-following';

export const LINK_CHIP: Readonly<Record<Link, { label: string; tone: 'neutral' | 'warning' | 'outline'; icon: 'check' | 'refresh' | 'warning' | 'lock' | 'clock' | 'close' }>> = {
  live: { label: 'Live', tone: 'neutral', icon: 'check' },
  reconnecting: { label: 'Reconnecting', tone: 'warning', icon: 'refresh' },
  offline: { label: 'Offline', tone: 'warning', icon: 'warning' },
  'signed-out': { label: 'Signed out', tone: 'outline', icon: 'lock' },
  connecting: { label: 'Connecting', tone: 'neutral', icon: 'clock' },
  'not-connected': { label: 'Not connected', tone: 'outline', icon: 'close' },
  'not-following': { label: 'Not following', tone: 'outline', icon: 'check' },
};

/** Why the picture stopped moving, when it did. */
export type Paused = { link: 'reconnecting' | 'offline' | 'signed-out'; at: string };

/** Order states in which a rider can be on the way: the ones worth following live. */
const FOLLOWED: readonly OrderState[] = ['RESTAURANT_PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED'];
/** A dispute opened mid-delivery keeps following while the rider still has the order. */
const CARRYING: readonly DispatchState[] = ['ASSIGNED', 'AT_RESTAURANT', 'CARRYING', 'AT_CUSTOMER'];

/** True while the pane should follow the rider (and the page should hear about it live). */
export function isFollowing(order: Pick<Order, 'state' | 'dispatch_state'>): boolean {
  if (FOLLOWED.includes(order.state)) return true;
  return order.state === 'DISPUTED' && order.dispatch_state != null && CARRYING.includes(order.dispatch_state);
}

/** The "Live map" button is offered while there is something live to follow, and after, once a rider was involved. */
export function offersLiveMap(order: Pick<Order, 'state' | 'dispatch_state' | 'rider'>): boolean {
  return isFollowing(order) || order.rider != null;
}

const VEHICLE: Readonly<Record<Schema['VehicleType'], string>> = {
  CAR: 'car',
  SCOOTER: 'scooter',
  MOTORCYCLE: 'motorcycle',
  BICYCLE: 'bicycle',
  ON_FOOT: 'on foot',
};

const WINDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** "north-east" for a bearing in degrees. */
export function compassWord(headingDeg: number): string {
  return WINDS[Math.round((((headingDeg % 360) + 360) % 360) / 45) % 8]!;
}

/** "8 seconds ago", "4 minutes ago". */
export function ageWords(seconds: number): string {
  if (seconds < 90) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'} ago`;
  return `${Math.round(seconds / 60)} minutes ago`;
}

const HIDDEN = 'Hidden until you reveal the address. The reveal needs a reason and is logged.';

export interface Summary {
  leg: string;
  legNote: string;
  eta: string;
  /** Verb under the countdown: what the server does at the deadline. */
  deadlineVerb: string;
  deadlineLabel: string;
}

const DEADLINE: Partial<Record<OrderState, { label: string; verb: string }>> = {
  RESTAURANT_PENDING: { label: 'for the restaurant to answer', verb: 'Escalates: the restaurant is called and ops are alerted.' },
  PREPARING: { label: 'to have it ready', verb: 'Escalates: the customer gets a new estimate and ops are alerted.' },
  READY_FOR_PICKUP: { label: 'to be picked up', verb: 'Escalates: dispatch is nudged and ops are alerted.' },
  PICKED_UP: { label: 'to deliver', verb: 'Escalates: the rider is pinged and ops are alerted.' },
  ARRIVED: { label: 'to hand it over', verb: 'Escalates: the customer is notified and ops are alerted.' },
  DISPUTED: { label: 'to resolve', verb: 'Escalates to senior ops. After the third escalation it resolves in the customer’s favour.' },
  DELIVERED: { label: 'to settle', verb: 'Settles, then moves to Completed.' },
};

const NO_RIDER_DEADLINE = { label: 'until the next escalation', verb: 'Escalates: the search widens and ops are alerted. After the third, it cancels and the customer is refunded in full.' };

/** The words under the deadline, and the estimate and leg cells of the strip. */
export function summarise(order: Order, stale: boolean): Summary {
  const base = !order.rider && order.state === 'READY_FOR_PICKUP' ? NO_RIDER_DEADLINE : (DEADLINE[order.state] ?? { label: '', verb: '' });
  const finished = !isFollowing(order);
  let leg = 'To pickup';
  let legNote = 'Rider heading to the restaurant';
  if (finished) {
    leg = 'Done';
    legNote = order.state === 'DELIVERED' ? `Handed over at ${formatTime(order.state_since)}` : '';
  } else if (!order.rider) {
    leg = 'No rider yet';
    legNote = order.state === 'READY_FOR_PICKUP' ? 'The food is ready at the restaurant' : 'Dispatch is searching';
  } else if (order.dispatch_state === 'AT_RESTAURANT') legNote = 'Rider at the restaurant, waiting for the food';
  else if (order.dispatch_state === 'CARRYING') {
    leg = 'To drop-off';
    legNote = order.state === 'DISPUTED' ? 'Rider still carrying the order' : 'Rider has the order';
  } else if (order.dispatch_state === 'AT_CUSTOMER') {
    leg = 'To drop-off';
    legNote = 'Rider at the delivery address';
  }

  let eta = order.eta_at ? `Delivery by ${formatTime(order.eta_at)}` : 'No estimate yet';
  if (order.state === 'ARRIVED') eta = `At the door since ${formatTime(order.state_since)}`;
  else if (order.state === 'DELIVERED' || order.state === 'COMPLETED') eta = `Delivered ${formatTime(order.state_since)}`;
  else if (!order.rider && order.state === 'READY_FOR_PICKUP') eta = 'Unknown until a rider accepts';
  else if (stale && order.eta_at) eta += ', may be out of date';
  return { leg, legNote, eta, deadlineVerb: base.verb, deadlineLabel: base.label };
}

/** The places an order puts on the map. The destination is only ever drawn once revealed. */
export function placesOf(order: Order): LiveMapPlace[] {
  const out: LiveMapPlace[] = [];
  if (order.restaurant_location) {
    out.push({
      id: `restaurant:${order.restaurant.id}`,
      kind: 'restaurant',
      label: order.restaurant.name,
      latitude: order.restaurant_location.latitude,
      longitude: order.restaurant_location.longitude,
    });
  }
  const spot = destinationOf(order);
  if (spot) out.push({ id: `destination:${order.id}`, kind: 'customer', label: 'Delivery address', latitude: spot.latitude, longitude: spot.longitude });
  return out;
}

function destinationOf(order: Order): { latitude: number; longitude: number } | null {
  if (!order.pii_revealed || !isFollowing(order)) return null;
  const a = order.delivery_address;
  if (a?.latitude != null && a.longitude != null) return { latitude: a.latitude, longitude: a.longitude };
  return order.destination_location ?? null;
}

export interface Text {
  restaurant: string;
  destination: string;
  /** Offer "Reveal address…" under the destination. */
  canReveal: boolean;
  rider: string;
  finished: string | null;
}

/** The pin's words and the sentence about the rider, with the pause (if any) in them. */
export function riderOf(order: Order, nowMs: number, paused: Paused | null): { rider: LiveMapRider | null; fix: RiderFix | null; sentence: string; stale: boolean } {
  const fix = fixFromRest(order.rider_location);
  if (!order.rider) {
    const searched = order.state === 'READY_FOR_PICKUP' || order.dispatch_state === 'NO_RIDER_FOUND';
    return { rider: null, fix: null, sentence: searched ? 'None assigned. Dispatch has not found a rider.' : 'None assigned yet.', stale: false };
  }
  const name = `${order.rider.first_name} ${order.rider.last_initial}.`;
  const who = `${name}, ${VEHICLE[order.rider.vehicle_type]}`;
  if (!fix) {
    return {
      rider: { id: 'rider', label: name, fix: null },
      fix: null,
      sentence: `${who}, is assigned, but no position has arrived from the rider yet. It appears here with the first update.`,
      stale: false,
    };
  }
  const stale = isStale(fix, nowMs);
  const age = Math.max(0, Math.round((nowMs - Date.parse(fix.recordedAt)) / 1000));
  let sentence: string;
  let pinLabel = name;
  if (paused) {
    const when = formatTimeWithSeconds(paused.at);
    const why = paused.link === 'offline' ? 'when this computer went offline' : paused.link === 'signed-out' ? 'when your session ended' : 'when your connection paused';
    sentence = `${who}. Shown as of ${when}, ${why}.${paused.link === 'signed-out' ? '' : ' The rider may have moved since.'}`;
    pinLabel = `${name}, as of ${when}`;
  } else if (stale) {
    sentence = `${who}. Last position ${ageWords(age)}, at ${formatTimeWithSeconds(fix.recordedAt)}. The rider’s phone isn’t sending its location, so this may not be where the rider is now.`;
    pinLabel = `${name}, last known ${formatTime(fix.recordedAt)}`;
  } else if (order.dispatch_state === 'AT_RESTAURANT') {
    sentence = `${who}. At the restaurant since ${formatTime(order.state_since)}.`;
  } else if (order.dispatch_state === 'AT_CUSTOMER') {
    sentence = `${who}. At the delivery area since ${formatTime(order.state_since)}, last position ${formatTimeWithSeconds(fix.recordedAt)}.`;
  } else {
    const heading = fix.headingDeg != null ? `, moving ${compassWord(fix.headingDeg)}` : '';
    sentence = `${who}. Last position ${formatTimeWithSeconds(fix.recordedAt)}, ${ageWords(age)}${heading}.`;
  }
  return { rider: { id: 'rider', label: name, pinLabel, fix }, fix, sentence, stale };
}

/** The text equivalent: the same facts as the map, in words. */
export function textOf(order: Order, riderSentence: string): Text {
  const finished = !isFollowing(order);
  const located = Boolean(order.restaurant_location);
  const restaurant = located
    ? `${order.restaurant.name}, on the map.`
    : `${order.restaurant.name} has no map location. This shouldn’t happen after onboarding; tell the restaurant team.`;
  let destination = HIDDEN;
  let canReveal = !order.pii_revealed;
  if (finished) {
    destination = 'Not shown for a finished order.';
    canReveal = false;
  } else if (order.pii_revealed) {
    destination = destinationOf(order) ? 'Delivery address, on the map.' : 'The delivery address has no map location. The address is on the order.';
    canReveal = false;
  }
  return {
    restaurant,
    destination,
    canReveal,
    rider: riderSentence,
    finished: finished ? 'This order is finished, so there is no live position.' : null,
  };
}
