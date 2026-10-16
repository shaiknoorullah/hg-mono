/**
 * Checkout's pure rules: the tip, the was/now comparison, the delivery notes, the cancellation form
 * and the request that puts a cancelled order's items back. No amount is ever computed here.
 */
import { HgApiError, cents } from '@hg/api-client';

import { payloadOf } from '../../test/mockApi';
import {
  CANCEL_REASONS,
  TIP_PRESETS,
  blockOf,
  cancelReady,
  cardExpired,
  changedRows,
  declineCopy,
  instructionsOf,
  isTipRefusal,
  lineToInput,
  quoteLineOptions,
  staleQuoteOf,
  tipOf,
} from '../model';

describe('tip', () => {
  it('presets are the customer\'s own cents; "Other" parses without a float', () => {
    expect(TIP_PRESETS).toEqual([0, 200, 300, 500]);
    expect(tipOf({ kind: 'preset', value: cents(300) })).toBe(300);
    expect(tipOf({ kind: 'other', text: '4.50' })).toBe(450);
    expect(tipOf({ kind: 'other', text: '$0.29' })).toBe(29);
    expect(tipOf({ kind: 'other', text: '' })).toBeNull();
    expect(tipOf({ kind: 'other', text: 'abc' })).toBeNull();
    expect(tipOf({ kind: 'other', text: '-3' })).toBeNull();
  });

  it('a 422 names the tip only when its field is tip_cents', () => {
    const body = (field: string) => ({ error: { code: 'VALIDATION_FAILED', message: 'x', request_id: 'r', details: [{ field, code: 'x', message: 'x' }] } });
    expect(isTipRefusal(new HgApiError(422, body('tip_cents') as never))).toBe(true);
    expect(isTipRefusal(new HgApiError(422, body('email') as never))).toBe(false);
    expect(isTipRefusal(new Error('network'))).toBe(false);
  });
});

describe('what the server changed between two quotes', () => {
  const was = payloadOf('quote_standard');
  it('lists only the figures that differ, old and new, both from the server', () => {
    const now = { ...was, delivery_fee_cents: was.delivery_fee_cents + 100, total_cents: was.total_cents + 100 };
    expect(changedRows(was, now)).toEqual([
      { label: 'Delivery fee', was: was.delivery_fee_cents, now: now.delivery_fee_cents },
      { label: 'Total', was: was.total_cents, now: now.total_cents },
    ]);
    expect(changedRows(was, was)).toEqual([]);
  });

  it('reads the fresh quote a QUOTE_STALE carries, and tolerates one that carries none', () => {
    expect(staleQuoteOf({ details: { quote: was } })?.id).toBe(was.id);
    expect(staleQuoteOf({ details: [] })).toBeNull();
    expect(staleQuoteOf(new Error('x'))).toBeNull();
  });
});

describe('refusals', () => {
  it('maps the contract codes to boards, and an unknown code to none', () => {
    expect(blockOf('BELOW_MINIMUM_ORDER')).toBe('belowMinimum');
    expect(blockOf('ADDRESS_OUT_OF_RANGE')).toBe('outOfRange');
    expect(blockOf('PROFILE_INCOMPLETE')).toBe('profileIncomplete');
    expect(blockOf('ORDERING_PAUSED')).toBe('orderingPaused');
    expect(blockOf('SOMETHING_NEW')).toBeNull();
    expect(blockOf(null)).toBeNull();
  });
});

describe('payment failures', () => {
  it('shows fixed copy per failure code, never provider text, and always says nothing was charged', () => {
    for (const code of ['card_declined', 'insufficient_funds', 'expired_card', 'incorrect_cvc', 'authentication_failed', 'processing_error', 'something_new', null]) {
      expect(declineCopy(code).body).toContain('Nothing was charged.');
    }
    expect(declineCopy('card_declined').title).toBe('Your bank declined this card');
  });

  it('a card is good through the last day of its expiry month', () => {
    const aug10 = Date.parse('2026-08-10T18:00:00Z');
    expect(cardExpired({ exp_month: 8, exp_year: 2026 }, aug10)).toBe(false);
    expect(cardExpired({ exp_month: 7, exp_year: 2026 }, aug10)).toBe(true);
    expect(cardExpired({ exp_month: 12, exp_year: 2025 }, aug10)).toBe(true);
  });
});

describe('delivery notes and cancellation', () => {
  it('sends the handover first, then the two optional flags', () => {
    expect(instructionsOf({ choice: 'MEET_AT_DOOR', noRing: false, noCall: false, note: '' })).toEqual(['MEET_AT_DOOR']);
    expect(instructionsOf({ choice: 'LEAVE_AT_DOOR', noRing: true, noCall: true, note: '' })).toEqual(['LEAVE_AT_DOOR', 'DO_NOT_RING_BELL', 'DO_NOT_CALL']);
  });

  it('needs a reason, and for "Something else" a note of 5 to 200 characters', () => {
    expect(CANCEL_REASONS.map((r) => r.value)).toContain('OTHER');
    expect(cancelReady(null, '')).toBe(false);
    expect(cancelReady('CHANGED_MIND', '')).toBe(true);
    expect(cancelReady('OTHER', 'oops')).toBe(false);
    expect(cancelReady('OTHER', 'changed plans')).toBe(true);
    expect(cancelReady('OTHER', 'x'.repeat(201))).toBe(false);
  });
});

describe('putting items back', () => {
  it('turns an order line into ids and a quantity, with no price field', () => {
    const order = payloadOf('order_created');
    const input = lineToInput({
      ...order.lines[0],
      quantity: 2,
      special_request: ' no onions ',
      variants: [{ variant_id: 'v1' }],
      addons: [{ addon_id: 'a1', addon_quantity: 3 }],
    });
    expect(input).toEqual({ menu_item_id: order.lines[0].menu_item_id, quantity: 2, variant_ids: ['v1'], addons: [{ addon_id: 'a1', quantity: 3 }], special_request: 'no onions' });
    expect(Object.keys(input).filter((k) => /price|total|amount|fee/i.test(k))).toEqual([]);
  });

  it('writes options as "group: variant" then add-ons', () => {
    const q = payloadOf('quote_multi_variant');
    const text = quoteLineOptions(q.lines[0]);
    expect(text).toContain(': ');
  });
});
