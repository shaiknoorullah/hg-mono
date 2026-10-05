/**
 * The sign-in gate and first run. Pins: deny by default (nothing protected renders before a
 * session), the server's `next_route` decides where a customer lands, a new customer with no name
 * is asked for it before anything else, and the code step's errors say what happened.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { setToken, isAuthed } from '../../api/token';
import { resetSessionForTests } from '../../signin/session';

jest.mock('react-native-safe-area-context', () => {
  // The package's own jest mock is a TS `export default {...}`; babel-jest compiles that to
  // `{ default: {...} }`, but this app's named imports (`{ SafeAreaProvider }`) read the
  // properties off the top level. Unwrap `.default` so the named exports resolve.
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

function stub(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CHALLENGE = {
  data: {
    challenge_id: '3d3a26c7-69c3-4bda-ac5a-e3429473e07a',
    resend_after_s: 60,
    expires_at: '2026-08-15T00:05:00Z',
  },
};

function grant(nextRoute: string) {
  return {
    data: {
      access_token: 'customer-token-abc',
      refresh_token: 'rt',
      expires_in: 900,
      is_new_account: nextRoute === 'PROFILE_CAPTURE',
      principal: {
        account_id: '9b3a7e59-ebd8-42b2-a340-ab5ac6ead724',
        roles: [{ role: 'CUSTOMER', scope_type: 'GLOBAL', scope_id: null }],
        amr: 'otp',
        status: 'ACTIVE',
        next_route: nextRoute,
      },
    },
  };
}

function profile(firstName: string) {
  return {
    data: {
      account_id: '9b3a7e59-ebd8-42b2-a340-ab5ac6ead724',
      first_name: firstName,
      last_name: null,
      email: null,
      email_verified: false,
      phone_e164: '+14165550134',
      default_address_id: null,
      marketing_consent_at: null,
      created_at: '2026-08-15T00:00:00Z',
    },
  };
}

// The api client reads `globalThis.fetch` once, at module-construction time. `jest.spyOn` here —
// installed before the first import of App and never torn down mid-file — keeps the same spy
// identity for the whole suite, so each test redirects it with `.mockImplementation`.
const fetchSpy = jest.spyOn(globalThis, 'fetch');

/** Route the stubbed API by path; anything unlisted answers an empty list. */
function api(routes: Record<string, () => Response>): void {
  fetchSpy.mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    for (const [path, respond] of Object.entries(routes)) {
      if (url.includes(path)) return respond();
    }
    return stub({ data: [], meta: { next_cursor: null, has_more: false, total: 0 } });
  });
}

beforeEach(() => {
  api({});
});

afterEach(() => {
  setToken(null);
  resetSessionForTests();
});

afterAll(() => {
  fetchSpy.mockRestore();
});

// Required once at module scope, after the spy (so the api client captures it), not inside a
// test: the first require transforms the whole app graph, which on a cold jest cache (every CI
// run) takes seconds and would otherwise count against the test's timeout.
const App = (require('../../../App') as typeof import('../../../App')).default;

async function signIn(): Promise<void> {
  render(<App />);
  fireEvent.changeText(screen.getByTestId('SignIn-phone-field'), '4165550134');
  fireEvent.press(screen.getByText('Send code'));
  await screen.findByText('Enter the 6-digit code');
  fireEvent.changeText(screen.getByTestId('Code-input-field'), '482915');
  fireEvent.press(screen.getByText('Verify and continue'));
}

describe('customer sign-in', () => {
  it('blocks the protected app tree and shows only sign-in pre-auth', () => {
    expect(isAuthed()).toBe(false);

    render(<App />);

    expect(screen.getByText('Sign in or create an account')).toBeTruthy();
    expect(screen.getByTestId('SignIn-phone-field')).toBeTruthy();
    // Deny by default: none of the protected tab bar is present.
    expect(screen.queryByText('Discover')).toBeNull();
    expect(screen.queryByTestId('CustomerTabBar')).toBeNull();
  });

  it('says what is wrong with an incomplete number instead of sending it', () => {
    render(<App />);
    fireEvent.changeText(screen.getByTestId('SignIn-phone-field'), '41655501');
    fireEvent.press(screen.getByText('Send code'));
    expect(
      screen.getByText(/Enter all 10 digits of your mobile number, like 416 555 0134\./),
    ).toBeTruthy();
    const urls = fetchSpy.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
    expect(urls.some((u) => u.includes('/auth/otp/request'))).toBe(false);
  });

  it('shows the wrong-code message with the tries left, and keeps the customer signed out', async () => {
    api({
      '/auth/otp/request': () => stub(CHALLENGE),
      '/auth/otp/verify': () =>
        stub(
          {
            error: {
              code: 'OTP_INCORRECT',
              message: 'That code is incorrect.',
              request_id: '01J00000000000000000000000',
              details: { attempts_remaining: 2 },
            },
          },
          400,
        ),
    });

    await signIn();

    expect(await screen.findByText(/That code isn't right\. You have 2 tries left\./)).toBeTruthy();
    expect(isAuthed()).toBe(false);
  });

  it('routes a new account (next_route PROFILE_CAPTURE) to the name step before anything else', async () => {
    api({
      '/auth/otp/request': () => stub(CHALLENGE),
      '/auth/otp/verify': () => stub(grant('PROFILE_CAPTURE')),
    });

    await signIn();

    expect(await screen.findByText('Your details')).toBeTruthy();
    expect(screen.getByText('Tell us what to call you. Only your first name is needed to order.')).toBeTruthy();
    expect(isAuthed()).toBe(true);
    expect(screen.queryByTestId('CustomerTabBar')).toBeNull();
  });

  it('asks for the name even when the route is HOME but the profile has no first name', async () => {
    api({
      '/auth/otp/request': () => stub(CHALLENGE),
      '/auth/otp/verify': () => stub(grant('HOME')),
      '/me/profile': () => stub(profile('')),
    });

    await signIn();

    expect(await screen.findByText('Your details')).toBeTruthy();
    expect(screen.queryByTestId('CustomerTabBar')).toBeNull();
  });

  it('after the name, a customer with no address is led to add one', async () => {
    api({
      '/auth/otp/request': () => stub(CHALLENGE),
      '/auth/otp/verify': () => stub(grant('PROFILE_CAPTURE')),
      '/me/profile': () => stub(profile('Aisha')),
    });

    await signIn();
    await screen.findByText('Your details');
    fireEvent.changeText(screen.getByTestId('Profile-first-field'), 'Aisha');
    fireEvent.press(screen.getByText('Save and continue'));

    expect(await screen.findByText('Where should we deliver?')).toBeTruthy();
    fireEvent.press(screen.getByText('Add your address'));
    expect(await screen.findByText('Add address')).toBeTruthy();
  });
});
