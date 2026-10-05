/**
 * `DiscoveryScreen` — the customer app's one real GET (`listRestaurants`) — drives all three
 * mandatory states (`04-accessibility.md`/AGENTS.md §6: every screen implements empty, loading
 * and error). This pins each independently against the real fetch → render wiring, using the
 * contract's own populated fixture for the happy path.
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import restaurantList from '../../../../../contracts/fixtures/catalogue/restaurant_list_populated.json';

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

function neverResolves(): Promise<Response> {
  return new Promise(() => {});
}

// See LoginGate.test.tsx: the api client captures `fetch` at module-construction time. One
// persistent spy, installed before `DiscoveryScreen` is ever required, lets every test in this
// file redirect its behaviour with `.mockImplementation` without invalidating the reference
// the (singleton, already-imported) client holds.
const fetchSpy = jest.spyOn(globalThis, 'fetch');

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  fetchSpy.mockRestore();
});

// Loaded at module scope, right after the spy (so the api client captures it), and NOT inside
// the test body: the first require transforms the screen's whole module graph — this app,
// @hg/ui-native's TypeScript source, react-native, react-native-svg — which on a cold jest
// transform cache (every CI run) takes several seconds. Inside the test that cost was charged
// against the 5 s test timeout and made the suite time out on CI; file evaluation has none.
const { DiscoveryScreen } = require('../DiscoveryScreen') as typeof import('../DiscoveryScreen');
const { NavigationProvider } = require('../../navigation/stack') as typeof import('../../navigation/stack');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');

function renderDiscovery() {
  return render(
    <ThemeProvider theme="customer" scheme="light">
      <NavigationProvider initial={{ name: 'discovery' }}>
        {() => <DiscoveryScreen />}
      </NavigationProvider>
    </ThemeProvider>,
  );
}

describe('DiscoveryScreen — loading, empty, error', () => {
  it('shows loading skeletons while the fetch is in flight', async () => {
    // The fetch never resolves, so the skeletons' shimmer (an endless JS-driven `Animated.loop`)
    // is still running when the test ends. On real timers its next frame fired in the gap before
    // the library's auto-cleanup unmounted the screen, outside act(), and React logged one
    // "not wrapped in act(...)" warning per animated block (issue #136). On fake timers a frame
    // runs only when the test advances the clock, which this one never needs to, so the loop
    // stays still until cleanup stops it. Same approach as
    // packages/ui-native/src/primitives/__tests__/Toast.test.tsx.
    jest.useFakeTimers();
    fetchSpy.mockImplementation(neverResolves);

    renderDiscovery();

    expect(await screen.findByTestId('Discovery-loading')).toBeTruthy();
  });

  it('shows the empty state for zero restaurants', async () => {
    fetchSpy.mockImplementation(async () =>
      stubOk({ data: [], meta: { next_cursor: null, has_more: false, total: 0 } }),
    );

    renderDiscovery();

    expect(await screen.findByText('No restaurants listed yet')).toBeTruthy();
  });

  it('leads a customer with no address to add one, and still lists restaurants', async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/v1/addresses')) return stubOk({ data: [] });
      return stubOk({ data: restaurantList.payload, meta: restaurantList.meta });
    });

    renderDiscovery();

    expect(await screen.findByText('Set your delivery address')).toBeTruthy();
    expect(screen.getByText('Add an address')).toBeTruthy();
    expect(screen.getByText('Set an address')).toBeTruthy();
    expect(screen.getAllByText('Karachi Kitchen').length).toBeGreaterThan(0);
  });

  it('opens the address form from the prompt, and a restaurant from its card', async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/v1/addresses')) return stubOk({ data: [] });
      return stubOk({ data: restaurantList.payload, meta: restaurantList.meta });
    });
    const tree = (initial: Parameters<typeof NavigationProvider>[0]['initial']) => (
      <ThemeProvider theme="customer" scheme="light">
        <NavigationProvider initial={initial}>
          {(route) =>
            route.name === 'discovery' ? <DiscoveryScreen /> : <Text>{`route:${route.name}`}</Text>
          }
        </NavigationProvider>
      </ThemeProvider>
    );

    const first = render(tree({ name: 'discovery' }));
    fireEvent.press(await screen.findByTestId('Discovery-addAddress'));
    expect(screen.getByText('route:addressForm')).toBeTruthy();
    first.unmount();

    render(tree({ name: 'discovery' }));
    const id = (restaurantList.payload as Array<{ id: string }>)[0]!.id;
    fireEvent.press(await screen.findByTestId(`RestaurantCardCompact-${id}`));
    expect(screen.getByText('route:restaurant')).toBeTruthy();
  });

  it('shows the error state with a retry action on failure', async () => {
    fetchSpy.mockImplementation(async () =>
      new Response(
        JSON.stringify({ error: { code: 'SERVER_UNAVAILABLE', message: 'Down for maintenance', request_id: 'req-1' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderDiscovery();

    await waitFor(() => {
      expect(screen.queryByTestId('ErrorState')).toBeTruthy();
    });
  });

  it('renders real restaurant cards once the fetch resolves with data', async () => {
    fetchSpy.mockImplementation(async () =>
      stubOk({ data: restaurantList.payload, meta: restaurantList.meta }),
    );

    renderDiscovery();

    expect((await screen.findAllByText('Karachi Kitchen')).length).toBeGreaterThan(0);
  });
});
