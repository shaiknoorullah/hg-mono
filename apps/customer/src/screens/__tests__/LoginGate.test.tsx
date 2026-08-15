/**
 * The OTP auth gate. Discovery browse is anonymous per the contract, but this V0 build fires
 * the gate before anything else renders. Deny-by-default means the protected app tree (tab
 * bar, Discover) must be unreachable until a session exists — this pins that the app renders
 * only the phone-entry form pre-auth, and that a successful `requestOtp` → `verifyOtp` round
 * trip opens the gate.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { setToken, isAuthed } from '../../api/token';

jest.mock('react-native-safe-area-context', () => {
  // The package's own jest mock is a TS `export default {...}`; babel-jest compiles that to
  // `{ default: {...} }`, but this app's named imports (`{ SafeAreaProvider }`) read the
  // properties off the top level. Unwrap `.default` so the named exports resolve.
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

function stubOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// The api client reads `globalThis.fetch` once, at module-construction time (App is imported
// exactly once across this file's tests). `jest.spyOn` here — installed before that first
// import, and never torn down mid-file — keeps the *same* spy function identity for the whole
// suite, so later tests can redirect its behaviour with `.mockImplementation` without the
// client's already-captured reference going stale.
const fetchSpy = jest.spyOn(globalThis, 'fetch');

beforeEach(() => {
  fetchSpy.mockImplementation(async () => stubOk({}));
});

afterEach(() => {
  setToken(null);
});

afterAll(() => {
  fetchSpy.mockRestore();
});

describe('customer OTP login gate', () => {
  it('blocks the protected app tree and shows only the phone form pre-auth', () => {
    expect(isAuthed()).toBe(false);

    const App = require('../../../App').default;
    render(<App />);

    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.getByPlaceholderText('+1 416 555 0100')).toBeTruthy();

    // Deny by default: none of the protected tab bar is present.
    expect(screen.queryByText('Discover')).toBeNull();
    expect(screen.queryByTestId('CustomerTabBar')).toBeNull();
  });

  it('opens the app once the OTP is requested and verified', async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/auth/otp/request')) {
        return stubOk({ data: { challenge_id: 'chal-123', expires_at: '2026-08-15T00:05:00Z' } });
      }
      if (url.includes('/auth/otp/verify')) {
        return stubOk({ data: { access_token: 'customer-token-abc', token_type: 'Bearer' } });
      }
      // Whatever Discovery fetches once authed — an empty list is fine, this test only
      // cares that the gate opened.
      return stubOk({ data: [], meta: { next_cursor: null, has_more: false, total: 0 } });
    });

    const App = require('../../../App').default;
    render(<App />);

    fireEvent.changeText(screen.getByPlaceholderText('+1 416 555 0100'), '+14165550100');
    fireEvent.press(screen.getByText('Send code'));

    await screen.findByPlaceholderText('000000');
    fireEvent.changeText(screen.getByPlaceholderText('000000'), '123456');
    fireEvent.press(screen.getByText('Verify'));

    await waitFor(() => expect(isAuthed()).toBe(true));
  });
});
