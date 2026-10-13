/**
 * WP9 tables (DONE list): the 14 row badges, the money wording (only REJECTED and FAILED say "Not
 * charged"), the refund section per RefundState, and the receipt 409 variants chosen by the payment.
 */
import type { Schema } from '@hg/api-client';

import {
  HOLD_RELEASED,
  NOTHING_CHARGED,
  NOT_CHARGED,
  ORDER_ROW_BADGE,
  PAYMENT_DIDNT_GO_THROUGH,
  SEE_DETAILS_FOR_MONEY,
  cardName,
  chooseNoReceipt,
  dayAndTime,
  hasReceipt,
  itemsLine,
  placedLine,
  refundNote,
  refundView,
  rowBadge,
  rowMoney,
} from '../format';

type OrderState = Schema['OrderState'];
type RefundState = Schema['RefundState'];

const ALL_STATES: OrderState[] = [
  'CREATED',
  'AUTHORIZED',
  'RESTAURANT_PENDING',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'ARRIVED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'DISPUTED',
  'RESOLVED',
];

describe('Orders row badges (canvas note s6)', () => {
  it.each<[OrderState, string, 'info' | 'neutral']>([
    ['CREATED', 'Placing', 'info'],
    ['AUTHORIZED', 'Placing', 'info'],
    ['RESTAURANT_PENDING', 'Waiting for restaurant', 'info'],
    ['PREPARING', 'Being prepared', 'info'],
    ['READY_FOR_PICKUP', 'Ready', 'info'],
    ['PICKED_UP', 'On the way', 'info'],
    ['ARRIVED', 'At your door', 'info'],
    ['DELIVERED', 'Delivered', 'info'],
    ['COMPLETED', 'Completed', 'neutral'],
    ['DISPUTED', 'Under review', 'neutral'],
    ['RESOLVED', 'Resolved', 'neutral'],
    ['CANCELLED', 'Cancelled', 'neutral'],
    ['REJECTED', 'Not accepted', 'neutral'],
    ['FAILED', 'Payment failed', 'neutral'],
  ])('%s reads "%s" (%s)', (state, label, variant) => {
    expect(rowBadge(state)).toEqual({ label, variant });
  });

  it('covers all fourteen states of the contract', () => {
    expect(Object.keys(ORDER_ROW_BADGE).sort()).toEqual([...ALL_STATES].sort());
  });

  it('gives an unknown future state no badge rather than a guess', () => {
    expect(rowBadge('SOMETHING_NEW')).toBeNull();
  });
});

describe('Orders row money', () => {
  it.each(ALL_STATES)('%s', (state) => {
    const money = rowMoney(state);
    if (state === 'REJECTED' || state === 'FAILED') expect(money).toEqual({ kind: 'text', text: NOT_CHARGED });
    else if (state === 'CANCELLED' || state === 'RESOLVED') expect(money).toEqual({ kind: 'text', text: SEE_DETAILS_FOR_MONEY });
    else expect(money).toEqual({ kind: 'total' });
  });

  it('says "Not charged" for exactly two states', () => {
    const notCharged = ALL_STATES.filter((s) => {
      const m = rowMoney(s);
      return m.kind === 'text' && m.text === NOT_CHARGED;
    });
    expect(notCharged).toEqual(['REJECTED', 'FAILED']);
  });

  it('offers View receipt for a completed order and a resolved one (completed, then disputed)', () => {
    expect(ALL_STATES.filter(hasReceipt).sort()).toEqual(['COMPLETED', 'RESOLVED']);
  });
});

describe('Orders row text', () => {
  it('writes "{item_count} items · {first_item_names}"', () => {
    expect(itemsLine({ item_count: 3, first_item_names: ['Chicken Biryani', 'Beef Nihari'] })).toBe(
      '3 items · Chicken Biryani, Beef Nihari',
    );
    expect(itemsLine({ item_count: 1, first_item_names: ['Mixed charcoal grill'] })).toBe('1 item · Mixed charcoal grill');
    expect(itemsLine({ item_count: 2, first_item_names: [] })).toBe('2 items');
    expect(itemsLine({})).toBeNull();
  });

  it('says "Today, 6:42 pm" for today and the date otherwise, in Toronto time', () => {
    const now = Date.parse('2026-10-09T23:00:00Z'); // 7:00 pm in Toronto
    expect(placedLine('2026-10-09T22:42:00Z', now)).toBe('Today, 6:42 pm');
    expect(placedLine('2026-09-25T20:00:00Z', now)).toBe('25 September 2026');
    // 1:00 am UTC on the 10th is still the 9th in Toronto.
    expect(placedLine('2026-10-10T01:00:00Z', Date.parse('2026-10-10T02:00:00Z'))).toBe('Today, 9:00 pm');
  });

  it('writes a review deadline as "29 September, 7:20 pm"', () => {
    expect(dayAndTime('2026-09-29T23:20:00Z')).toBe('29 September, 7:20 pm');
  });
});

describe('payment card name', () => {
  it('names the card, the wallet, or nothing', () => {
    expect(cardName({ card_brand: 'visa', card_last4: '4242' })).toBe('Visa •••• 4242');
    expect(cardName({ card_brand: 'mastercard', card_last4: '4444' })).toBe('Mastercard •••• 4444');
    expect(cardName({ wallet: 'apple_pay' })).toBe('Apple Pay');
    expect(cardName({})).toBeNull();
  });
});

describe('the refund section per RefundState', () => {
  const base = { requested_at: '2026-09-28T22:00:00Z', settled_at: '2026-09-30T15:00:00Z' };
  const card = 'Visa •••• 4242';

  it.each<[RefundState, string, string, boolean]>([
    ['REQUESTED', 'Under review', "Requested on 28 September 2026. We'll set the amount when we decide.", false],
    ['PENDING_APPROVAL', 'Under review', "Requested on 28 September 2026. We'll set the amount when we decide.", false],
    ['APPROVED', 'On its way', 'On its way to Visa •••• 4242', true],
    ['AUTHORISED', 'On its way', 'On its way to Visa •••• 4242', true],
    ['SUBMITTED', 'On its way', 'On its way to Visa •••• 4242', true],
    ['FAILED', 'Refund in progress', 'Taking longer than usual. Our team is on it.', true],
    ['SUCCEEDED', 'Refunded', 'Refunded to Visa •••• 4242 on 30 September 2026', true],
    ['SETTLED', 'Refunded', 'Refunded to Visa •••• 4242 on 30 September 2026', true],
    ['DECLINED', 'Not approved', "We reviewed your request and didn't issue a refund.", false],
    ['CANCELLED', 'Withdrawn', 'This request was withdrawn.', false],
  ])('%s reads "%s"', (state, badge, line, showAmount) => {
    expect(refundView({ ...base, state }, card)).toEqual({ badge, line, showAmount });
  });

  it('never says "Refunded" for a failed refund', () => {
    const v = refundView({ ...base, state: 'FAILED' }, card);
    expect(`${v.badge} ${v.line}`).not.toMatch(/Refunded/);
  });

  it('states the reason from the fixed table, never a note', () => {
    expect(refundNote('DISPUTE_RESOLUTION')).toBe(
      'After a review by our team. Added below the original receipt, which never changes.',
    );
    expect(refundNote('MISSING_ITEMS')).toBe('For missing items. Added below the original receipt, which never changes.');
    expect(refundNote('OTHER')).toBe('Added below the original receipt, which never changes.');
  });
});

describe('which "no receipt" page a 409 means', () => {
  const captured = { amount_authorized_cents: 4826, amount_captured_cents: 4826 };

  it('a hold that was released: never captured, authorised above zero', () => {
    expect(
      chooseNoReceipt({ state: 'REJECTED' }, { amount_authorized_cents: 4826, amount_captured_cents: 0 }),
    ).toEqual({ kind: 'noCharge', second: HOLD_RELEASED });
  });

  it('a payment that did not go through: nothing authorised, order FAILED or payment expired', () => {
    const none = { amount_authorized_cents: 0, amount_captured_cents: 0 };
    expect(chooseNoReceipt({ state: 'FAILED' }, none)).toEqual({ kind: 'noCharge', second: PAYMENT_DIDNT_GO_THROUGH });
    expect(chooseNoReceipt({ state: 'CANCELLED', cancel_reason: 'PAYMENT_EXPIRED' }, none)).toEqual({
      kind: 'noCharge',
      second: PAYMENT_DIDNT_GO_THROUGH,
    });
  });

  it('a cancel before payment: nothing authorised', () => {
    expect(
      chooseNoReceipt({ state: 'CANCELLED', cancel_reason: 'CUSTOMER_CANCELLED' }, { amount_authorized_cents: 0, amount_captured_cents: 0 }),
    ).toEqual({ kind: 'noCharge', second: NOTHING_CHARGED });
  });

  it('reviewed before it completed: DISPUTED or RESOLVED without completed_at', () => {
    expect(chooseNoReceipt({ state: 'DISPUTED', completed_at: null }, captured)).toEqual({ kind: 'neverCompleted' });
    expect(chooseNoReceipt({ state: 'RESOLVED', completed_at: null }, captured)).toEqual({ kind: 'neverCompleted' });
  });

  it('not ready yet: DELIVERED, before COMPLETED', () => {
    expect(chooseNoReceipt({ state: 'DELIVERED', completed_at: null }, captured)).toEqual({ kind: 'notReady' });
    expect(chooseNoReceipt({ state: 'DELIVERED', completed_at: null }, null)).toEqual({ kind: 'notReady' });
  });

  it('never says "reviewed" for an order cancelled, rejected or failed after capture', () => {
    for (const state of ['CANCELLED', 'REJECTED', 'FAILED']) {
      expect(chooseNoReceipt({ state, completed_at: null }, captured)).toBeNull();
    }
  });

  it('cannot tell without the order or the payment', () => {
    expect(chooseNoReceipt(null, captured)).toBeNull();
    expect(chooseNoReceipt({ state: 'CANCELLED' }, null)).toBeNull();
  });
});
