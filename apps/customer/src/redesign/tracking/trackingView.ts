/**
 * What the order-tracking screen says, worked out from the server's order and tracking records.
 *
 * Pure functions, no React: the screen draws what these return. Nothing here prices, sums or
 * decides a state; every time and amount is a server field, and "late" is never worked out on the
 * phone (the server moves the estimate; this only shows it).
 *
 * Two layouts share the route: the waiting layout (CREATED, AUTHORIZED, RESTAURANT_PENDING: the
 * order is not with the restaurant yet) and the live layout (PREPARING to ARRIVED: a map, the
 * arrival window, the rider). Every other state belongs to the delivered and outcome screens.
 */
import type { Schema } from '@hg/api-client';

import { formatTime, formatTimeWindow, spokenTimeWindow } from '../lib/time';

type OrderState = Schema['OrderState'];
type DispatchState = Schema['DispatchState'];
type DeliveryInstruction = Schema['DeliveryInstruction'];
type VehicleType = Schema['VehicleType'];

const WAITING: ReadonlySet<string> = new Set(['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING']);
const LIVE: ReadonlySet<string> = new Set(['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED']);

export const isWaitingLayout = (state: string): boolean => WAITING.has(state);
export const isLiveLayout = (state: string): boolean => LIVE.has(state);

/** How long an order may sit in AUTHORIZED before the page says it is taking longer than usual. */
export const SLOW_AUTHORIZED_MS = 30_000;

/** A rider fix older than this is shown as stale (the manifest's 45 seconds). */
export const RIDER_FIX_STALE_MS = 45_000;

/* ------------------------------------------------------------------------------------ ETA */

export interface Eta {
  /** "7:10–7:20 pm", or a single time when the server sent no window width. */
  text: string;
  /** "between 7:10 and 7:20 pm". */
  spoken: string;
}

/** The arrival estimate: `eta_at` to `eta_at + eta_window_minutes`. Null while the server has none. */
export function etaOf(etaAt: string | null | undefined, windowMinutes: number | null | undefined): Eta | null {
  if (!etaAt || Number.isNaN(Date.parse(etaAt))) return null;
  if (!windowMinutes || windowMinutes <= 0) {
    const t = formatTime(etaAt);
    return { text: t, spoken: `at ${t}` };
  }
  const end = Date.parse(etaAt) + windowMinutes * 60_000;
  return { text: formatTimeWindow(etaAt, end), spoken: spokenTimeWindow(etaAt, end) };
}

/* -------------------------------------------------------------------------------- headline */

export interface Headline {
  /** The small line above the display line ("Being prepared · Arriving"), or null. */
  overline: string | null;
  /** The large line ("7:14–7:24 pm" or the state itself). */
  display: string;
  /** The whole sentence a screen reader hears instead of both lines. */
  spoken: string;
  /** A secondary line under the headline ("Last estimate 7:12–7:22 pm"), or null. */
  secondary: string | null;
}

const PHASE_WORD: Partial<Record<OrderState, string>> = {
  PREPARING: 'Being prepared',
  READY_FOR_PICKUP: 'Ready',
  PICKED_UP: 'On the way',
};

export interface HeadlineInput {
  state: OrderState;
  dispatchState: DispatchState | null | undefined;
  eta: Eta | null;
  /** `OrderCustomerView.deadline_at`: "Update by" while no rider has been found. */
  deadlineAt: string | null | undefined;
  /** The page is showing what it knew earlier (offline): the estimate is the last one. */
  stale: boolean;
  riderName: string | null;
  meet: Meet;
}

export function headlineOf(input: HeadlineInput): Headline {
  const { state, eta, stale } = input;
  if (state === 'ARRIVED') {
    const who = input.riderName ?? 'Your rider';
    const where = input.meet === 'lobby' ? 'in the lobby' : 'at your door';
    const text = `${who} is ${where}`;
    return { overline: null, display: text, spoken: text, secondary: null };
  }

  // Ready, and no rider found yet: the state itself is the headline and the last estimate moves down.
  if (state === 'READY_FOR_PICKUP' && input.dispatchState === 'NO_RIDER_FOUND' && input.deadlineAt) {
    const by = formatTime(input.deadlineAt);
    return {
      overline: null,
      display: `Finding a rider · Update by ${by}`,
      spoken: `Finding a rider, update by ${by}`,
      secondary: eta ? `Last estimate ${eta.text}` : null,
    };
  }

  const word = PHASE_WORD[state] ?? 'In progress';
  if (!eta) return { overline: null, display: word, spoken: word, secondary: null };
  const lead = stale ? 'Last estimate' : 'Arriving';
  return {
    overline: `${word} · ${lead}`,
    display: eta.text,
    spoken: `${word}, ${stale ? 'last estimate, ' : ''}arriving ${eta.spoken}`,
    secondary: null,
  };
}

/* ------------------------------------------------------------------------------- handover */

export type Meet = 'door' | 'lobby' | 'leave';

/** Where the customer asked to meet the rider. Leaving it at the door is the default. */
export function meetOf(instructions: readonly DeliveryInstruction[] | null | undefined): Meet {
  const list = instructions ?? [];
  if (list.includes('MEET_IN_LOBBY')) return 'lobby';
  if (list.includes('MEET_AT_DOOR')) return 'door';
  return 'leave';
}

/** The 4-digit code, or null when the server sent none (or something that is not four digits). */
export function deliveryCodeOf(code: string | null | undefined): string | null {
  return code && /^\d{4}$/.test(code) ? code : null;
}

/** "Delivery code: 4, 8, 2, 6": the digits read one by one. */
export function spokenCode(code: string): string {
  return `Delivery code: ${code.split('').join(', ')}`;
}

const INSTRUCTION_WORDS: Record<DeliveryInstruction, string> = {
  LEAVE_AT_DOOR: 'Leave at door',
  DO_NOT_RING_BELL: "Don't ring the bell",
  DO_NOT_CALL: "Don't call",
  MEET_AT_DOOR: 'Meet at door',
  MEET_IN_LOBBY: 'Meet in the lobby',
};

export function instructionWords(instructions: readonly DeliveryInstruction[] | null | undefined): string {
  return (instructions ?? []).map((i) => INSTRUCTION_WORDS[i] ?? '').filter(Boolean).join(' · ');
}

/* ----------------------------------------------------------------------------------- rider */

const VEHICLE_WORDS: Record<VehicleType, string> = {
  CAR: 'Car',
  SCOOTER: 'Scooter',
  MOTORCYCLE: 'Motorcycle',
  BICYCLE: 'Bicycle',
  ON_FOOT: 'On foot',
};

export const vehicleWord = (v: VehicleType | null | undefined): string | null => (v ? VEHICLE_WORDS[v] ?? null : null);

/** "Yusuf A." (never a rating: customers do not see rider ratings). */
export function riderNameOf(r: { first_name: string; last_initial: string } | null | undefined): { first: string; full: string } | null {
  if (!r || !r.first_name.trim()) return null;
  const first = r.first_name.trim();
  const initial = r.last_initial.trim();
  return { first, full: initial ? `${first} ${initial}.` : first };
}

export type RiderCard =
  | { kind: 'finding'; title: string; body: string }
  | { kind: 'rider'; title: string; body: string };

export interface RiderCardInput {
  state: OrderState;
  dispatchState: DispatchState | null | undefined;
  restaurantName: string;
  rider: { first: string; full: string } | null;
}

/**
 * The card under the halal row that says who has the order, chosen by the order's state first and
 * the dispatch state second (the order state wins where the two disagree). Null where no card is
 * drawn: the waiting layout, the arrival (the headline names the rider) and "no rider yet", which
 * the page says in a notice instead.
 */
export function riderCardOf(input: RiderCardInput): RiderCard | null {
  const { state, dispatchState: d, restaurantName: place, rider } = input;
  const unsettled = !d || d === 'PENDING' || d === 'SEARCHING' || d === 'OFFERED';

  if (state === 'PICKED_UP') {
    return rider ? { kind: 'rider', title: `${rider.full} is bringing your order`, body: '' } : null;
  }
  if (state === 'PREPARING') {
    if (d === 'SEARCHING' || d === 'OFFERED') {
      return {
        kind: 'finding',
        title: "Finding a rider for when it's ready",
        body: `${place} is still cooking. We're lining up a rider nearby so your food leaves as soon as it's ready.`,
      };
    }
    if (rider && d === 'ASSIGNED') {
      return { kind: 'rider', title: `${rider.full} will collect your order`, body: `Heading to ${place} while your food is cooked.` };
    }
    if (rider && d === 'AT_RESTAURANT') {
      return {
        kind: 'rider',
        title: `${rider.full} is at ${place}`,
        body: `Waiting for your food. You'll see ${rider.first} on the map once your food is picked up.`,
      };
    }
    return null;
  }
  if (state === 'READY_FOR_PICKUP') {
    if (rider && d === 'ASSIGNED') {
      return {
        kind: 'rider',
        title: `${rider.full} will bring your order`,
        body: `Heading to the restaurant. You'll see ${rider.first} on the map once your food is picked up.`,
      };
    }
    if (rider && d === 'AT_RESTAURANT') {
      return {
        kind: 'rider',
        title: `${rider.full} is at ${place}`,
        body: `Collecting your order now. You'll see ${rider.first} on the map once your food is picked up.`,
      };
    }
    if (unsettled) {
      return {
        kind: 'finding',
        title: 'Your food is ready. Finding a rider',
        body: `We're offering your order to riders near ${place}. You'll see who is bringing it here.`,
      };
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------------- notices */

export type Notice = { id: string; icon: 'info' | 'refresh' | 'clock'; title: string; description: string };

/** Notices tied to the dispatch state, in the READY_FOR_PICKUP escalation. */
export function dispatchNoticeOf(state: OrderState, dispatchState: DispatchState | null | undefined, deadlineAt: string | null | undefined): Notice | null {
  if (state !== 'READY_FOR_PICKUP') return null;
  if (dispatchState === 'UNASSIGNED') {
    return {
      id: 'another-rider',
      icon: 'refresh',
      title: 'Finding you another rider',
      description: "Your first rider can't make it. Your food is ready and waiting, and we're offering it to other riders nearby.",
    };
  }
  if (dispatchState === 'NO_RIDER_FOUND') {
    const by = deadlineAt ? ` We'll update you by ${formatTime(deadlineAt)}.` : '';
    return {
      id: 'no-rider',
      icon: 'info',
      title: "We haven't found a rider yet",
      description: `Your food is ready and our team is working on it.${by} If we can't find a rider, we'll cancel the order and you'll get a full refund.`,
    };
  }
  return null;
}

/** An open report (a refund request before delivery), worded the way the report form words it. */
const REPORT_REASONS: Partial<Record<Schema['RefundReasonCode'], string>> = {
  LATE_DELIVERY: 'My order is very late',
  CUSTOMER_CHANGED_MIND: 'I want to cancel',
};

export interface ReportCard {
  reason: string;
  sentAt: string;
}

/** The "Your report" card: the oldest request that is still waiting for a person. */
export function openReportOf(refunds: readonly Schema['Refund'][]): ReportCard | null {
  const open = refunds
    .filter((r) => r.state === 'REQUESTED' || r.state === 'PENDING_APPROVAL')
    .sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at))[0];
  if (!open) return null;
  return { reason: REPORT_REASONS[open.reason_code] ?? 'Something else', sentAt: formatTime(open.requested_at) };
}
