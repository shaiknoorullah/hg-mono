/**
 * The in-progress list's rules as pure functions (wp4 spec §1–§2, §4.3): which rows the list
 * keeps (#601 client guard), each row's status badge and action, the sort, the counts, and the
 * "Ready by" / rider / items text. Everything here is testable without a DOM.
 *
 * Live-only facts (rider phase, cancel reason, notes, "marked on another screen") come only from
 * realtime events and live in `LiveFacts`; after a refresh they are gone and the rows fall back
 * to what the REST view says (LO `Board-refreshed`). Times use the server clock (`now`).
 */
import type { Schema } from '@hg/api-client';
import type { BadgeVariant, IconName } from '../ds';
import { formatTime } from '../format/time';

export type Order = Schema['OrderRestaurantView'];
export type OrderState = Schema['OrderState'];
export type VehicleType = Schema['VehicleType'];

/** The states the In progress list shows. RESTAURANT_PENDING feeds the strip (WP3). */
export const LIVE_STATES = ['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED', 'DISPUTED'] as const satisfies readonly OrderState[];

const LIVE = new Set<OrderState>(LIVE_STATES);
/** States that must never reach a restaurant at all; seeing one is a server bug worth reporting. */
const NEVER_SHOWN = new Set<OrderState>(['CREATED', 'AUTHORIZED', 'FAILED']);

/**
 * #601: the server ignores `state` on `listRestaurantOrders`. The client always sends the
 * filter AND drops every row outside the set (DELIVERED, COMPLETED, CANCELLED, REJECTED,
 * RESOLVED, and the pending offers the strip owns). Pinned by a test.
 */
export function guardLiveRows(rows: readonly Order[], report: (msg: string, order: Order) => void = defaultReport): Order[] {
  return rows.filter((o) => {
    if (NEVER_SHOWN.has(o.state)) report(`listRestaurantOrders returned an order in ${o.state}`, o);
    return LIVE.has(o.state);
  });
}

function defaultReport(msg: string, order: Order) {
  // eslint-disable-next-line no-console
  console.warn(`[orders] ${msg}`, order.id);
}

export type RiderPhase = 'here' | 'carrying' | 'at_customer';

/** Facts only a realtime event can tell; lost on refresh by design. */
export interface LiveFacts {
  /** Accepted on this screen a moment ago (drawn at the top until the next re-sort). */
  justAccepted?: boolean;
  acceptedElsewhere?: boolean;
  markedElsewhere?: boolean;
  riderPhase?: RiderPhase;
  /** When the rider arrived at the restaurant (dispatch AT_RESTAURANT). */
  riderHereSince?: string;
  unassigned?: boolean;
  noRider?: boolean;
  removedLines?: { line_no: number; name: string; qty: number }[];
  notes?: { author_kind: string; text: string; at: string }[];
  etaWas?: string | null;
  etaUpdatedAt?: string;
  cancelled?: { reasonCode: string | null; afterReady: boolean; fromEvent: boolean };
}

export type MarkPhase = 'sending' | 'failed' | 'refused';

export type RowAction = 'mark-ready' | 'try-again' | 'refreshing' | 'waiting' | 'read-the-code' | 'read-only' | 'remove';

export interface RowStatus {
  badge: { label: string; variant: BadgeVariant; icon?: IconName };
  action: RowAction;
  /** Sort rank (§1.2): lower first. */
  rank: number;
}

const isReady = (o: Order) => o.state === 'READY_FOR_PICKUP';
const isOut = (o: Order) => o.state === 'PICKED_UP' || o.state === 'ARRIVED';

/** Minutes past the promised ready time, from the server clock; 0 when not late. */
export function minutesLate(o: Order, now: number): number {
  if (o.state !== 'PREPARING' || !o.promised_ready_at) return 0;
  const late = now - Date.parse(o.promised_ready_at);
  return late > 0 ? Math.ceil(late / 60_000) : 0;
}

export function isLate(o: Order, now: number): boolean {
  return o.state === 'PREPARING' && (o.is_late === true || minutesLate(o, now) > 0);
}

export function rowStatus(o: Order, facts: LiveFacts = {}, mark: MarkPhase | null = null, now: number = Date.now()): RowStatus {
  if (facts.cancelled) {
    return facts.cancelled.afterReady
      ? { badge: { label: 'Cancelled · keep the bag aside', variant: 'danger' }, action: 'remove', rank: 1 }
      : { badge: { label: 'Cancelled · stop', variant: 'danger' }, action: 'remove', rank: 2 };
  }
  if (o.state === 'DISPUTED') return { badge: { label: 'Delivery problem · with support', variant: 'warning' }, action: 'read-only', rank: 6 };
  if (isOut(o)) return { badge: { label: 'Out for delivery', variant: 'neutral' }, action: 'read-only', rank: 5 };
  if (isReady(o)) {
    if (facts.riderPhase === 'here') return { badge: { label: 'Ready · rider here', variant: 'brand', icon: 'profile' }, action: 'read-the-code', rank: 0 };
    if (facts.noRider) return { badge: { label: 'Ready · no rider yet', variant: 'warning' }, action: 'waiting', rank: 0 };
    if (facts.markedElsewhere) return { badge: { label: 'Ready · marked on another screen', variant: 'info', icon: 'check' }, action: 'waiting', rank: 1 };
    return { badge: { label: 'Ready', variant: 'info', icon: 'check' }, action: 'waiting', rank: 1 };
  }
  // PREPARING (and anything unrecognised that slipped through the guard).
  // A mark-ready attempt in flight, failed or refused outranks every other fact: its failure
  // state must never hide behind "Just accepted" (a never-cut action stays visible).
  if (mark === 'refused') return { badge: { label: 'Can’t mark ready now', variant: 'neutral' }, action: 'refreshing', rank: 2 };
  if (mark === 'failed') return { badge: { label: 'Not marked ready', variant: 'danger' }, action: 'try-again', rank: 2 };
  if (mark === 'sending') return { badge: { label: 'Marking ready…', variant: 'neutral' }, action: 'mark-ready', rank: 2 };
  // Drawn at the top only until the page clears the fact (next list refresh or a short timeout).
  if (facts.justAccepted) return { badge: { label: 'Just accepted', variant: 'brand', icon: 'check' }, action: 'mark-ready', rank: -1 };
  if (facts.riderPhase === 'here') return { badge: { label: 'Rider here · not ready', variant: 'brand', icon: 'profile' }, action: 'mark-ready', rank: 2 };
  if (facts.unassigned) return { badge: { label: 'Rider unassigned', variant: 'warning', icon: 'profile' }, action: 'mark-ready', rank: 2 };
  if (facts.removedLines?.length) return { badge: { label: 'Order changed', variant: 'info' }, action: 'mark-ready', rank: 2 };
  if (facts.notes?.length) return { badge: { label: 'New note', variant: 'info' }, action: 'mark-ready', rank: 2 };
  if (isLate(o, now)) return { badge: { label: 'Late', variant: 'warning', icon: 'clock' }, action: 'mark-ready', rank: 2 };
  if (facts.acceptedElsewhere) return { badge: { label: 'Accepted on another screen', variant: 'info', icon: 'check' }, action: 'mark-ready', rank: 2 };
  if (o.special_instructions) return { badge: { label: 'Preparing', variant: 'neutral', icon: 'clock' }, action: 'mark-ready', rank: 2 };
  return { badge: { label: 'Preparing', variant: 'neutral', icon: 'clock' }, action: 'mark-ready', rank: 3 };
}

/** The time a row sorts by within its rank: ready rows by `ready_at`, the rest by the promise. */
function sortTime(o: Order): number {
  const t = isReady(o) || isOut(o) || o.state === 'DISPUTED' ? (o.ready_at ?? o.promised_ready_at) : (o.promised_ready_at ?? o.ready_at);
  return t ? Date.parse(t) : Number.POSITIVE_INFINITY;
}

/**
 * Ready first, then soonest ready time (§1.2). Stable for equal keys, so a re-sort never
 * shuffles rows that did not change.
 */
export function sortRows(rows: readonly Order[], statusOf: (o: Order) => RowStatus): Order[] {
  return rows
    .map((o, i) => ({ o, i, rank: statusOf(o).rank, t: sortTime(o) }))
    .sort((a, b) => a.rank - b.rank || a.t - b.t || a.i - b.i)
    .map((x) => x.o);
}

/** "Preparing {p} · Ready {r} · Out for delivery {o}" (cancelled and disputed rows excluded). */
export function countRows(rows: readonly Order[], factsOf: (o: Order) => LiveFacts): { preparing: number; ready: number; out: number } {
  let preparing = 0;
  let ready = 0;
  let out = 0;
  for (const o of rows) {
    if (factsOf(o).cancelled || o.state === 'DISPUTED') continue;
    if (isReady(o)) ready += 1;
    else if (isOut(o)) out += 1;
    else preparing += 1;
  }
  return { preparing, ready, out };
}

/** "6:58 pm", "6:44 pm · 4 min late", "Ready 6:45 pm". */
export function readyByText(o: Order, now: number, timeZone?: string): string {
  if (o.state === 'PREPARING') {
    if (!o.promised_ready_at) return '—';
    const t = formatTime(o.promised_ready_at, timeZone);
    const late = minutesLate(o, now);
    return late > 0 ? `${t} · ${late} min late` : t;
  }
  return o.ready_at ? `Ready ${formatTime(o.ready_at, timeZone)}` : '—';
}

const VEHICLE: Record<VehicleType, string> = {
  CAR: 'Car',
  BICYCLE: 'Bike',
  SCOOTER: 'Scooter',
  MOTORCYCLE: 'Motorcycle',
  ON_FOOT: 'On foot',
};

export function vehicleLabel(v: VehicleType | string | null | undefined): string {
  return (v && VEHICLE[v as VehicleType]) || 'Rider';
}

/** The Rider column (§1.1): name · vehicle · live phase or "about {eta}". */
export function riderText(o: Order, facts: LiveFacts = {}, timeZone?: string): string {
  const r = o.rider;
  if (!r) {
    if (facts.unassigned) return 'Finding another rider';
    if (facts.noRider) return 'No rider found yet';
    return 'Finding a rider';
  }
  const who = `${r.display_name} · ${vehicleLabel(r.vehicle_type)}`;
  if (facts.cancelled) return who;
  if (o.state === 'DISPUTED') return facts.riderPhase ? `${who} · with support` : who;
  if (facts.riderPhase === 'here' && facts.riderHereSince) return `${who} · here since ${formatTime(facts.riderHereSince, timeZone)}`;
  if (facts.riderPhase === 'carrying') return `${who} · picked up`;
  if (facts.riderPhase === 'at_customer') return `${who} · at the customer`;
  if (isOut(o)) return who;
  if (r.eta_at) {
    const was = facts.etaWas && facts.etaWas !== r.eta_at ? ` (was ${formatTime(facts.etaWas, timeZone)})` : '';
    return `${who} · about ${formatTime(r.eta_at, timeZone)}${was}`;
  }
  return who;
}

/** First line "{qty} × {name}" plus " + {n} more". */
export function itemsSummary(o: Order): string {
  const [first, ...rest] = o.lines;
  if (!first) return '—';
  return `${first.quantity} × ${first.name}${rest.length ? ` + ${rest.length} more` : ''}`;
}

/** The panel's header badge (§4.3). */
export function panelBadge(o: Order, facts: LiveFacts = {}, now: number = Date.now()): RowStatus['badge'] {
  if (facts.cancelled) return { label: 'Cancelled', variant: 'danger' };
  switch (o.state) {
    case 'PREPARING':
      return isLate(o, now) ? { label: 'Preparing · late', variant: 'warning', icon: 'clock' } : { label: 'Preparing', variant: 'neutral', icon: 'clock' };
    case 'READY_FOR_PICKUP':
      if (facts.riderPhase === 'here') return { label: 'Ready · rider here', variant: 'brand', icon: 'profile' };
      if (facts.noRider) return { label: 'Ready · no rider yet', variant: 'warning' };
      return { label: 'Ready', variant: 'info', icon: 'check' };
    case 'PICKED_UP':
      return { label: 'Out for delivery', variant: 'neutral' };
    case 'ARRIVED':
      return { label: 'At the customer', variant: 'neutral' };
    case 'DISPUTED':
      return { label: 'Delivery problem', variant: 'warning' };
    case 'RESTAURANT_PENDING':
      return { label: 'New', variant: 'brand', icon: 'bell' };
    case 'CANCELLED':
      return { label: 'Cancelled', variant: 'danger' };
    case 'REJECTED':
      return { label: 'Declined', variant: 'neutral' };
    case 'DELIVERED':
    case 'COMPLETED':
    case 'RESOLVED':
      return { label: 'Delivered', variant: 'neutral' };
    default:
      return { label: 'Unknown', variant: 'neutral' };
  }
}

/** States only an accepted order can reach. */
const ACCEPTED_STATES = new Set<OrderState>(['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'RESOLVED']);

/**
 * True once the restaurant has accepted: phone and full address may show (never before).
 * Based on acceptance evidence, not on whether the state is terminal: an offer that timed out
 * or was withdrawn ends in CANCELLED with `accepted_at` null, and must stay pre-accept.
 */
export function isAccepted(o: Order): boolean {
  if (o.accepted_at) return o.state !== 'REJECTED';
  return o.state !== 'CANCELLED' && ACCEPTED_STATES.has(o.state);
}

/** An order that ended before anyone accepted it: no commission row, "You earn — Not charged". */
export function endedBeforeAccept(o: Order): boolean {
  return (o.state === 'CANCELLED' || o.state === 'REJECTED' || o.state === 'FAILED') && !isAccepted(o);
}

const INSTRUCTION: Record<string, string> = {
  LEAVE_AT_DOOR: 'Leave at the door',
  DO_NOT_RING_BELL: 'Do not ring the bell',
  DO_NOT_CALL: 'Do not call',
  MEET_AT_DOOR: 'Meet at the door',
  MEET_IN_LOBBY: 'Meet in the lobby',
};

export function deliveryInstructions(o: Order): string | null {
  const list = (o.delivery_instructions ?? []).map((i) => INSTRUCTION[i]).filter(Boolean);
  return list.length ? list.join(' · ') : null;
}

/** "Unit 3, 14 Birchmount Rd, Scarborough ON M1N 3J5". */
export function formatAddress(a: NonNullable<Order['delivery_address']>): string {
  const street = [a.unit, a.line1].filter(Boolean).join(', ');
  return [street, a.line2, `${a.city} ${a.province} ${a.postal_code}`].filter(Boolean).join(', ');
}

/**
 * A line's extra text: variants then add-ons ("Large · + Extra garlic sauce"). Lines carry
 * `variants[]` once #644 lands; until then `variant_name` (already joined). Read defensively.
 */
export function lineExtra(line: Order['lines'][number]): string | null {
  const variants = (line as { variants?: { name?: string; variant_name?: string }[] | null }).variants;
  const variantNames = Array.isArray(variants) && variants.length ? variants.map((v) => v.name ?? v.variant_name ?? '').filter(Boolean) : line.variant_name ? [line.variant_name] : [];
  const addons = (line.addons ?? []).map((a) => `+ ${a.addon_quantity > 1 ? `${a.addon_quantity} × ` : ''}${a.addon_name}`);
  const parts = [...variantNames, ...addons];
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The pickup code. `OrderRestaurantView` has no `pickup_code` until PR #290 lands (#315 for
 * the backend), so it is read defensively; missing → the code-error state, never a blank slot.
 */
export function pickupCodeOf(o: Order): string | null {
  const code = (o as { pickup_code?: string | null }).pickup_code;
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}
