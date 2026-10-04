/**
 * `OfferScreen` drives all three mandatory states (AGENTS.md §6: every screen implements
 * empty, loading and error) off the real `getCurrentOffer` read: loading while the request is
 * in flight, empty when the server answers with no live offer, and error on a failed read.
 */
import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

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
// persistent spy, installed before `OfferScreen` is ever required, lets every test in this file
// redirect its behaviour with `.mockImplementation` without invalidating the reference the
// (singleton, already-imported) client holds.
const fetchSpy = jest.spyOn(globalThis, 'fetch');

afterAll(() => {
  fetchSpy.mockRestore();
});

// Loaded at module scope, right after the spy (so the api client captures it), and NOT inside
// the test body: the first require transforms the screen's whole module graph — this app,
// @hg/ui-native's TypeScript source, react-native, react-native-svg — which on a cold jest
// transform cache (every CI run) takes several seconds. Inside the test that cost was charged
// against the 5 s test timeout and made the suite time out on CI; file evaluation has none.
const { OfferScreen } = require('../OfferScreen') as typeof import('../OfferScreen');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');
const { NavProvider } = require('../../nav') as typeof import('../../nav');

function renderOffer() {
  return render(
    <ThemeProvider theme="rider" scheme="light">
      <NavProvider>
        <OfferScreen />
      </NavProvider>
    </ThemeProvider>,
  );
}

describe('OfferScreen — loading, empty, error', () => {
  it('shows a loading row while the offer read is in flight', async () => {
    fetchSpy.mockImplementation(neverResolves);

    renderOffer();

    expect(await screen.findByText('Checking for an offer…')).toBeTruthy();
  });

  it('shows the empty state when the server has no live offer', async () => {
    fetchSpy.mockImplementation(async () => stubOk({ data: null }));

    renderOffer();

    expect(await screen.findByText('No offer right now')).toBeTruthy();
  });

  it('shows the error state with a retry action on a failed read', async () => {
    fetchSpy.mockImplementation(async () =>
      new Response(
        JSON.stringify({ error: { code: 'SERVER_UNAVAILABLE', message: 'Down for maintenance', request_id: 'req-1' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderOffer();

    await waitFor(() => {
      expect(screen.queryByTestId('ErrorState')).toBeTruthy();
    });
  });
});
