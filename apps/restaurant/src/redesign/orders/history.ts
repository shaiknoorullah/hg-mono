/**
 * Past orders' rules as pure functions (design boards `History*`, in the Live orders canvas):
 * which orders the history keeps, each row's status badge, the prep meter, the "Placed" label,
 * and the panel's words for a finished order. Testable without a DOM.
 *
 * Everything the contract carries is drawn from it. What the boards draw and the contract does
 * not carry (decline and cancel reasons, halal-concern outcomes, dispute outcomes, per-status
 * counts) is not guessed here: the panel says what the state alone says. The list of those gaps
 * is in the pull request that added this file.
 */
import type { BadgeVariant, IconName } from '../ds';
import { formatShortDate, formatTime } from '../format/time';
import { endedBeforeAccept, type Order, type OrderState } from './model';

/** The states that make an order "past" on the History page, in the order the chips list them. */
export const HISTORY_STATES = ['DELIVERED', 'COMPLETED', 'RESOLVED', 'REJECTED', 'CANCELLED', 'DISPUTED'] as const satisfies readonly OrderState[];
export type HistoryState = (typeof HISTORY_STATES)[number];

/** A chip: every past order, or one state. */
export type HistoryFilter = 'ALL' | HistoryState;

const PAST = new Set<OrderState>(HISTORY_STATES);

export function isHistoryFilter(value: string | null): value is HistoryFilter {
  return value === 'ALL' || (value !== null && PAST.has(value as OrderState));
}

/** The chips, as the board lists them. `group` starts a labelled group ("Open issues"). */
export const HISTORY_CHIPS: readonly { value: HistoryFilter; label: string; group?: string }[] = [
  { value: 'ALL', label: 'All past orders' },
  { value: 'DELIVERED', label: 'Delivered, settling' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'REJECTED', label: 'Declined' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'DISPUTED', label: 'Disputed', group: 'Open issues' },
];

/** The `state` filter to send for a chip. */
export function statesFor(filter: HistoryFilter): HistoryState[] {
  return filter === 'ALL' ? [...HISTORY_STATES] : [filter];
}

/**
 * #601: the server ignores `state` on `listRestaurantOrders`. The request always carries the
 * filter AND the rows are dropped when they are outside it, so a live order never shows up in
 * History and a chip never shows another status.
 */
export function guardHistoryRows(rows: readonly Order[], filter: HistoryFilter): Order[] {
  return rows.filter((o) => (filter === 'ALL' ? PAST.has(o.state) : o.state === filter));
}

export interface HistoryStatus {
  label: string;
  variant: BadgeVariant;
  /** The panel's badge draws this glyph; the table's badge does not. */
  icon?: IconName;
}

const STATUS: Record<HistoryState, HistoryStatus> = {
  COMPLETED: { label: 'Completed', variant: 'neutral', icon: 'check' },
  DELIVERED: { label: 'Delivered, settling', variant: 'info', icon: 'check' },
  CANCELLED: { label: 'Cancelled', variant: 'warning' },
  REJECTED: { label: 'Declined', variant: 'neutral' },
  DISPUTED: { label: 'Disputed', variant: 'warning' },
  RESOLVED: { label: 'Resolved', variant: 'neutral', icon: 'check' },
};

export function historyStatus(state: OrderState): HistoryStatus {
  return STATUS[state as HistoryState] ?? { label: 'Unknown', variant: 'neutral' };
}

/** "Past orders" or "Past orders: Cancelled" (the table's accessible name). */
export function historyCaption(filter: HistoryFilter): string {
  return filter === 'ALL' ? 'Past orders' : `Past orders: ${STATUS[filter].label}`;
}

export interface PrepMeter {
  /** Minutes from acceptance to ready. */
  prep: number;
  /** Minutes the kitchen promised at acceptance; null when the order carries no promise. */
  promised: number | null;
  /** 0 to 100, for the bar. */
  percent: number;
  late: boolean;
}

const MINUTE = 60_000;

/**
 * "15 of 20 min": how long the kitchen took against what it promised, both from the order's own
 * times (`accepted_at`, `ready_at`, `promised_ready_at`). Null when the order was never prepared.
 */
export function prepMeter(o: Order): PrepMeter | null {
  if (!o.accepted_at || !o.ready_at) return null;
  const accepted = Date.parse(o.accepted_at);
  const prep = Math.max(0, Math.round((Date.parse(o.ready_at) - accepted) / MINUTE));
  const promised = o.promised_ready_at ? Math.max(1, Math.round((Date.parse(o.promised_ready_at) - accepted) / MINUTE)) : null;
  const percent = promised ? Math.min(100, Math.round((prep / promised) * 100)) : 100;
  return { prep, promised, percent, late: promised !== null && prep > promised };
}

/** The spoken form of the meter. */
export function prepText(m: PrepMeter): string {
  return m.promised ? `${m.prep} of ${m.promised} min` : `${m.prep} min`;
}

function dayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** "Today 6:04 pm", "Yest. 9:38 pm", "19 Oct 6:04 pm": the restaurant's own day, not the device's. */
export function placedLabel(iso: string, now: number, timeZone?: string): string {
  const zone = timeZone ?? 'America/Toronto';
  const at = new Date(iso);
  const day = dayKey(at, zone);
  const time = formatTime(at, zone);
  if (day === dayKey(new Date(now), zone)) return `Today ${time}`;
  if (day === dayKey(new Date(now - 86_400_000), zone)) return `Yest. ${time}`;
  return `${formatShortDate(at, zone)} ${time}`;
}

/** What the Order net cell draws: nothing owed (never accepted), or the server's figure. */
export type NetCell = { kind: 'not-charged' } | { kind: 'amount'; cents: number; payoutOpen: boolean };

/**
 * An order that ended before anyone accepted it paid nothing: "Not charged". Otherwise the figure
 * is `restaurant_net_cents` as returned, with "Payout open" beside a cancelled or disputed one
 * (the board's words: the contract carries no payout outcome per order).
 */
export function netCell(o: Order): NetCell {
  if (endedBeforeAccept(o)) return { kind: 'not-charged' };
  return { kind: 'amount', cents: o.money.restaurant_net_cents, payoutOpen: o.state === 'CANCELLED' || o.state === 'DISPUTED' };
}

export interface PanelNote {
  tone: 'neutral' | 'warning';
  title: string;
  body?: string;
}

/**
 * The panel's one explanatory notice. The contract names no reason for a decline, a cancel or a
 * dispute outcome, so the words stay with what the state and `accepted_at` say.
 */
export function panelNote(o: Order): PanelNote | null {
  switch (o.state) {
    case 'REJECTED':
      return { tone: 'neutral', title: 'Declined' };
    case 'CANCELLED':
      return o.accepted_at
        ? { tone: 'neutral', title: 'Cancelled after you accepted', body: 'You didn’t need to hand anything over.' }
        : { tone: 'neutral', title: 'Cancelled before it was accepted', body: 'Nothing was prepared. The customer was not charged.' };
    case 'RESOLVED':
      return { tone: 'neutral', title: 'Support closed the customer’s report', body: 'The outcome and any change to your payout come from support.' };
    case 'DISPUTED':
      return {
        tone: 'warning',
        title: 'The customer reported a problem',
        body: 'HalalGoes support is reviewing it and will tell you the outcome. You don’t need to do anything unless support contacts you.',
      };
    case 'DELIVERED':
      return {
        tone: 'neutral',
        title: 'Delivered · payment settling',
        body: 'Nothing to do. It moves to Completed once HalalGoes settles the payment, usually within a few minutes.',
      };
    default:
      return null;
  }
}

/** The line under the panel's body. */
export function panelFootLine(o: Order): string {
  switch (o.state) {
    case 'COMPLETED':
      return 'This order is finished. It stays in History.';
    case 'REJECTED':
      return 'The customer was not charged. This order stays in History.';
    case 'RESOLVED':
      return 'Resolved. It stays in History.';
    case 'DISPUTED':
      return 'Open issue. It moves to Resolved when support closes it.';
    case 'DELIVERED':
      return 'Delivered. It stays in History.';
    default:
      return 'This order stays in History.';
  }
}

/** The empty list's words: first run, or a chip with nothing behind it. */
export function emptyCopy(filter: HistoryFilter): { title: string; description: string } {
  if (filter === 'ALL') return { title: 'No past orders yet', description: 'Finished, cancelled and declined orders appear here after service.' };
  const word: Record<HistoryState, string> = {
    DELIVERED: 'delivered',
    COMPLETED: 'completed',
    RESOLVED: 'resolved',
    REJECTED: 'declined',
    CANCELLED: 'cancelled',
    DISPUTED: 'disputed',
  };
  return { title: `No ${word[filter]} orders`, description: 'Choose another status, or show all past orders.' };
}
