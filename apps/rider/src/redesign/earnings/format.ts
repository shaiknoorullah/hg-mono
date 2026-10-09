/**
 * Words and dates for the Earnings tab (EA canvas). Pure functions: no money is added up here.
 * Every amount a rider sees is a `*_cents` field from the API, rendered by `Price`; this file
 * only turns dates, counts and enum values into the boards' words.
 *
 * Dates render in the phone's own zone, like `format/time.ts` (the API buckets in the rider's
 * timezone, so a bucket start read locally is the rider's day). Times go through `formatTime`.
 */
import type { Schema } from '@hg/api-client';

import { formatTime } from '../format/time';

export type EarningsPeriod = Schema['EarningsPeriod'];
export type EarningEntry = Schema['EarningEntry'];
export type PayoutState = Schema['PayoutState'];

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function toDate(input: string | number | Date): Date {
  return input instanceof Date ? input : new Date(input);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "Sunday 27 September". */
export function dayLabel(input: string | number | Date): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/** "Sunday 27 September 2026". */
export function longDayLabel(input: string | number | Date): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${dayLabel(d)} ${d.getFullYear()}`;
}

/** "Monday 28 September", or "today, Monday 28 September" on the day itself. */
export function payoutDayLabel(input: string | number | Date, now: Date = new Date()): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '';
  const same = startOfDay(d).getTime() === startOfDay(now).getTime();
  return same ? `today, ${dayLabel(d)}` : dayLabel(d);
}

/** "Sunday 20 September, 9:30 pm" (rows inside a payout). */
export function dayTimeLabel(input: string | number | Date): string {
  return `${dayLabel(input)}, ${formatTime(input)}`;
}

/** "9:05 pm today" for a saved copy, or "Sunday 27 September, 9:05 pm". */
export function savedAtLabel(ms: number, now: Date = new Date()): string {
  if (!ms) return '';
  const d = new Date(ms);
  return startOfDay(d).getTime() === startOfDay(now).getTime() ? `${formatTime(d)} today` : dayTimeLabel(d);
}

/** Local `YYYY-MM-DD`, the contract's `from` (format: date). */
export function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The first day of the period `offset` steps from the one containing `now` (weeks start Monday). */
export function periodStart(period: EarningsPeriod, offset: number, now: Date = new Date()): Date {
  const today = startOfDay(now);
  if (period === 'DAY') return new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  if (period === 'MONTH') return new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const sinceMonday = (today.getDay() + 6) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday + offset * 7);
}

/** The heading of a period: "This week", "Last week", "Today", "Yesterday", "This month", … */
export function periodTitle(period: EarningsPeriod, offset: number, now: Date = new Date()): string {
  const start = periodStart(period, offset, now);
  if (period === 'DAY') {
    if (offset === 0) return 'Today';
    if (offset === -1) return 'Yesterday';
    return dayLabel(start);
  }
  if (period === 'MONTH') {
    if (offset === 0) return 'This month';
    if (offset === -1) return 'Last month';
    return `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (offset === 0) return 'This week';
  if (offset === -1) return 'Last week';
  return weekRange(start);
}

/** "14 to 20 September", "31 August to 6 September". */
export function weekRange(monday: Date): string {
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return spanLabel(monday, sunday);
}

/** "14 to 20 September" between two local days (inclusive). */
export function spanLabel(a: Date, b: Date): string {
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} to ${b.getDate()} ${MONTH_NAMES[b.getMonth()]}`
    : `${a.getDate()} ${MONTH_NAMES[a.getMonth()]} to ${b.getDate()} ${MONTH_NAMES[b.getMonth()]}`;
}

/** The date line under the heading: "Monday 21 to Sunday 27 September", "Sunday 27 September", "1 to 27 September 2026". */
export function periodRange(period: EarningsPeriod, offset: number, now: Date = new Date()): string {
  const start = periodStart(period, offset, now);
  if (period === 'DAY') return offset === 0 || offset === -1 ? dayLabel(start) : '';
  if (period === 'MONTH') {
    if (offset === 0) return `1 to ${now.getDate()} ${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
    return offset === -1 ? `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}` : '';
  }
  const sunday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return start.getMonth() === sunday.getMonth()
    ? `Monday ${start.getDate()} to Sunday ${sunday.getDate()} ${MONTH_NAMES[sunday.getMonth()]}`
    : `Monday ${start.getDate()} ${MONTH_NAMES[start.getMonth()]} to Sunday ${sunday.getDate()} ${MONTH_NAMES[sunday.getMonth()]}`;
}

export function unitWord(period: EarningsPeriod): 'day' | 'week' | 'month' {
  return period === 'DAY' ? 'day' : period === 'MONTH' ? 'month' : 'week';
}

/** The line shown when a period has no deliveries. */
export function zeroLine(period: EarningsPeriod, offset: number): string {
  if (offset !== 0) return `No deliveries ${periodTitle(period, offset).toLowerCase()}.`;
  if (period === 'DAY') return 'No deliveries yet today. Go online from Home to get offers.';
  return `No deliveries this ${unitWord(period)}. Go online from Home to get offers.`;
}

export function tripsWord(n: number): string {
  return `${n} ${n === 1 ? 'trip' : 'trips'}`;
}

/** "33 h", "3 h 12 min", "0 h". */
export function hoursLabel(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "142.6 km", "0 km". */
export function kmLabel(metres: number): string {
  if (!metres) return '0 km';
  return `${(metres / 1000).toFixed(1)} km`;
}

/* ------------------------------------------------------------------------------- payouts */

export interface PayoutLike {
  period_start: string;
  period_end: string;
}

/** A payout's first and last local day. `period_end` is the exclusive end, so step back 1 ms. */
export function payoutDays(p: PayoutLike): { first: Date; last: Date } {
  const first = new Date(p.period_start);
  const last = new Date(new Date(p.period_end).getTime() - 1);
  return { first, last };
}

/** "14 to 20 September". */
export function payoutPeriod(p: PayoutLike): string {
  const { first, last } = payoutDays(p);
  return spanLabel(first, last);
}

/** "Monday 14 to Sunday 20 September 2026". */
export function payoutPeriodLong(p: PayoutLike): string {
  const { first, last } = payoutDays(p);
  const tail = `${DAY_NAMES[last.getDay()]} ${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`;
  return first.getMonth() === last.getMonth()
    ? `${DAY_NAMES[first.getDay()]} ${first.getDate()} to ${tail}`
    : `${DAY_NAMES[first.getDay()]} ${first.getDate()} ${MONTH_NAMES[first.getMonth()]} to ${tail}`;
}

/** The status word of a payout (EA/PayoutStates). Never green, never brand orange. */
export const PAYOUT_STATE_WORD: Record<PayoutState, string> = {
  DRAFT: 'Being prepared',
  READY: 'Scheduled',
  TRANSFERRING: 'Sending',
  TRANSFERRED: 'With Stripe',
  PAID: 'Paid',
  FAILED: 'Didn’t go through',
  HELD: 'On hold',
};

export function isProblemState(state: PayoutState): boolean {
  return state === 'FAILED' || state === 'HELD';
}

/** The row's second line on Payouts: "68 lines so far", "77 lines · paid out Monday 21 September". */
export function payoutRowSub(p: { state: PayoutState; entry_count?: number; paid_at?: string | null }): string {
  const lines = `${p.entry_count ?? 0} ${(p.entry_count ?? 0) === 1 ? 'line' : 'lines'}`;
  switch (p.state) {
    case 'DRAFT':
      return `${lines} so far`;
    case 'TRANSFERRING':
      return `${lines} · being sent to Stripe`;
    case 'PAID':
      return p.paid_at ? `${lines} · paid out ${dayLabel(p.paid_at)}` : lines;
    case 'FAILED':
      return `${lines} · back in your balance`;
    case 'HELD':
      return `${lines} · not paid yet`;
    default:
      return lines;
  }
}

/* ------------------------------------------------------------------------------- ledger */

export const ENTRY_TYPE_WORD: Record<EarningEntry['type'], string> = {
  DELIVERY: 'Delivery',
  TIP: 'Tip',
  BONUS: 'Bonus',
  ADJUSTMENT: 'Adjustment',
  CLAWBACK: 'Correction',
  // Not at launch (rider manifest R36); named plainly if one ever arrives.
  CANCELLATION_COMPENSATION: 'Cancellation pay',
};

/** The Earnings line screen's title. */
export const ENTRY_TITLE: Record<EarningEntry['type'], string> = {
  DELIVERY: 'Delivery earnings',
  TIP: 'Tip',
  BONUS: 'Bonus',
  ADJUSTMENT: 'Adjustment',
  CLAWBACK: 'Correction',
  CANCELLATION_COMPENSATION: 'Cancellation pay',
};

export const ENTRY_STATUS_WORD: Record<EarningEntry['status'], string> = {
  PENDING: 'Pending',
  AVAILABLE: 'Available',
  PAID: 'Paid',
  REVERSED: 'Reversed',
};

/**
 * A CLAWBACK not yet in a payout shows no status word: the API says AVAILABLE, which elsewhere
 * promises "the next Monday payout" (EA/Activity note, #147). It reads "Not in a payout yet".
 */
export function entryStatusWord(e: Pick<EarningEntry, 'type' | 'status' | 'payout_id'>): { word: string; isNote: boolean } {
  if (e.type === 'CLAWBACK' && !e.payout_id) return { word: 'Not in a payout yet', isNote: true };
  return { word: ENTRY_STATUS_WORD[e.status], isNote: false };
}

/** Group newest-first entries by local day, keeping order. */
export function groupByDay<T extends { earned_at: string }>(rows: readonly T[]): { day: string; rows: T[] }[] {
  const out: { day: string; rows: T[] }[] = [];
  for (const r of rows) {
    const day = dayLabel(r.earned_at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}
