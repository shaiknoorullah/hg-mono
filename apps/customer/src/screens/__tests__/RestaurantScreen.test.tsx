/**
 * The critical customer-side interaction: adding a menu item surfaces the sticky "View cart"
 * bar with the live item count and, on press, hands off to the cart route. Nothing about price
 * is computed here (G-3) — the bar's count comes straight off the server-recomputed `Cart`
 * `addToCart` returns, never a local increment.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import restaurantDetail from '../../../../../contracts/fixtures/catalogue/restaurant_detail_certified.json';
import menuSingleItem from '../../../../../contracts/fixtures/catalogue/menu_single_item.json';
import cartSingleLine from '../../../../../contracts/fixtures/cart/cart_single_line.json';
import cartEmpty from '../../../../../contracts/fixtures/cart/cart_empty.json';
import presignedDownload from '../../../../../contracts/fixtures/documents/presigned_download.json';

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
  it('has no View cart bar before anything is added, then shows it with the live count after adding', async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/menu')) return stubOk({ data: menuSingleItem.payload });
      if (url.endsWith('/v1/cart')) return stubOk({ data: cartEmpty.payload });
      if (url.includes('/cart/lines')) return stubOk({ data: cartSingleLine.payload });
      if (url.includes('/restaurants/')) return stubOk({ data: restaurantDetail.payload });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const push = jest.fn();
    renderRestaurant(push);

    // The dish renders once the menu resolves.
    await screen.findByText('Chicken Biryani');

    // Before adding: no sticky cart bar.
    expect(screen.queryByText(/View cart/)).toBeNull();

    fireEvent.press(screen.getByLabelText('Add Chicken Biryani'));

    // After the server-recomputed cart comes back: the bar appears with its count.
    await waitFor(() => {
      expect(screen.getByText('View cart · 1 item')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('View cart · 1 item'));
    expect(push).toHaveBeenCalledWith({ name: 'cart' });
  });
});

/**
 * The product's single claim is that a halal certification can be checked. The panel only
 * renders "View certificate" when handed a handler, and this screen used to hand it none,
 * so the certificate was unreachable from anywhere in the app.
 */
describe('RestaurantScreen — the certificate can be viewed', () => {
  function routeFetch(certificate: () => Response) {
    const calls: string[] = [];
    fetchSpy.mockImplementation(async (input, init) => {
      const req = input instanceof Request ? input : null;
      const url = req ? req.url : String(input);
      const method = req ? req.method : (init?.method ?? 'GET');
      // Before the /restaurants/ catch-all, which would otherwise swallow it.
      if (url.endsWith('/certificate-url')) {
        calls.push(method);
        return certificate();
      }
      if (url.includes('/menu')) return stubOk({ data: menuSingleItem.payload });
      if (url.endsWith('/v1/cart')) return stubOk({ data: cartEmpty.payload });
      if (url.includes('/restaurants/')) return stubOk({ data: restaurantDetail.payload });
      throw new Error(`unexpected fetch: ${url}`);
    });
    return calls;
  }

  it('mints a per-request URL and opens it', async () => {
    const { Linking } = require('react-native');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const calls = routeFetch(() => stubOk({ data: presignedDownload.payload }));

    renderRestaurant(jest.fn());
    fireEvent.press(await screen.findByText('View certificate'));

    await waitFor(() => expect(openURL).toHaveBeenCalledWith(presignedDownload.payload.url));
    // Minted on demand, never pre-fetched: the URL is single-use and short-lived.
    expect(calls).toEqual(['POST']);
    openURL.mockRestore();
  });

  it('says plainly when the certificate cannot be opened, without implying anything about halal status', async () => {
    const { Linking } = require('react-native');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    routeFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    renderRestaurant(jest.fn());
    fireEvent.press(await screen.findByText('View certificate'));

    expect(await screen.findByText("This restaurant's certificate isn't available to view right now.")).toBeTruthy();
    expect(openURL).not.toHaveBeenCalled();
    // The certification panel itself is untouched by a failed view.
    expect(screen.getByText('View certificate')).toBeTruthy();
    openURL.mockRestore();
  });
});
