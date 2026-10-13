/**
 * #60 — a completed order shows the receipt the server saved at completion
 * (`GET /v1/orders/{orderId}/receipt`): its line items and its total, not a sum made on the device.
 *
 * #543 — before the restaurant accepts, the customer cancels for free (`cancelOrder`); a
 * `409 CANCELLATION_WINDOW_CLOSED` says the restaurant started first and points to support.
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import orderCompleted from '../../../../../contracts/fixtures/orders/order_completed.json';
import receiptStandard from '../../../../../contracts/fixtures/orders/receipt_standard.json';
import orderRestaurantPending from '../../../../../contracts/fixtures/orders/order_restaurant_pending.json';
import orderCancelled from '../../../../../contracts/fixtures/orders/order_cancelled.json';
import orderPreparing from '../../../../../contracts/fixtures/orders/order_preparing.json';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

function stubOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// See RestaurantScreen.test.tsx: one persistent spy installed before the first import, and the
// screen's module graph loaded at file scope, outside any test's timeout.
const fetchSpy = jest.spyOn(globalThis, 'fetch');

afterAll(() => {
  fetchSpy.mockRestore();
});

const { TrackingScreen } = require('../TrackingScreen') as typeof import('../TrackingScreen');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');
const { formatCents, cents } = require('@hg/api-client') as typeof import('@hg/api-client');
const stack = require('../../navigation/stack') as typeof import('../../navigation/stack');

function renderTracking(orderId: string) {
  jest.spyOn(stack, 'useNavigation').mockReturnValue({
    current: { name: 'tracking' },
    canGoBack: true,
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    popTo: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof stack.useNavigation>);
  return render(
    <ThemeProvider theme="customer" scheme="light">
      <TrackingScreen orderId={orderId} />
    </ThemeProvider>,
  );
}

describe('TrackingScreen — receipt', () => {
  it("renders a completed order's receipt line items and total", async () => {
    const orderId = orderCompleted.payload.id;
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith(`/v1/orders/${orderId}/receipt`)) {
        return stubOk({ data: receiptStandard.payload });
      }
      if (url.endsWith(`/v1/orders/${orderId}`)) return stubOk({ data: orderCompleted.payload });
      throw new Error(`unexpected fetch: ${url}`);
    });
    jest.spyOn(stack, 'useNavigation').mockReturnValue({
      current: { name: 'tracking' },
      canGoBack: true,
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      popTo: jest.fn(),
      reset: jest.fn(),
    } as unknown as ReturnType<typeof stack.useNavigation>);

    render(
      <ThemeProvider theme="customer" scheme="light">
        <TrackingScreen orderId={orderId} />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(`Receipt ${receiptStandard.payload.receipt_number}`)).toBeTruthy(),
    );
    expect(screen.getByText('1 × Chicken Biryani')).toBeTruthy();
    expect(screen.getByText('1 × Beef Nihari (Full)')).toBeTruthy();
    expect(screen.getByText('+ 2 × Garlic naan')).toBeTruthy();
    expect(screen.getByText('HST (13%)')).toBeTruthy();
    // The total is the receipt's own figure, shown with its currency code.
    const total = formatCents(cents(receiptStandard.payload.money.total_cents));
    expect(screen.getByText(`${total} CAD`)).toBeTruthy();
    expect(screen.getByText(`Paid ${total} with visa ••••4242`)).toBeTruthy();
    // The pre-receipt summary is gone once the order has completed.
    expect(screen.queryByText('Order total')).toBeNull();
  });
});

describe('TrackingScreen — cancel before the restaurant accepts', () => {
  const orderId = orderRestaurantPending.payload.id;
  // What the next GET and the cancel POST answer; each phase of the test sets them.
  let currentOrder: unknown;
  let cancelResponse: () => Response;

  async function cancelWithReason(): Promise<Request> {
    let sent: Request | null = null;
    fetchSpy.mockImplementation(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      if (req.url.endsWith(`/v1/orders/${orderId}/cancel`)) {
        sent = req.clone();
        return cancelResponse();
      }
      if (req.url.endsWith(`/v1/orders/${orderId}`)) return stubOk({ data: currentOrder });
      throw new Error(`unexpected fetch: ${req.url}`);
    });

    renderTracking(orderId);
    fireEvent.press(await screen.findByText('Cancel order'));
    // Nothing is sent until a reason is chosen and the customer confirms.
    fireEvent.press(screen.getByTestId('CancelOrder-ORDERED_BY_MISTAKE'));
    fireEvent.press(screen.getByTestId('CancelOrder-confirm'));
    await waitFor(() => expect(sent).not.toBeNull());
    return sent as unknown as Request;
  }

  it('cancels with a reason and an Idempotency-Key and says the customer was not charged; a 409 CANCELLATION_WINDOW_CLOSED points to support', async () => {
    currentOrder = orderRestaurantPending.payload;
    cancelResponse = () => stubOk({ data: orderCancelled.payload });

    const sent = await cancelWithReason();

    expect(sent.method).toBe('POST');
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    const body: Schema['OrderCancellationInput'] = await sent.json();
    expect(body).toEqual({ reason_code: 'ORDERED_BY_MISTAKE' });

    expect(await screen.findByText('Order cancelled. You were not charged.')).toBeTruthy();
    expect(screen.queryByText('Cancel order')).toBeNull();
    screen.unmount();

    // The race lost: the restaurant accepted between the render and the tap.
    currentOrder = orderRestaurantPending.payload;
    const closed: Schema['ErrorEnvelope'] = {
      error: {
        code: 'CANCELLATION_WINDOW_CLOSED',
        message: 'The restaurant has accepted this order.',
        request_id: 'CGQZ1K6PEY9K6MYX91SM6FSP52',
      },
    };
    cancelResponse = () => {
      // The next read shows the order being prepared (the fixture's own code, HG-4K2M-9T).
      currentOrder = { ...orderPreparing.payload, id: orderId };
      return new Response(JSON.stringify(closed), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await cancelWithReason();

    expect(await screen.findByText('The restaurant has already started your order')).toBeTruthy();
    expect(screen.getByText(/contact support with order code HG-4K2M-9T/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Cancel order')).toBeNull());
    // Never the error state, whose treatment is red.
    expect(screen.queryByTestId('ErrorState')).toBeNull();
  });
});
