/**
 * The OTP auth gate. Deny-by-default means the protected work-loop tree (Availability → Offer
 * → Assignment) must be unreachable until a session exists — this pins that the app renders
 * only the phone-entry form pre-auth, and that a successful `requestOtp` → `verifyOtp` round
 * trip opens the gate.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { setToken, isAuthed } from '../../token';

jest.mock('expo-image-picker', () => {
  // The gate renders the whole <App />, which transitively imports capture.ts and with it
  // expo-image-picker. Loading the real module needs expo-modules-core's native
  // EventEmitter, which the react-native preset never registers, so the import threw
  // "Cannot read properties of undefined (reading 'EventEmitter')" and both tests here
  // failed before rendering anything — the sign-in gate had no working test at all.
  // The gate never opens the camera; a factory mock keeps the real module unloaded.
  const denied = { granted: false, status: 'denied', canAskAgain: true, expires: 'never' };
  return {
    MediaTypeOptions: { Images: 'Images' },
    launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
    launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
    requestCameraPermissionsAsync: jest.fn(async () => denied),
    requestMediaLibraryPermissionsAsync: jest.fn(async () => denied),
  };
});

jest.mock('expo-camera', () => {
  // Same failure class as expo-image-picker above: the seal scanner imports expo-camera,
  // whose native EventEmitter is absent under the react-native preset. Unauthenticated,
  // the gate never reaches the scanner.
  const React = require('react');
  return {
    CameraView: () => React.createElement('CameraView'),
    useCameraPermissions: () => [{ granted: false, canAskAgain: true, status: 'denied' }, jest.fn()],
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied' })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied' })),
  getCurrentPositionAsync: jest.fn(async () => { throw new Error('no location in tests'); }),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
}));

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
// exactly once across this file's tests). One persistent spy, installed before that first
// import and never torn down mid-file, keeps the same spy function identity for the whole
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

describe('rider OTP login gate', () => {
  it('blocks the protected work loop and shows only the phone form pre-auth', () => {
    expect(isAuthed()).toBe(false);

    const App = require('../../../App').default;
    render(<App />);

    expect(screen.getByText('Rider sign in')).toBeTruthy();
    expect(screen.getByPlaceholderText('+1 416 555 0100')).toBeTruthy();

    // Deny by default: none of the protected work-loop screens are present.
    expect(screen.queryByText('Available for deliveries')).toBeNull();
  });

  it('opens the app once the OTP is requested and verified', async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/auth/otp/request')) {
        return stubOk({ data: { challenge_id: 'chal-123', expires_at: '2026-08-15T00:05:00Z' } });
      }
      if (url.includes('/auth/otp/verify')) {
        return stubOk({ data: { access_token: 'rider-token-abc', token_type: 'Bearer' } });
      }
      // Whatever the rider home screen fetches once authed — a benign empty body is fine,
      // this test only cares that the gate opened.
      return stubOk({ data: {} });
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
