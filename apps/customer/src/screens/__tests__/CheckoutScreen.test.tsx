/**
 * The checkout's pay path handles every PayResult without throwing ("checkout crashes the app").
 *
 * The order is placed against the fixtures; the card sheet (`payWithSheet`) answers each result in
 * turn. Paid goes to tracking after the order's payment is read (the read that moves the order on
 * where no webhook can reach the server). Every other result keeps the same order on screen with
 * its reason and "Retry payment", never a crash and never a second order.
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import publicConfig from '../../../../../contracts/fixtures/platform/public_config.json';
import addressesList from '../../../../../contracts/fixtures/platform/addresses_list.json';
import cartSingleLine from '../../../../../contracts/fixtures/cart/cart_single_line.json';
import quoteStandard from '../../../../../contracts/fixtures/cart/quote_standard.json';
import orderCreated from '../../../../../contracts/fixtures/orders/order_created.json';
import paymentRequiresPaymentMethod from '../../../../../contracts/fixtures/payments/payment_requires_payment_method.json';
import type { PayResult } from '../../payments/types';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

const mockPayWithSheet = jest.fn<Promise<PayResult>, [string]>();
jest.mock('../../payments/pay', () => ({
  payWithSheet: (secret: string) => mockPayWithSheet(secret),
}));

function stubOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// See RestaurantScreen.test.tsx: one persistent spy installed before the first import, and the
// screen's module graph loaded at file scope, outside any test's timeout.
const fetchSpy = jest.spyOn(globalThis, 'fetch');
afterAll(() => fetchSpy.mockRestore());

const { CheckoutScreen } = require('../CheckoutScreen') as typeof import('../CheckoutScreen');
const { OrderingPauseProvider } = require('../../ordering/orderingPause') as typeof import('../../ordering/orderingPause');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');
const stack = require('../../navigation/stack') as typeof import('../../navigation/stack');

const SECRET = 'pi_checkout_test_secret_abc';
const orderId = orderCreated.payload.id;

describe('CheckoutScreen — the pay path', () => {
  let paymentReads: number;
  let ordersPlaced: number;
  let reset: jest.Mock;

  beforeEach(() => {
    paymentReads = 0;
    ordersPlaced = 0;
    reset = jest.fn();
    mockPayWithSheet.mockReset();
    fetchSpy.mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
      if (url.endsWith('/v1/config/public')) return stubOk({ data: publicConfig.payload });
      if (url.endsWith('/v1/cart')) return stubOk({ data: cartSingleLine.payload });
      if (url.endsWith('/v1/addresses')) return stubOk({ data: addressesList.payload });
      if (url.endsWith('/v1/quotes') && method === 'POST') return stubOk({ data: quoteStandard.payload }, 201);
      if (url.endsWith('/v1/orders') && method === 'POST') {
        ordersPlaced += 1;
        return stubOk({ data: { order: orderCreated.payload, client_secret: SECRET } }, 201);
      }
      if (url.endsWith(`/v1/orders/${orderId}/payment`)) {
        paymentReads += 1;
        return stubOk({ data: { ...paymentRequiresPaymentMethod.payload, order_id: orderId } });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    jest.spyOn(stack, 'useNavigation').mockReturnValue({
      current: { name: 'checkout' },
      canGoBack: true,
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      popTo: jest.fn(),
      reset,
    });
  });

  async function placeOrder(): Promise<void> {
    render(
      <ThemeProvider theme="customer" scheme="light">
        <OrderingPauseProvider>
          <CheckoutScreen />
        </OrderingPauseProvider>
      </ThemeProvider>,
    );
    fireEvent.press(await screen.findByText('Place order'));
    await waitFor(() => expect(mockPayWithSheet).toHaveBeenCalledWith(SECRET));
  }

  it('paid: reads the payment (the server moves the order on) and goes to tracking', async () => {
    mockPayWithSheet.mockResolvedValue({ status: 'paid' });
    await placeOrder();
    await waitFor(() => expect(reset).toHaveBeenCalledWith({ name: 'tracking', orderId }));
    expect(paymentReads).toBe(1);
  });

  it.each<[string, PayResult, string]>([
    ['canceled', { status: 'canceled' }, 'Payment was cancelled. Your order is not placed until you pay.'],
    ['declined', { status: 'failed', message: 'Your card was declined.' }, 'Your card was declined.'],
    ['failed without a message', { status: 'failed' }, 'Payment failed. Please try again.'],
    [
      'unconfigured',
      { status: 'unconfigured', message: 'Card payments are not configured in this build (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).' },
      'Card payments are not configured in this build (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).',
    ],
  ])('%s: stays on checkout with the reason and retries the same order', async (_name, result, message) => {
    mockPayWithSheet.mockResolvedValue(result);
    await placeOrder();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Retry payment'));
    await waitFor(() => expect(mockPayWithSheet).toHaveBeenCalledTimes(2));
    expect(ordersPlaced).toBe(1);
  });

  it('a sheet that throws is a failed payment, not a crash', async () => {
    mockPayWithSheet.mockRejectedValue(new Error('Stripe exploded'));
    await placeOrder();
    expect(await screen.findByText('Stripe exploded')).toBeTruthy();
    expect(screen.getByText('Retry payment')).toBeTruthy();
  });
});
