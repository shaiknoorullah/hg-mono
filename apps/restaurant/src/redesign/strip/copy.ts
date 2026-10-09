/**
 * WP3 copy and pure helpers (spec specs/wp3-strip.md, verbatim: curly ’, `·`, `…`).
 */
import type { Schema } from '@hg/api-client';
import { spokenDuration } from '../format/time';

export type RejectReason = Schema['RestaurantRejectReasonCode'];

/** The decline vocabulary, in the drawn order (spec §6). */
export const REJECT_REASONS: readonly { value: RejectReason; label: string }[] = [
  { value: 'ITEM_UNAVAILABLE', label: 'An item is unavailable' },
  { value: 'KITCHEN_AT_CAPACITY', label: 'Kitchen is too busy' },
  { value: 'CLOSING_SOON', label: 'We are closing soon' },
  { value: 'EQUIPMENT_FAILURE', label: 'Equipment isn’t working' },
  { value: 'ADDRESS_OUT_OF_RANGE', label: 'Delivery address is too far' },
  { value: 'SUSPECTED_FRAUD', label: 'The order looks suspicious' },
  { value: 'OTHER', label: 'Something else' },
];

export function reasonLabel(code: string): string | null {
  return REJECT_REASONS.find((r) => r.value === code)?.label ?? null;
}

export const DELIVERY_INSTRUCTION_LABELS: Record<Schema['DeliveryInstruction'], string> = {
  LEAVE_AT_DOOR: 'Leave at the door',
  DO_NOT_RING_BELL: 'Do not ring the bell',
  DO_NOT_CALL: 'Do not call',
  MEET_AT_DOOR: 'Meet at the door',
  MEET_IN_LOBBY: 'Meet in the lobby',
};

/** The 180-second answer window (server-authoritative; only for drawing the ring). */
export const WINDOW_SECONDS = 180;
/** Prep time when the server gave no suggestion (a refresh loses the WS frame's). */
export const DEFAULT_PREP_MINUTES = 20;
export const PREP_MIN = 1;
export const PREP_MAX = 120;

/** Steps of 5 within 1..120: from 15 down 10, 5, 1; from 1 up 5. */
export function prepStep(n: number, dir: 1 | -1): number {
  if (dir === 1) return Math.min(PREP_MAX, Math.floor(n / 5) * 5 + 5);
  const down = Math.ceil(n / 5) * 5 - 5;
  return Math.max(PREP_MIN, down);
}

/** "2:58" (seconds left as m:ss). */
export function clockLabel(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function itemCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/** "Aisha K. · 3 items" */
export function offerSummary(name: string | null, items: number): string {
  return name ? `${name} · ${itemCountLabel(items)}` : itemCountLabel(items);
}

/** "New order A7K2, 2 minutes 12 seconds left, $37.69" (earnings omitted while loading). */
export function liveTileLabel(code: string, msLeft: number, earn: string | null): string {
  const left = msLeft <= 0 ? '0 seconds left' : `${spokenDuration(msLeft)} left`;
  return `New order ${code}, ${left}${earn ? `, ${earn}` : ''}`;
}

export function acceptName(label: string, code: string, prep: number): string {
  return label.startsWith('Accept ·')
    ? `Accept order ${code}, ready in ${prep} minutes`
    : `${label}, order ${code}, ready in ${prep} minutes`;
}

export type Outcome = 'too-late' | 'timed-out' | 'capture-failed' | 'withdrawn' | 'withdrawn-payment';

/** The outcome tile of an order that ended while in the strip (spec §2, §4). */
export const OUTCOME_TILE: Record<
  Outcome,
  { tone: 'neutral' | 'danger'; icon: 'clock' | 'info' | 'error'; badge: string; title: string; body: string; keep: boolean }
> = {
  'too-late': {
    tone: 'neutral',
    icon: 'clock',
    badge: 'Timed out',
    title: 'Too late to accept',
    body: 'The 3 minutes ran out first. The customer was not charged.',
    keep: false,
  },
  'timed-out': {
    tone: 'neutral',
    icon: 'clock',
    badge: 'Timed out',
    title: 'Nobody answered in 3 minutes',
    body: 'The customer was not charged.',
    keep: false,
  },
  'capture-failed': {
    tone: 'danger',
    icon: 'error',
    badge: 'Cancelled',
    title: 'Payment didn’t go through',
    body: 'Don’t prepare this order. The customer was not charged.',
    keep: true,
  },
  withdrawn: {
    tone: 'neutral',
    icon: 'info',
    badge: 'Withdrawn',
    title: 'Customer cancelled',
    body: 'Nothing to prepare. The customer was not charged.',
    keep: false,
  },
  'withdrawn-payment': {
    tone: 'neutral',
    icon: 'info',
    badge: 'Withdrawn',
    title: 'Payment didn’t go through',
    body: 'The payment failed before you answered, so the order was withdrawn.',
    keep: false,
  },
};

/** The panel's alert when the order ends while it is open (spec §7 Detail-offer-ended-sheet). */
export const OUTCOME_PANEL: Record<Outcome, { title: string; body: string }> = {
  'too-late': {
    title: 'Timed out while you were reading',
    body: 'Nobody answered in 3 minutes, so it can’t be accepted now. The customer was not charged.',
  },
  'timed-out': {
    title: 'Timed out while you were reading',
    body: 'Nobody answered in 3 minutes, so it can’t be accepted now. The customer was not charged.',
  },
  withdrawn: { title: 'The customer cancelled', body: 'Nothing to prepare. The customer was not charged.' },
  'withdrawn-payment': {
    title: 'Payment didn’t go through',
    body: 'The payment failed before you answered, so the order was withdrawn.',
  },
  'capture-failed': { title: 'Payment didn’t go through', body: 'Don’t prepare this order. The customer was not charged.' },
};
