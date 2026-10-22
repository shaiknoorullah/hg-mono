/**
 * Payment recovery's rules without a screen: which unpaid orders need the customer, and the fixed
 * words for a decline (never the bank's own text).
 */
import type { Schema } from '@hg/api-client';

import { payloadOf } from '../../test/mockApi';
import { declineCodeOf, declineTitleOf, recoveryOf } from '../paymentRecovery';

type Payment = Schema['OrderPayment'];
const payment = (scenario: string, patch: Partial<Payment> = {}): Payment => ({ ...payloadOf<Payment>(scenario), ...patch });

describe('which unpaid orders need the customer', () => {
  it('a bank check outstanding on a CREATED order, with the secret to resume it', () => {
    const p = payment('payment_requires_action');
    expect(recoveryOf({ state: 'CREATED' }, p)).toEqual({ kind: 'bank', secret: p.client_secret });
  });

  it('a decline on a CREATED order, from either state the contract uses', () => {
    expect(recoveryOf({ state: 'CREATED' }, payment('payment_requires_payment_method', { failure_code: 'card_declined' }))).toEqual({
      kind: 'declined',
      code: 'card_declined',
    });
    expect(recoveryOf({ state: 'CREATED' }, payment('payment_failed'))).toEqual({ kind: 'declined', code: 'insufficient_funds' });
  });

  it('a fresh order with no card tried yet is checkout\'s own step, not a decline', () => {
    expect(recoveryOf({ state: 'CREATED' }, payment('payment_requires_payment_method'))).toBeNull();
  });

  it('nothing else needs recovery: processing, authorised, no payment read, or any other order state', () => {
    expect(recoveryOf({ state: 'CREATED' }, payment('payment_processing'))).toBeNull();
    expect(recoveryOf({ state: 'CREATED' }, payment('payment_requires_capture'))).toBeNull();
    expect(recoveryOf({ state: 'CREATED' }, null)).toBeNull();
    expect(recoveryOf({ state: 'RESTAURANT_PENDING' }, payment('payment_requires_action'))).toBeNull();
    expect(recoveryOf({ state: 'FAILED' }, payment('payment_failed'))).toBeNull();
  });
});

describe('the words for a decline', () => {
  it('prefers the bank\'s decline code, then the failure code', () => {
    expect(declineCodeOf({ decline_code: 'insufficient_funds', failure_code: 'card_declined' })).toBe('insufficient_funds');
    expect(declineCodeOf({ decline_code: null, failure_code: 'card_declined' })).toBe('card_declined');
    expect(declineCodeOf({ decline_code: null, failure_code: null })).toBeNull();
  });

  it('each known code has its own headline naming the card', () => {
    const card = 'Visa •••• 4242';
    expect(declineTitleOf('card_declined', card)).toBe('Your bank declined Visa •••• 4242');
    expect(declineTitleOf('insufficient_funds', card)).toBe("Visa •••• 4242 doesn't have enough available");
    expect(declineTitleOf('expired_card', card)).toBe('Visa •••• 4242 has expired');
    expect(declineTitleOf('incorrect_cvc', card)).toBe("The security code for Visa •••• 4242 didn't match");
    expect(declineTitleOf('authentication_failed', card)).toBe("Your bank didn't confirm the payment on Visa •••• 4242");
    expect(declineTitleOf('processing_error', card)).toBe("The payment on Visa •••• 4242 didn't go through");
  });

  it('an unknown code or an unknown card gets the general words, and no raw text is ever passed through', () => {
    expect(declineTitleOf('do_not_honor_xyz', null)).toBe("The payment on your card didn't go through");
    expect(declineTitleOf(null, null)).toBe("The payment on your card didn't go through");
  });
});
