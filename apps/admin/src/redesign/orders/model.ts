/**
 * What the orders list asks the server and how it reads the answer. No component code here, so the
 * rules that matter (what is searched, what is never sent, what each deadline means) can be tested.
 */
import type { Schema } from '@hg/api-client';

import type { OrderState } from './labels';

export type OrderSummary = Schema['OrderSummary'];

/** `listOrdersAdmin`'s code pattern: HG, a dash, six characters from an alphabet without I, L, O, U. */
export const ORDER_CODE_PATTERN = /^HG-[0-9A-HJKMNP-TV-Z]{6}$/;

export type CodeCheck =
  | { readonly kind: 'empty' }
  | { readonly kind: 'valid'; readonly code: string }
  | { readonly kind: 'invalid'; readonly message: string };

/**
 * Checks a typed code before anything is sent (`OrdersCodeInvalid`). An invalid code is never
 * searched: the server's answer for it would be "no order", which is a different claim.
 */
export function checkOrderCode(raw: string): CodeCheck {
  const code = raw.trim().toUpperCase();
  if (code === '') return { kind: 'empty' };
  if (ORDER_CODE_PATTERN.test(code)) return { kind: 'valid', code };
  const problems: string[] = [];
  if (!code.startsWith('HG-')) {
    problems.push('doesn’t start with HG-');
  } else {
    const rest = code.slice(3);
    if (rest.length < 6) problems.push('too short');
    if (rest.length > 6) problems.push('too long');
    const banned = [...new Set(rest.match(/[ILOU]/g) ?? [])];
    if (banned.length > 0) problems.push(`has ${banned.length === 1 ? 'an' : 'the letters'} ${banned.join(', ')}`);
    if (problems.length === 0) problems.push('has a character a code never has');
  }
  return {
    kind: 'invalid',
    message: `Codes are HG, a dash, then six letters and digits, with no I, L, O or U. This one ${problems.join(' and ')}, so it wasn’t searched.`,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

/**
 * "Still running": every order that carries a deadline (Created through Rider arrived, Delivered
 * and Disputed). A final state has none; the database refuses a non-final state without one.
 */
export const RUNNING_STATES: readonly OrderState[] = [
  'CREATED',
  'AUTHORIZED',
  'RESTAURANT_PENDING',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'ARRIVED',
  'DELIVERED',
  'DISPUTED',
];

export function isRunningPreset(states: readonly OrderState[]): boolean {
  return states.length === RUNNING_STATES.length && RUNNING_STATES.every((s) => states.includes(s));
}

export interface OrderFilters {
  readonly code: string;
  readonly states: readonly OrderState[];
  readonly restaurantId: string;
  readonly accountId: string;
  /** ISO dates (yyyy-mm-dd), Toronto calendar days. */
  readonly placedFrom: string | null;
  readonly placedTo: string | null;
}

export const NO_FILTERS: OrderFilters = { code: '', states: [], restaurantId: '', accountId: '', placedFrom: null, placedTo: null };

export function hasFilters(f: OrderFilters): boolean {
  return f.code !== '' || f.states.length > 0 || f.restaurantId !== '' || f.accountId !== '' || f.placedFrom !== null || f.placedTo !== null;
}

const ZONE = 'America/Toronto';

/** The instant a Toronto calendar day starts, as an ISO date-time. */
export function torontoDayStart(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const p: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(guess))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const local = Date.UTC(p['year']!, p['month']! - 1, p['day']!, p['hour']!, p['minute']!, p['second']!);
  return new Date(guess + (guess - local)).toISOString();
}

/** The last instant of a Toronto calendar day ("Includes the whole day"). */
export function torontoDayEnd(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return new Date(Date.parse(torontoDayStart(next)) - 1).toISOString();
}

/** The query `listOrdersAdmin` takes. Only filters that pass their own check are sent. */
export function ordersQuery(f: OrderFilters, cursor: string | null, limit: number) {
  const code = checkOrderCode(f.code);
  return {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(code.kind === 'valid' ? { code: code.code } : {}),
    ...(f.states.length > 0 ? { state: [...f.states] } : {}),
    ...(isUuid(f.restaurantId) ? { restaurant_id: f.restaurantId.trim() } : {}),
    ...(isUuid(f.accountId) ? { account_id: f.accountId.trim() } : {}),
    ...(f.placedFrom ? { placed_from: torontoDayStart(f.placedFrom) } : {}),
    ...(f.placedTo ? { placed_to: torontoDayEnd(f.placedTo) } : {}),
  };
}

/** What happens at zero, for the states that carry a deadline (`ORD/OrdersGrid`). */
export const DEADLINE_VERB: Readonly<Partial<Record<OrderState, string>>> = {
  CREATED: 'auto-cancels',
  AUTHORIZED: 'retries the offer',
  RESTAURANT_PENDING: 'auto-cancels',
  PREPARING: 'escalates',
  READY_FOR_PICKUP: 'escalates',
  PICKED_UP: 'escalates',
  ARRIVED: 'escalates',
  DELIVERED: 'settles',
  DISPUTED: 'escalates, or resolves for the customer if this is the last round',
};

export const DEADLINE_DUE: Readonly<Partial<Record<OrderState, string>>> = {
  CREATED: 'Due to auto-cancel now',
  AUTHORIZED: 'Due to retry now',
  RESTAURANT_PENDING: 'Due to auto-cancel now',
  PREPARING: 'Due to escalate now',
  READY_FOR_PICKUP: 'Due to escalate now',
  PICKED_UP: 'Due to escalate now',
  ARRIVED: 'Due to escalate now',
  DELIVERED: 'Due to settle now',
  DISPUTED: 'Due to escalate, or to resolve for the customer on the last round',
};

/** Only Waiting for restaurant (180 s) and Disputed (48 h) get urgency colour; the rest stay calm. */
export const URGENCY_WINDOW_SECONDS: Readonly<Partial<Record<OrderState, number>>> = {
  RESTAURANT_PENDING: 180,
  DISPUTED: 172_800,
};

/** The order's own timer shape for `Countdown`: how long it was given, and when urgency starts. */
export function countdownShape(state: OrderState, deadlineAt: string, since: string | null | undefined, now: number) {
  const fixed = URGENCY_WINDOW_SECONDS[state];
  const from = since ? Date.parse(since) : Number.NaN;
  const span = Math.round((Date.parse(deadlineAt) - (Number.isFinite(from) ? from : now)) / 1000);
  const windowSeconds = fixed ?? Math.max(span, 1);
  return fixed
    ? { windowSeconds, urgentThreshold: 0.25, criticalThreshold: 0.1 }
    : { windowSeconds, urgentThreshold: 0, criticalThreshold: 0 };
}

/** "2 items: A, B" / "1 item: A" / "3 items: A, B, and more". */
export function itemsText(row: Pick<OrderSummary, 'item_count' | 'first_item_names'>): string {
  const names = row.first_item_names ?? [];
  const count = row.item_count ?? names.length;
  if (count === 0 && names.length === 0) return '';
  return `${count === 1 ? '1 item' : `${count} items`}: ${names.join(', ')}${count > names.length ? ', and more' : ''}`;
}

/** Disputes sort by `deadline_at`, soonest first; one with no deadline goes last. */
export function sortByDeadline<T extends { deadline_at?: string | null }>(rows: readonly T[]): T[] {
  const key = (r: T) => (r.deadline_at ? Date.parse(r.deadline_at) : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => key(a) - key(b));
}

/** "2:30:00" / "1:10" for the remaining time the board prints in text. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/**
 * `openapi-fetch` rewrites the contract's branded `Cents` into a structural object type in the
 * types it hands back, although the value on the wire is the plain integer. This puts the
 * contract's own generated type back on a response body (no value changes), so money reaches
 * `Price` as `Cents` and the schema types stay the ones the generator emitted.
 */
export function asContract<T>(wire: unknown): T {
  return wire as T;
}
