/**
 * The critical rider-side interaction: going online. D-10 — the server is the single source of
 * truth for availability; the Switch never flips locally, it PUTs `setRiderAvailability` and
 * renders exactly what comes back. This pins that toggling the switch from offline posts
 * `is_online: true`, and that the badge only reflects ONLINE_IDLE once the server's response
 * has actually arrived — never optimistically.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

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

// See LoginGate.test.tsx: the api client captures `fetch` at module-construction time. One
// persistent spy, installed before `AvailabilityScreen` is ever required, lets every test in
// this file redirect its behaviour with `.mockImplementation` without invalidating the
// reference the (singleton, already-imported) client holds.
const fetchSpy = jest.spyOn(globalThis, 'fetch');

afterAll(() => {
  fetchSpy.mockRestore();
});

function renderAvailability() {
  const { AvailabilityScreen } = require('../AvailabilityScreen');
  const { ThemeProvider } = require('@hg/ui-native');
  const { NavProvider } = require('../../nav');
  return render(
    <ThemeProvider theme="rider" scheme="light">
      <NavProvider>
        <AvailabilityScreen />
      </NavProvider>
    </ThemeProvider>,
  );
}

describe('AvailabilityScreen — go online', () => {
  it('starts offline, and toggling the switch PUTs is_online: true and renders the server state', async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/riders/me/dashboard')) {
        return stubOk({ data: { mode: 'OFFLINE', blocking_reasons: [] } });
      }
      throw new Error(`unexpected fetch before toggle: ${url}`);
    });

    renderAvailability();

    // The initial dashboard read establishes OFFLINE; the switch starts unchecked.
    await waitFor(() => {
      expect(screen.getByTestId('Switch').props.accessibilityState?.checked).toBe(false);
    });
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);

    let putBody: unknown = null;
    fetchSpy.mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/riders/me/availability')) {
        putBody = input instanceof Request ? await input.clone().json() : init?.body ? JSON.parse(String(init.body)) : null;
        return stubOk({
          data: {
            availability_state: 'ONLINE_IDLE',
            since: '2026-08-15T00:00:00Z',
            can_receive_offers: true,
            blocking_reasons: [],
          },
        });
      }
      throw new Error(`unexpected fetch after toggle: ${url}`);
    });

    fireEvent.press(screen.getByTestId('Switch'));

    // The server round trip actually happened, with the right request body — never a local flip.
    await waitFor(() => {
      expect(putBody).toEqual({ is_online: true });
    });

    // Only once the server answers does the authoritative badge flip to online.
    await waitFor(() => {
      expect(screen.getByText('Online — idle')).toBeTruthy();
    });
    expect(screen.getByTestId('Switch').props.accessibilityState?.checked).toBe(true);
  });
});
