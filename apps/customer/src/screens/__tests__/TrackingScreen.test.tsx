/**
 * #60 — a completed order shows the receipt the server saved at completion
 * (`GET /v1/orders/{orderId}/receipt`): its line items and its total, not a sum made on the device.
 */
import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

import orderCompleted from '../../../../../contracts/fixtures/orders/order_completed.json';
import receiptStandard from '../../../../../contracts/fixtures/orders/receipt_standard.json';

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
