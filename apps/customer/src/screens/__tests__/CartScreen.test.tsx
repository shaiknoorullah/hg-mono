/**
 * #388 — while staff have paused new orders, the cart says so and offers no checkout. The cart
 * here is made quotable (`cart_single_line` with nothing blocking), so the pause comes from the
 * public config alone (`public_config_ordering_paused`, read by `OrderingPauseProvider` at
 * launch): nothing else may be what hides "Go to checkout".
 */
import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

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
    expect(screen.queryByText('Go to checkout')).toBeNull();
    expect(screen.queryByText('Not ready to check out')).toBeNull();
  });
});

describe('CartScreen — lines say what tells them apart', () => {
  it('shows the variant, each add-on with its count, and the special request', async () => {
    const base = quotableCart.lines[0]!;
    const lassi = (id: string, extra: Partial<Schema['CartLine']>) => ({
      ...base,
      id,
      name: 'Special Mango Lassi',
      variant: null,
      addons: [],
      special_request: null,
      ...extra,
    });
    const cart = {
      ...quotableCart,
      delivery_address_id: null,
      lines: [
        lassi('00000000-0000-4000-8000-000000000001', {
          variant: { variant_id: '00000000-0000-4000-8000-0000000000a1', name: 'Large', pricing_mode: 'ABSOLUTE' },
          addons: [{ addon_id: '00000000-0000-4000-8000-0000000000b1', name: 'Extra mango', quantity: 2 }],
        }),
        lassi('00000000-0000-4000-8000-000000000002', { special_request: 'Less sugar' }),
      ],
    };
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/cart')) return stubOk({ data: cart });
      if (url.endsWith('/v1/config/public')) {
        return stubOk({ data: { ...publicConfigPaused.payload, ordering: { paused: false } } });
      }
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
        <CartScreen />
      </ThemeProvider>,
    );

    expect(await screen.findAllByText('Special Mango Lassi')).toHaveLength(2);
    expect(screen.getByText('Large · Extra mango × 2')).toBeTruthy();
    expect(screen.getByText('“Less sugar”')).toBeTruthy();
  });
});
