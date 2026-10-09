/**
 * #388 — while staff have paused new orders, the cart says so and offers no checkout. The cart
 * here is made quotable (`cart_single_line` with nothing blocking), so the pause comes from the
 * public config alone (`public_config_ordering_paused`, read by `OrderingPauseProvider` at
 * launch): nothing else may be what hides "Continue to checkout".
 */
import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

import publicConfigPaused from '../../../../../contracts/fixtures/platform/public_config_ordering_paused.json';
import cartSingleLine from '../../../../../contracts/fixtures/cart/cart_single_line.json';

const quotableCart = { ...cartSingleLine.payload, is_quotable: true, blocking_reasons: [] };

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

const { CartScreen } = require('../CartScreen') as typeof import('../CartScreen');
const { OrderingPauseProvider } = require('../../ordering/orderingPause') as typeof import('../../ordering/orderingPause');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');
const stack = require('../../navigation/stack') as typeof import('../../navigation/stack');

describe('CartScreen — ordering paused', () => {
  it('says ordering is paused and offers no checkout when the public config is paused', async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/config/public')) return stubOk({ data: publicConfigPaused.payload });
      if (url.endsWith('/v1/cart')) return stubOk({ data: quotableCart });
      throw new Error(`unexpected fetch: ${url}`);
    });
    jest.spyOn(stack, 'useNavigation').mockReturnValue({
      current: { name: 'cart' },
      canGoBack: true,
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      popTo: jest.fn(),
      reset: jest.fn(),
    });

    render(
      <ThemeProvider theme="customer" scheme="light">
        <OrderingPauseProvider>
          <CartScreen />
        </OrderingPauseProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText('Ordering is paused for now')).toBeTruthy());
    expect(screen.getByText(quotableCart.lines[0]!.name)).toBeTruthy();
    expect(screen.queryByText('Continue to checkout')).toBeNull();
    expect(screen.queryByText('Not ready to check out')).toBeNull();
  });
});
