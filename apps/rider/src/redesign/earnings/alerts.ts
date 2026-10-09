/**
 * What Earnings and Payouts say about payouts, as data: the banners (payout problem first, then
 * payout account; one Fix button on the screen) and the "Next payout" block. Pure functions of
 * the API answers. Amounts are fields passed through (`amount_cents`), never totals.
 *
 * Current contract (EA notes): Payout carries only free-text `failure_message` / `hold_reason`,
 * shown word for word under "Reason given:"; the Fix button is keyed on GET /connect/status.
 * Cause-sorted copy is the "Alternative — needs API" row and is not built.
 */
import type { Cents } from '@hg/api-client';

import { needsFix, stripeDetails, type ConnectStatus, type EarningsSummary, type Payout } from './api';
import { BANNERS, NEXT } from './copy';
import { dayLabel, payoutDayLabel, payoutPeriod } from './format';

export interface PayoutAlert {
  key: string;
  tone: 'warning' | 'info';
  title: string;
  lines: string[];
  detailsLabel?: string;
  details?: string;
  /** Shows "Fix in Stripe". At most one alert on a screen has it. */
  fix: boolean;
  /** Shows "See this payout". */
  payoutId?: string;
}

/** The date the next payout goes out, from the summary (`next_payout_at`). */
export function nextPayoutDate(summary: EarningsSummary | undefined): string | null {
  return summary?.next_payout_at ? payoutDayLabel(summary.next_payout_at) : null;
}

/** Banners for the first page of payouts and the connect status, in the boards' stacking order. */
export function payoutAlerts(
  payouts: readonly Payout[] | undefined,
  connect: ConnectStatus | null | undefined,
  summary: EarningsSummary | undefined,
): PayoutAlert[] {
  const fix = needsFix(connect);
  const nextDate = summary?.next_payout_at ? payoutDayLabel(summary.next_payout_at) : null;
  const held = payouts?.find((p) => p.state === 'HELD');
  const failed = payouts?.find((p) => p.state === 'FAILED');
  const out: PayoutAlert[] = [];

  if (held && failed) {
    out.push({
      key: 'multi',
      tone: 'warning',
      title: BANNERS.multi.title,
      lines: [BANNERS.multi.line(payoutPeriod(held), payoutPeriod(failed)), ...(fix ? [BANNERS.multi.fixLine] : [])],
      fix,
    });
  } else if (held) {
    out.push({
      key: 'held',
      tone: 'warning',
      title: BANNERS.held.title,
      lines: [BANNERS.held.line(payoutPeriod(held)), ...(fix ? [BANNERS.needsAttention] : [])],
      ...(held.hold_reason ? { detailsLabel: BANNERS.reasonLabel, details: held.hold_reason } : {}),
      fix,
      payoutId: held.id,
    });
  } else if (failed) {
    out.push({
      key: 'failed',
      tone: 'warning',
      title: BANNERS.failed.title,
      lines: [BANNERS.failed.line(payoutPeriod(failed), nextDate), ...(fix ? [BANNERS.needsAttention] : [])],
      ...(failed.failure_message ? { detailsLabel: BANNERS.reasonLabel, details: failed.failure_message } : {}),
      fix,
      payoutId: failed.id,
    });
  }

  const fixTaken = out.some((a) => a.fix);
  if (connect && !connect.payouts_enabled) {
    const details = stripeDetails(connect);
    out.push({
      key: 'paused',
      tone: 'warning',
      title: BANNERS.paused.title,
      // A second banner that the same fix clears carries no button (stacking rule).
      lines: fixTaken ? [BANNERS.paused.follower(nextDate)] : BANNERS.paused.lines(nextDate),
      ...(details ? { detailsLabel: BANNERS.stripeLabel, details } : {}),
      fix: !fixTaken,
    });
  } else if (connect && fix && out.length === 0) {
    const deadline = connect.requirements.deadline ? dayLabel(connect.requirements.deadline) : null;
    const details = stripeDetails(connect);
    out.push({
      key: 'due',
      tone: 'info',
      title: BANNERS.due.title(deadline),
      lines: [BANNERS.due.line(deadline)],
      ...(details ? { detailsLabel: BANNERS.stripeLabel, details } : {}),
      fix: true,
    });
  }
  return out;
}

export interface NextPayout {
  /** The DRAFT / READY / TRANSFERRING payout at the top of the list, if any. */
  payout: Payout | null;
  amount: Cents | null;
  date: string | null;
  soFar: boolean;
  note: string | null;
  /** Shown when there is no upcoming payout. */
  noNext: string | null;
  negative: boolean;
  /** A HELD payout's own amount and period, for the "is on hold in the payout for…" line. */
  held: { amount: Cents; period: string } | null;
  pendingLine: boolean;
}

export function nextPayout(
  payouts: readonly Payout[] | undefined,
  connect: ConnectStatus | null | undefined,
  summary: EarningsSummary | undefined,
): NextPayout {
  const first = payouts?.[0];
  const upcoming = first && (first.state === 'DRAFT' || first.state === 'READY' || first.state === 'TRANSFERRING') ? first : null;
  const negative = !!summary && Number(summary.unpaid_balance_cents) < 0;
  const failed = payouts?.some((p) => p.state === 'FAILED') ?? false;
  const heldPayout = payouts?.find((p) => p.state === 'HELD');
  let note: string | null = null;
  if (upcoming?.state === 'READY') note = NEXT.readyNote;
  else if (upcoming?.state === 'TRANSFERRING') note = NEXT.sendingNote;
  else if (upcoming && connect && !connect.payouts_enabled) note = NEXT.heldNote;
  else if (upcoming && failed && needsFix(connect)) note = NEXT.fixFirstNote;
  return {
    payout: upcoming,
    amount: upcoming ? upcoming.amount_cents : null,
    date: nextPayoutDate(summary),
    soFar: upcoming?.state === 'DRAFT',
    note,
    noNext: upcoming ? null : negative ? NEXT.negative : NEXT.nothing,
    negative,
    held: heldPayout ? { amount: heldPayout.amount_cents, period: payoutPeriod(heldPayout) } : null,
    pendingLine: upcoming?.state === 'DRAFT',
  };
}
