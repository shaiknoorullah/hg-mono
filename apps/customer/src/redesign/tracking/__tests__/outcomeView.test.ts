/**
 * What the outcome screen says, from the server's records alone: voided is not refunded, a refund
 * under review shows no amount, a failed refund never reads "Refunded", and no cause is invented.
 */
import type { Schema } from '@hg/api-client';

import { payloadOf } from '../../test/mockApi';
import { moneyOf, outcomeOf, primaryRefund, refundRowOf } from '../outcomeView';

type Order = Schema['OrderCustomerView'];
type Payment = Schema['OrderPayment'];
type Refund = Schema['Refund'];

const order = (scenario: string, patch: Partial<Order> = {}): Order => ({ ...payloadOf<Order>(scenario), ...patch });
const payment = (scenario: string, patch: Partial<Payment> = {}): Payment => ({ ...payloadOf<Payment>(scenario), ...patch });
const refund = (scenario: string, patch: Partial<Refund> = {}): Refund => ({ ...payloadOf<Refund>(scenario), ...patch });
const text = (o: ReturnType<typeof outcomeOf>) => [o.title, ...o.lead, o.actionNote ?? ''].join(' ').trim();

describe('an order that ended before the restaurant accepted (voided)', () => {
  it('a rejection says nothing was charged and never mentions a refund', () => {
    const o = outcomeOf({ order: order('order_rejected'), payment: payment('payment_canceled'), refunds: [], timeline: null });
    expect(text(o)).toContain("You weren't charged.");
    expect(text(o)).not.toMatch(/refund/i);
    expect(o.actions[0]).toBe('putBack');
  });

  it('does not say "not charged" when the payment record says money was taken', () => {
    const o = outcomeOf({ order: order('order_rejected'), payment: payment('payment_succeeded'), refunds: [], timeline: null });
    expect(text(o)).not.toContain("You weren't charged.");
  });

  it('the money card shows the released hold from the order total when a voided hold reads zero', () => {
    const o = order('order_rejected');
    const rows = moneyOf(payment('payment_canceled'), [], 'Visa •••• 4242', o.money.total_cents);
    expect(rows.kind).toBe('read');
    if (rows.kind === 'read') {
      expect(rows.hold?.label).toBe('Hold on Visa •••• 4242, released');
      expect(rows.hold?.cents).toBe(o.money.total_cents);
      expect(rows.charged.cents).toBe(0);
      expect(rows.refund).toBeNull();
      expect(rows.noRefundYet).toBe(false);
    }
  });

  it('a cancel before the payment was ever authorised says no payment was taken', () => {
    const o = outcomeOf({
      order: order('order_cancelled', { cancel_reason: 'CUSTOMER_CANCELLED' }),
      payment: payment('payment_canceled', { authorized_at: null }),
      refunds: [],
      timeline: null,
    });
    expect(text(o)).toContain('before any payment was taken');
  });

  it('a payment that expired is not a decline', () => {
    const o = outcomeOf({ order: order('order_cancelled', { cancel_reason: 'PAYMENT_EXPIRED' }), payment: null, refunds: [], timeline: null });
    expect(o.title).toBe("The bank check wasn't finished");
    expect(text(o)).not.toMatch(/declin|refus/i);
  });
});

describe('an order that was charged', () => {
  const o = order('order_cancelled', { cancel_reason: 'NO_RIDER_FOUND' });
  it('no refund row yet: says so, promises nothing else', () => {
    const rows = moneyOf(payment('payment_succeeded'), [], null, o.money.total_cents);
    expect(rows.kind === 'read' && rows.noRefundYet).toBe(true);
  });

  it('a refund under review shows no amount', () => {
    const row = refundRowOf(refund('refund_requested'), null);
    expect(row.cents).toBeNull();
    expect(row.badge).toBe('Under review');
  });

  it('a refund on its way shows the amount and "On its way to your card"', () => {
    const row = refundRowOf(refund('refund_submitted'), null);
    expect(row.cents).toBe(refund('refund_submitted').amount_cents);
    expect(row.badge).toBe('On its way to your card');
  });

  it('a failed refund reads "Refund in progress", never "Refunded"', () => {
    const row = refundRowOf(refund('refund_failed'), null);
    expect(row.badge).toBe('Refund in progress');
    expect(`${row.label} ${row.line}`).not.toMatch(/Refunded/);
  });

  it('a settled refund shows its date and amount', () => {
    const row = refundRowOf(refund('refund_settled'), null);
    expect(row.label).toMatch(/^Refunded on /);
    expect(row.cents).toBe(refund('refund_settled').amount_cents);
  });

  it('a declined refund reads "Not approved" with no amount', () => {
    const row = refundRowOf(refund('refund_declined'), null);
    expect(row.badge).toBe('Not approved');
    expect(row.cents).toBeNull();
  });

  it('the primary refund is the newest one still holding a claim', () => {
    const declinedNewer = refund('refund_declined', { requested_at: '2026-08-11T10:00:00.000Z' });
    const holdingOlder = refund('refund_requested', { requested_at: '2026-08-10T10:00:00.000Z' });
    expect(primaryRefund([declinedNewer, holdingOlder])?.state).toBe('REQUESTED');
    expect(primaryRefund([declinedNewer])?.state).toBe('DECLINED');
    expect(primaryRefund([])).toBeNull();
  });
});

describe('under review and resolved', () => {
  const disputed = order('order_disputed');
  const into = (from: Schema['OrderState'], actor: Schema['OrderActorKind']) => [
    { from_state: from, to_state: 'DISPUTED' as const, actor_kind: actor, reason: null, at: disputed.state_since! },
  ];

  it('mid-delivery says the order may not arrive and who decides money', () => {
    const o = outcomeOf({ order: disputed, payment: null, refunds: [], timeline: into('PICKED_UP', 'SYSTEM') });
    expect(o.title).toBe("We're looking into your delivery");
    expect(o.badge).toBe('Under review');
    expect(o.timeline).toBe(true);
  });

  it('a restaurant that cannot finish says the order will not be delivered, and promises no refund', () => {
    const o = outcomeOf({ order: disputed, payment: null, refunds: [], timeline: into('PREPARING', 'RESTAURANT') });
    expect(o.title).toContain("can't finish your order");
    expect(text(o)).toContain("won't be delivered");
    expect(text(o)).not.toMatch(/refund/i);
  });

  it('after delivery the sentence follows who opened the review and states no cause', () => {
    const team = outcomeOf({ order: disputed, payment: null, refunds: [], timeline: into('DELIVERED', 'SUPPORT') });
    expect(text(team)).toContain('Our team opened a review of this order');
    const restaurant = outcomeOf({ order: disputed, payment: null, refunds: [], timeline: into('DELIVERED', 'RESTAURANT') });
    expect(text(restaurant)).toContain('asked us to review this order');
    const unknown = outcomeOf({ order: disputed, payment: null, refunds: [], timeline: null });
    expect(text(unknown)).toContain('A review of this order was opened');
  });

  it('resolved: a whole refund, part of one, none, and no refund row at all', () => {
    const resolved = order('order_resolved');
    const say = (refunds: Refund[]) => text(outcomeOf({ order: resolved, payment: null, refunds, timeline: null }));
    expect(say([refund('refund_settled', { scope: 'FULL', kind: 'FULL' })])).toContain('refunded your order');
    expect(say([refund('refund_settled', { scope: 'PARTIAL_ITEMS', kind: 'PARTIAL_ITEMS' })])).toContain('refunded part of your order');
    expect(say([refund('refund_declined')])).toContain("didn't issue a refund");
    expect(say([])).toBe("We've finished reviewing this order Our team has finished its review.");
  });

  it('View receipt only for an order that completed; Call us only after a declined refund', () => {
    const withReceipt = outcomeOf({ order: order('order_resolved'), payment: null, refunds: [refund('refund_settled')], timeline: null });
    expect(withReceipt.actions).toContain('viewReceipt');
    const never = outcomeOf({ order: order('order_resolved', { completed_at: null }), payment: null, refunds: [refund('refund_settled')], timeline: null });
    expect(never.actions).not.toContain('viewReceipt');
    const declined = outcomeOf({ order: order('order_resolved'), payment: null, refunds: [refund('refund_declined')], timeline: null });
    expect(declined.actions).toEqual(['done', 'callUs']);
  });
});
