/**
 * The critical customer-side interaction: opening a dish and adding it surfaces the sticky
 * "View cart" bar and, on press, hands off to the cart route. Nothing about price is computed
 * here (G-3) — the bar comes straight off the server-recomputed `Cart` `addCartLine` returns,
 * never a local increment. The "Added" toast sits above the bar and never takes its taps.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import restaurantDetail from '../../../../../contracts/fixtures/catalogue/restaurant_detail_certified.json';
import menuSingleItem from '../../../../../contracts/fixtures/catalogue/menu_single_item.json';
import cartSingleLine from '../../../../../contracts/fixtures/cart/cart_single_line.json';
import cartEmpty from '../../../../../contracts/fixtures/cart/cart_empty.json';

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

// See LoginGate.test.tsx / DiscoveryScreen.test.tsx: one persistent spy, installed before the
// screen's first import, so the api client's already-captured reference never goes stale.
const fetchSpy = jest.spyOn(globalThis, 'fetch');

afterAll(() => {
  fetchSpy.mockRestore();
});

// Loaded at module scope, right after the spy (so the api client captures it), and NOT inside
// the test body: the first require transforms the screen's whole module graph — this app,
// @hg/ui-native's TypeScript source, react-native, react-native-svg — which on a cold jest
// transform cache (every CI run) takes several seconds. Inside the test that cost was charged
// against the 5 s test timeout and made the suite time out on CI; file evaluation has none.
const { RestaurantScreen } = require('../RestaurantScreen') as typeof import('../RestaurantScreen');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');
const stack = require('../../navigation/stack') as typeof import('../../navigation/stack');
const { cartBarLabel } = require('../../navigation/TabBar') as typeof import('../../navigation/TabBar');

function renderRestaurant(push: (route: unknown) => void) {
  const restaurantId = restaurantDetail.payload.id;

  // `useNavigation` requires a `NavigationProvider` in the tree; substitute its context value
  // directly so `nav.push` can be observed without pulling in the whole Router.
  jest.spyOn(stack, 'useNavigation').mockReturnValue({
    current: { name: 'restaurant', restaurantId },
    canGoBack: true,
    push,
    replace: jest.fn(),
    back: jest.fn(),
    popTo: jest.fn(),
    reset: jest.fn(),
  });

  return render(
    <ThemeProvider theme="customer" scheme="light">
      <RestaurantScreen restaurantId={restaurantId} />
    </ThemeProvider>,
  );
}

describe('RestaurantScreen — add to cart surfaces the View cart bar', () => {
  it('opens the dish, adds it, then shows the bar from the server cart with the toast above it', async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/menu')) return stubOk({ data: menuSingleItem.payload });
      if (url.endsWith('/v1/cart')) return stubOk({ data: cartEmpty.payload });
      if (url.includes('/cart/lines')) return stubOk({ data: cartSingleLine.payload });
      if (url.includes('/v1/addresses')) return stubOk({ data: [] });
      if (url.includes('/restaurants/')) return stubOk({ data: restaurantDetail.payload });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const push = jest.fn();
    renderRestaurant(push);

    // Before adding: no sticky cart bar. Tapping the dish opens its sheet.
    fireEvent.press(await screen.findByText('Chicken Biryani'));
    expect(screen.queryByTestId('Restaurant-cartBar')).toBeNull();

    fireEvent.press(await screen.findByTestId('ItemSheet-add'));

    // After the server-recomputed cart comes back: the bar shows its count and subtotal.
    const label = cartBarLabel(cartSingleLine.payload as never)!;
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
    expect(screen.getByText('Added to your cart')).toBeTruthy();
    // The toast host sits above the bar (02-components.md §32) and never takes its taps.
    expect(screen.getByTestId('Restaurant-toastHost').props.pointerEvents).toBe('box-none');

    fireEvent.press(screen.getByText(label));
    expect(push).toHaveBeenCalledWith({ name: 'cart' });
  });
});
