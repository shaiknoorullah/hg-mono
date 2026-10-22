/**
 * What the delivered and completed page says, from the contract's fixtures: the heading for each
 * state, the handover line (what was asked, never what happened), the refund row's wording, and the
 * actions that appear only when they can be used.
 */
import type { Schema } from '@hg/api-client';

import { payloadOf } from '../../test/mockApi';
import { formatTime } from '../../lib/time';
import {
  deliveredActionsOf,
  deliveredHeadingOf,
  deliveredRefundRowOf,
  handoverLineOf,
  isDeliveredState,
  refundRowFor,
} from '../deliveredView';

type Order = Schema['OrderCustomerView'];
type Refund = Schema['Refund'];

const order = (scenario: string, patch: Partial<Order> = {}): Order => ({ ...payloadOf<Order>(scenario), ...patch });
const refund = (scenario: string, patch: Partial<Refund> = {}): Refund => ({ ...payloadOf<Refund>(scenario), ...patch });

describe('which states this page draws', () => {
  it('draws delivered and completed, nothing else', () => {
    expect(isDeliveredState('DELIVERED')).toBe(true);
    expect(isDeliveredState('COMPLETED')).toBe(true);
    for (const s of ['ARRIVED', 'CANCELLED', 'DISPUTED', 'RESOLVED', 'FAILED', 'REJECTED', 'CREATED']) {
      expect(isDeliveredState(s)).toBe(false);
    }
  });
});

describe('the heading', () => {
  it('delivered quotes the time it arrived', () => {
    const o = order('order_delivered');
    const time = formatTime(o.delivered_at!);
    const h = deliveredHeadingOf(o);
    expect(h.overline).toBe('Delivered');
    expect(h.display).toBe(`At ${time}`);
    expect(h.spoken).toBe(`Delivered at ${time}`);
  });

  it('completed says the order is complete and when it was delivered', () => {
    const o = order('order_completed');
    const time = formatTime(o.delivered_at!);
    const h = deliveredHeadingOf(o);
    expect(h.display).toBe('Order complete');
    expect(h.overline).toBe(`Delivered at ${time}`);
    expect(h.spoken).toBe(`Order complete, delivered at ${time}`);
    expect(h.line).toBeNull();
  });

  it('with no delivery time it says only "Delivered", never a made-up time', () => {
    const h = deliveredHeadingOf(order('order_delivered', { delivered_at: null, state_since: null as unknown as string }));
    expect(h.display).toBe('Delivered');
    expect(h.overline).toBeNull();
    expect(h.spoken).toBe('Delivered');
  });
});

describe('the handover line says what was asked', () => {
  it('meet at the door, meet in the lobby, leave at the door, leave without ringing', () => {
    expect(handoverLineOf({ delivery_instructions: ['MEET_AT_DOOR'] })).toBe('You asked to meet at the door.');
    expect(handoverLineOf({ delivery_instructions: ['MEET_IN_LOBBY'] })).toBe('You asked to meet in the lobby.');
    expect(handoverLineOf({ delivery_instructions: ['LEAVE_AT_DOOR'] })).toBe('You asked us to leave it at the door.');
    expect(handoverLineOf({ delivery_instructions: ['LEAVE_AT_DOOR', 'DO_NOT_RING_BELL'] })).toBe(
      'You asked us to leave it at the door and not ring the bell.',
    );
  });

  it('never claims what happened at the door', () => {
    for (const instructions of [['MEET_AT_DOOR'], ['MEET_IN_LOBBY'], ['LEAVE_AT_DOOR'], []] as Order['delivery_instructions'][]) {
      expect(handoverLineOf({ delivery_instructions: instructions })).toMatch(/^You asked/);
    }
  });
});

describe('the refund row', () => {
  it('a report with no decision is "Your report", under review, with no amount', () => {
    const row = deliveredRefundRowOf(refund('refund_requested'), 'Visa •••• 4242');
    expect(row.label).toBe('Your report');
    expect(row.badge).toBe('Under review');
    expect(row.cents).toBeNull();
  });

  it('a refund on its way shows its amount; it is not "Refunded"', () => {
    const r = refund('refund_submitted');
    const row = deliveredRefundRowOf(r, 'Visa •••• 4242');
    expect(row.label).toBe('Refund');
    expect(row.badge).toBe('On its way');
    expect(row.tone).toBe('info');
    expect(row.cents).toBe(r.amount_cents);
  });

  it('a settled refund says Refunded with its amount and date', () => {
    const r = refund('refund_settled');
    const row = deliveredRefundRowOf(r, 'Visa •••• 4242');
    expect(row.badge).toBe('Refunded');
    expect(row.tone).toBe('neutral');
    expect(row.cents).toBe(r.amount_cents);
    expect(row.line).toMatch(/^Refunded to Visa •••• 4242/);
  });

  it('a failed refund reads "Refund in progress", never "Refunded"', () => {
    const row = deliveredRefundRowOf(refund('refund_failed'), null);
    expect(row.badge).toBe('Refund in progress');
    expect(row.badge).not.toMatch(/^Refunded/);
  });

  it('a declined report says "Not approved" with no amount; a withdrawn one says "Withdrawn"', () => {
    expect(deliveredRefundRowOf(refund('refund_declined'), null)).toMatchObject({ label: 'Your report', badge: 'Not approved', cents: null });
    expect(deliveredRefundRowOf(refund('refund_cancelled'), null)).toMatchObject({ badge: 'Withdrawn', cents: null });
  });

  it('no refunds, no row; with several, the one still holding a claim', () => {
    expect(refundRowFor([], null)).toBeNull();
    const row = refundRowFor([refund('refund_declined'), refund('refund_submitted')], null);
    expect(row?.badge).toBe('On its way');
  });
});

describe('the actions', () => {
  it('delivered: Get help only, and the receipt is promised, not offered', () => {
    expect(deliveredActionsOf({ state: 'DELIVERED' })).toEqual({
      actions: ['getHelp'],
      note: "We'll add your receipt here when the order is complete, and let you know.",
    });
  });

  it('completed: View receipt first, then Get help; no rating action anywhere', () => {
    const a = deliveredActionsOf({ state: 'COMPLETED' });
    expect(a.actions).toEqual(['viewReceipt', 'getHelp']);
    expect(a.note).toBeNull();
  });
});
