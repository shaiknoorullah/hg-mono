/**
 * Payouts as plain data (restaurant redesign, #658; canvas `PY`). Everything here is derived from
 * what the server sent, and nothing here does arithmetic on money:
 *
 * - an amount is the `amount_cents` the server put on the payout, passed to `Price` untouched;
 * - the account's state is read from `getConnectStatus` and the profile's `account_state`;
 *   Stripe owns the truth, the page reports it and never decides eligibility itself;
 * - counts are counts of Stripe's own requirement lists, never sums of money.
 *
 * A figure the contract does not carry is not drawn (no amount, no date, no count) and the page
 * says so in words, never with a zero or a guess standing in.
 */
import { cents, type Cents, type Schema } from '@hg/api-client';
import type { IconName } from '../ds';
import { requirementWords } from '../onboarding/payout';

export type Payout = Schema['Payout'];
export type PayoutState = Schema['PayoutState'];
export type ConnectStatus = Schema['ConnectStatus'];
export type AccountState = Schema['RestaurantAccountState'];

// ── Money ─────────────────────────────────────────────────────────────────────────────────

/**
 * The payout's amount as branded cents, or `null` when the value is not a whole number of cents
 * (then nothing is drawn: an unknown amount is never shown as `$0.00`).
 */
export function payoutCents(value: unknown): Cents | null {
  if (typeof value !== 'number') return null;
  try {
    return cents(value);
  } catch {
    return null;
  }
}

// ── Payout state ──────────────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger';

export interface StateView {
  label: string;
  tone: BadgeTone;
  icon?: IconName;
}

/**
 * All seven payout states. Failed is a money state (the transfer did not reach the bank), not a
 * halal one, so it may use the danger tone; nothing here is green (solid green is reserved to the
 * halal colours) and Paid is neutral with a check.
 */
export const STATE_VIEW: Record<PayoutState, StateView> = {
  DRAFT: { label: 'Accruing', tone: 'neutral' },
  READY: { label: 'Ready to send', tone: 'neutral' },
  TRANSFERRING: { label: 'Sending to Stripe', tone: 'info' },
  TRANSFERRED: { label: 'Sent to Stripe', tone: 'info' },
  PAID: { label: 'Paid', tone: 'neutral', icon: 'check' },
  FAILED: { label: 'Failed', tone: 'danger' },
  HELD: { label: 'On hold', tone: 'warning' },
};

export function stateView(state: string): StateView {
  return STATE_VIEW[state as PayoutState] ?? { label: 'Unknown', tone: 'neutral' };
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parts(at: Date | number | string, timeZone: string): { y: number; m: number; d: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** "3 October 2026" in the restaurant's time zone. */
export function longDate(at: Date | number | string, timeZone: string): string {
  const { y, m, d } = parts(at, timeZone);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * A payout period the way the boards write it: "14–20 September 2026", "31 August – 6 September
 * 2026". The server's `period_end` is the start of the next period, so the last day shown is the
 * day before it.
 */
export function periodLabel(startIso: string, endIso: string, timeZone: string): string {
  const s = parts(startIso, timeZone);
  const e = parts(new Date(endIso).getTime() - 1, timeZone);
  if (s.y !== e.y) return `${s.d} ${MONTHS[s.m - 1]} ${s.y} – ${e.d} ${MONTHS[e.m - 1]} ${e.y}`;
  if (s.m !== e.m) return `${s.d} ${MONTHS[s.m - 1]} – ${e.d} ${MONTHS[e.m - 1]} ${e.y}`;
  return `${s.d}–${e.d} ${MONTHS[e.m - 1]} ${e.y}`;
}

/** "10–16 August", for a row in the "Need your attention" line (the year is in the table). */
export function periodShort(startIso: string, endIso: string, timeZone: string): string {
  return periodLabel(startIso, endIso, timeZone).replace(/ \d{4}$/, '');
}

// ── Stripe requirements ───────────────────────────────────────────────────────────────────

export interface RequirementGroup {
  key: 'past' | 'needed' | 'later';
  title: string;
  items: { code: string; words: string }[];
}

const minus = (a: readonly string[], ...rest: (readonly string[])[]) => a.filter((x) => !rest.some((r) => r.includes(x)));

/**
 * Past due = `past_due`; needed by = `currently_due` minus `past_due`; not needed yet =
 * `eventually_due` minus `currently_due`. Groups with nothing in them are left out. Stripe's code
 * stays beside the plain words as a secondary reference.
 */
export function requirementGroups(status: ConnectStatus, timeZone: string): RequirementGroup[] {
  const r = status.requirements;
  const due = r.currently_due ?? [];
  const past = r.past_due ?? [];
  const when = r.deadline ? `Needed by ${longDate(r.deadline, timeZone)}` : 'Needed now';
  const make = (codes: string[]) => [...new Set(codes)].map((code) => ({ code, words: requirementWords(code) }));
  const groups: RequirementGroup[] = [
    { key: 'past', title: 'Past due', items: make(past) },
    { key: 'needed', title: when, items: make(minus(due, past)) },
    { key: 'later', title: 'Not needed yet', items: make(minus(r.eventually_due ?? [], due, past)) },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** How many things Stripe needs now: a count of its own lists (past due and due, each once). */
export function neededCount(status: ConnectStatus): number {
  return new Set([...(status.requirements.past_due ?? []), ...(status.requirements.currently_due ?? [])]).size;
}

export function things(n: number): string {
  return n === 1 ? '1 thing' : `${n} things`;
}

// ── The account ───────────────────────────────────────────────────────────────────────────

export type RestrictedKind = 'suspended' | 'banned' | null;

/** Suspended and banned accounts get no new payouts; the server enforces it, the page explains it. */
export function restrictedKind(state: string | undefined | null): RestrictedKind {
  return state === 'SUSPENDED' ? 'suspended' : state === 'BANNED' ? 'banned' : null;
}

export type AccountMode =
  | 'none' // no payout account yet (404)
  | 'on' // payouts on, nothing asked
  | 'due-soon' // payouts on, Stripe will need something by a date
  | 'held' // payouts off and Stripe needs something from the owner
  | 'checking'; // payouts off, everything sent: Stripe is checking

export function accountMode(status: ConnectStatus | null): AccountMode {
  if (!status || !status.stripe_account_id) return 'none';
  if (status.payouts_enabled) return neededCount(status) > 0 ? 'due-soon' : 'on';
  return neededCount(status) === 0 && status.details_submitted ? 'checking' : 'held';
}

export interface AccountCard {
  tone: BadgeTone;
  icon?: IconName;
  badge: string;
  sentence: string;
  short: string;
  rows: { key: string; label: string; value: string }[];
}

/** The last four digits of the bank account, or `null` when the server sent anything else. */
export function bankLast4(status: ConnectStatus | null): string | null {
  const v = status?.bank_last4;
  return typeof v === 'string' && /^\d{4}$/.test(v) ? v : null;
}

function bankValue(status: ConnectStatus | null, fallback: string): string {
  const last4 = bankLast4(status);
  return last4 ? `Bank account ending ${last4}` : fallback;
}

function intervalWord(status: ConnectStatus | null): string | null {
  const i = status?.payout_interval;
  return i ? i.charAt(0) + i.slice(1).toLowerCase() : null;
}

/** The payout account card (`getConnectStatus`). Rows with no server value are not drawn. */
export function accountCard(status: ConnectStatus | null, restricted: RestrictedKind): AccountCard {
  const mode = accountMode(status);
  const paidBy = { key: 'by', label: 'Paid by', value: 'Stripe, for HalalGoes' };
  const how = intervalWord(status);
  const interval = how ? [{ key: 'how', label: 'How often', value: how }] : [];
  if (mode === 'none') {
    return {
      tone: 'neutral',
      badge: 'Not set up',
      sentence: 'No payout account yet.',
      short: 'No payout account yet',
      rows: [{ key: 'into', label: 'Paid into', value: 'Not set yet' }, paidBy],
    };
  }
  if (mode === 'held' || mode === 'checking') {
    return {
      tone: 'warning',
      badge: 'Payouts on hold',
      sentence: mode === 'checking' ? 'Stripe is checking your details.' : 'Stripe needs more from you first.',
      short: mode === 'checking' ? 'Stripe is checking your details' : 'Stripe needs more from you before it can pay you',
      rows: [{ key: 'into', label: 'Paid into', value: bankValue(status, 'No bank account yet') }, ...interval, paidBy],
    };
  }
  if (restricted) {
    return {
      tone: 'neutral',
      badge: 'No new payouts',
      sentence: `Nothing new is paid while your account is ${restricted}.`,
      short: `Nothing new is paid while your account is ${restricted}`,
      rows: [{ key: 'into', label: 'Paid into', value: bankValue(status, 'Not given') }, ...interval, paidBy],
    };
  }
  const into = bankValue(status, 'Not given');
  return {
    tone: 'neutral',
    icon: 'check',
    badge: 'Payouts on',
    sentence: 'Stripe pays you automatically.',
    short: how ? `${into} · ${how}` : into,
    rows: [{ key: 'into', label: 'Paid into', value: into }, ...interval, paidBy],
  };
}

// ── Reading the list ──────────────────────────────────────────────────────────────────────

export interface PayoutRow extends Payout {
  /** Set by a live update while the page is open ("Just changed"); never sent by the server. */
  justChanged?: boolean;
}

/** Failed and on-hold payouts among the rows loaded so far, newest first (the order they came in). */
export function needAttention(rows: readonly PayoutRow[]): PayoutRow[] {
  return rows.filter((r) => r.state === 'FAILED' || r.state === 'HELD');
}

/**
 * Applies a live `restaurant.payout_updated` to the loaded rows. Returns the new rows, or `null`
 * when the payout is not among them (the caller reloads the first page). The state and amount are
 * the server's; nothing is recomputed.
 */
export function applyPayoutUpdate(
  rows: readonly PayoutRow[],
  update: { payout_id: string; state: PayoutState; amount_cents: number },
): PayoutRow[] | null {
  if (!rows.some((r) => r.id === update.payout_id)) return null;
  return rows.map((r) =>
    r.id === update.payout_id ? { ...r, state: update.state, amount_cents: update.amount_cents as Payout['amount_cents'], justChanged: r.state !== update.state } : r,
  );
}

/** What a payout's "Paid into your bank" cell says. */
export function paidCell(p: Payout, timeZone: string): { text: string; muted: boolean } {
  if (p.paid_at) return { text: longDate(p.paid_at, timeZone), muted: false };
  return { text: p.state === 'FAILED' ? 'Not paid' : p.state === 'HELD' ? 'On hold' : 'Not yet', muted: true };
}

// ── The detail panel ──────────────────────────────────────────────────────────────────────

export interface DetailView {
  amountLabel: string;
  sentence: string;
  paid: string;
}

/**
 * The words around one payout. The amount itself is never worked out here: it is
 * `payout.amount_cents` as the server sent it.
 */
export function detailView(p: Payout, timeZone: string): DetailView {
  const paidAt = p.paid_at ? longDate(p.paid_at, timeZone) : null;
  switch (p.state) {
    case 'DRAFT':
      return { amountLabel: 'So far', sentence: 'This period is still open. The amount grows as orders settle and is fixed when the period closes.', paid: 'After this period closes' };
    case 'READY':
      return { amountLabel: 'Amount', sentence: 'This period is closed. The payout is queued to go to your Stripe account.', paid: 'Goes to Stripe on the next payout run' };
    case 'TRANSFERRING':
      return { amountLabel: 'Amount', sentence: 'We are sending this payout to your Stripe account.', paid: 'Stripe sends it to your bank once it arrives' };
    case 'TRANSFERRED':
      return { amountLabel: 'Amount', sentence: 'This payout is in your Stripe account. Stripe pays it into your bank next.', paid: 'Stripe sends it to your bank next' };
    case 'PAID':
      return { amountLabel: 'Amount', sentence: paidAt ? `Paid into your bank on ${paidAt}.` : 'Paid into your bank.', paid: paidAt ?? 'Date not given' };
    case 'FAILED':
      return { amountLabel: 'Amount', sentence: 'This payout did not reach your bank. The money is safe: it went back into your balance.', paid: 'Not paid' };
    case 'HELD':
      return { amountLabel: 'Amount', sentence: 'This payout is on hold. Nothing is sent until the reason below is resolved.', paid: 'Not paid while on hold' };
    default:
      return { amountLabel: 'Amount', sentence: '', paid: 'Not given' };
  }
}

/** `hold_reason` is the server's own words, shown verbatim; only a missing one has app copy. */
export const HOLD_FALLBACK = 'No reason has been recorded for this hold yet. Contact support and we’ll find out what’s needed.';
export const FAIL_FALLBACK = 'We don’t know yet why this failed.';

export function holdText(p: Payout): { text: string; recorded: boolean } {
  const r = p.hold_reason?.trim();
  return r ? { text: r, recorded: true } : { text: HOLD_FALLBACK, recorded: false };
}

export function failText(p: Payout): { text: string; recorded: boolean } {
  const r = p.failure_message?.trim();
  return r ? { text: r, recorded: true } : { text: FAIL_FALLBACK, recorded: false };
}
