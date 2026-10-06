/**
 * Card payment never crashes the app, on either platform, and every Stripe outcome maps to one
 * PayResult the checkout can show.
 *
 * - No publishable key (or a value that is not one): both `payWithSheet`s answer `unconfigured`
 *   without touching Stripe.
 * - Web: `payWithSheet` resolves through the mounted sheet host, and Stripe.js's confirmation
 *   (success, 3-D Secure, decline, incomplete form) maps to paid / failed / retry.
 */
import type { PaymentIntentResult } from '@stripe/stripe-js';

import { confirmOutcome } from '../confirmResult';
import { registerHost, settle, getSnapshot, NO_HOST_MESSAGE } from '../sheetController';
import { UNCONFIGURED_MESSAGE, UNCONFIGURED_REASON } from '../types';

const KEY = 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY';
// Not a key: the shape `stripePublishableKey()` accepts, and nothing more.
const PLACEHOLDER_KEY = 'pk_test_placeholder_for_tests';

jest.mock('@stripe/stripe-react-native', () => ({
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async () => ({})),
}));
const native = require('@stripe/stripe-react-native') as {
  initPaymentSheet: jest.Mock;
  presentPaymentSheet: jest.Mock;
};

const { payWithSheet: payWeb } = require('../pay.web') as typeof import('../pay.web');
const { payWithSheet: payNative } = require('../pay') as typeof import('../pay');

afterEach(() => {
  delete process.env[KEY];
  native.initPaymentSheet.mockClear();
});

describe('without a Stripe publishable key', () => {
  it.each([undefined, '', '   ', 'sk_test_never_a_client_key'])(
    'web and native both answer unconfigured for %p, and Stripe is never called',
    async (value) => {
      if (value !== undefined) process.env[KEY] = value;
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const want = { status: 'unconfigured', message: UNCONFIGURED_MESSAGE };
      await expect(payWeb('pi_123_secret_abc')).resolves.toEqual(want);
      await expect(payNative('pi_123_secret_abc')).resolves.toEqual(want);
      expect(native.initPaymentSheet).not.toHaveBeenCalled();
      expect(getSnapshot()).toBeNull();
      // The customer never reads a build setting; the console gets the technical reason.
      expect(UNCONFIGURED_MESSAGE).not.toContain(KEY);
      expect(warn).toHaveBeenCalledWith(UNCONFIGURED_REASON);
      warn.mockRestore();
    },
  );
});

describe('native sheet', () => {
  it('turns an SDK that throws into failed, not a crash', async () => {
    process.env[KEY] = PLACEHOLDER_KEY;
    native.initPaymentSheet.mockRejectedValueOnce(new Error('StripeProvider not mounted'));
    await expect(payNative('pi_123_secret_abc')).resolves.toEqual({
      status: 'failed',
      message: 'StripeProvider not mounted',
    });
  });
});

describe('web sheet', () => {
  beforeEach(() => {
    process.env[KEY] = PLACEHOLDER_KEY;
  });

  it('fails at once when no sheet host is mounted, instead of hanging', async () => {
    await expect(payWeb('pi_123_secret_abc')).resolves.toEqual({ status: 'failed', message: NO_HOST_MESSAGE });
  });

  it('opens the sheet for the secret and resolves with what the host settles', async () => {
    const unregister = registerHost();
    const pending = payWeb('pi_123_secret_abc');
    expect(getSnapshot()?.clientSecret).toBe('pi_123_secret_abc');
    settle({ status: 'paid' });
    await expect(pending).resolves.toEqual({ status: 'paid' });
    expect(getSnapshot()).toBeNull();

    // Unmounting the host while a sheet is open cancels it rather than leaving it pending.
    const orphan = payWeb('pi_456_secret_def');
    unregister();
    await expect(orphan).resolves.toEqual({ status: 'canceled' });
  });
});

describe("mapping Stripe.js's confirmation", () => {
  const intent = (status: string) =>
    ({ paymentIntent: { id: 'pi_1', status } }) as unknown as PaymentIntentResult;
  const error = (type: string, message: string, code?: string) =>
    ({ error: { type, message, code } }) as unknown as PaymentIntentResult;

  it.each([
    // 4242 4242 4242 4242, and 4000 0025 0000 3155 once the challenge passes: authorised only.
    ['authorised (manual capture)', intent('requires_capture'), { status: 'paid' }],
    ['captured', intent('succeeded'), { status: 'paid' }],
    ['processing', intent('processing'), { status: 'paid' }],
    // 4000 0000 0000 0002
    [
      'declined',
      error('card_error', 'Your card was declined.', 'card_declined'),
      { status: 'failed', message: 'Your card was declined.' },
    ],
    // 4000 0025 0000 3155 with the challenge failed or closed
    [
      '3-D Secure failed',
      error('invalid_request_error', 'We are unable to authenticate your payment method.', 'payment_intent_authentication_failure'),
      { status: 'failed', message: 'We are unable to authenticate your payment method.' },
    ],
    [
      'an incomplete card form stays open',
      error('validation_error', 'Your card number is incomplete.'),
      { status: 'retry', message: 'Your card number is incomplete.' },
    ],
    ['an intent still needing a card', intent('requires_payment_method'), { status: 'failed', message: expect.any(String) }],
  ])('%s', (_name, res, want) => {
    expect(confirmOutcome(res)).toEqual(want);
  });
});
