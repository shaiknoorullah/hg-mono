/**
 * S1 Sign in and S6 Signed out (boards `SI/Main`, `SI/SignIn-*`, `SI/Main-signedout`,
 * `SI/Main-notyou`): every state renders from the contract's fixtures, or from an inline answer
 * shaped by `contracts/openapi.yaml` where no fixture exists yet.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { setToken } from '../../../api/token';
import { api } from '../../api/client';
import { isLogoutPending, resetAuthForTests, signOut } from '../../api/auth';
import { resetPublicConfigCache } from '../../api/config';
import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { clearForced, getForced } from '../../session/forced';
import { resetSessionForTests } from '../../session/session';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { renderRedesign } from '../../test/render';
import { SignInScreen } from '../SignInScreen';

const AT = Date.parse('2026-10-09T22:43:01Z');
const SERVER_DATE = new Date(AT).toUTCString();
const CONFIG = payloadOf('public_config');

let mock: MockApi;

beforeEach(() => {
  setNowOverride({ at: AT });
  resetConnectivity();
  resetPublicConfigCache();
  resetAuthForTests();
  clearForced();
  mock = mockApi();
});

afterEach(() => {
  mock.restore();
  setNowOverride(null);
  act(() => setToken(null));
  resetSessionForTests();
});

function typePhone(value: string): void {
  fireEvent.changeText(screen.getByTestId('SignIn-phone-field'), value);
}

function isDisabled(testID: string): boolean {
  return Boolean(screen.getByTestId(testID).props.accessibilityState?.disabled);
}

describe('S1 Sign in', () => {
  it('opens on the heading with the number field and Send code, and nothing protected', () => {
    renderRedesign(<SignInScreen />);
    expect(screen.getByText('Sign in or create an account')).toBeTruthy();
    expect(
      screen.getByText(
        "Enter your mobile number and we'll send a 6-digit code. New to HalalGoes? The same code creates your account.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Canadian mobile numbers only.')).toBeTruthy();
    expect(screen.getByText('Send code')).toBeTruthy();
    expect(screen.getByText('The code comes by WhatsApp or text message. Standard message rates may apply.')).toBeTruthy();
    expect(screen.getByText('By signing in you agree to our Terms of use and Privacy policy.')).toBeTruthy();
    expect(screen.queryByTestId('RedesignBottomNav')).toBeNull();
  });

  it('renders in dark', () => {
    renderRedesign(<SignInScreen />, { scheme: 'dark' });
    expect(screen.getByText('Sign in or create an account')).toBeTruthy();
  });

  it('says what is wrong with an incomplete number instead of sending it (Send code stays enabled)', () => {
    renderRedesign(<SignInScreen />);
    typePhone('41655501');
    expect(isDisabled('SignIn-send')).toBe(false);
    fireEvent.press(screen.getByText('Send code'));
    expect(screen.getByText(/Enter all 10 digits of your mobile number, like 416 555 0134\./)).toBeTruthy();
    expect(mock.callsTo('requestOtp')).toHaveLength(0);
  });

  it('a failed Send code says the error out loud (focus cannot move into the DS Input yet)', () => {
    const { AccessibilityInfo } = require('react-native');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    renderRedesign(<SignInScreen />);
    typePhone('41655501');
    fireEvent.press(screen.getByText('Send code'));
    expect(announce).toHaveBeenCalledWith('Enter all 10 digits of your mobile number, like 416 555 0134.');
    announce.mockRestore();
  });

  it('refuses a pasted non-Canadian number', () => {
    renderRedesign(<SignInScreen />);
    typePhone('+44 7700 900123');
    fireEvent.press(screen.getByText('Send code'));
    expect(screen.getByText(/HalalGoes works with Canadian mobile numbers \(\+1\) only for now\./)).toBeTruthy();
    expect(mock.callsTo('requestOtp')).toHaveLength(0);
  });

  it('shows Sending code while the request is out', async () => {
    mock.answer('requestOtp', 'hang');
    renderRedesign(<SignInScreen />);
    typePhone('4165550134');
    fireEvent.press(screen.getByText('Send code'));
    expect(await screen.findByText('Sending code')).toBeTruthy();
  });

  it('sends ids only and moves to the code step', async () => {
    mock.answer('requestOtp', 'otp_challenge');
    renderRedesign(<SignInScreen />);
    typePhone('4165550134');
    fireEvent.press(screen.getByText('Send code'));
    expect(await screen.findByText('Enter the 6-digit code')).toBeTruthy();
    expect(screen.getByText('We sent it to +1 416 555 0134.')).toBeTruthy();
    expect(mock.callsTo('requestOtp')[0]!.body).toEqual({ phone_e164: '+14165550134', purpose: 'SIGN_IN' });
  });

  it('429: a static time from Retry-After and the server Date, Send code disabled with the reason; then open again', async () => {
    mock.answer('requestOtp', { status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '299', Date: SERVER_DATE } });
    renderRedesign(<SignInScreen />);
    typePhone('4165550134');
    fireEvent.press(screen.getByText('Send code'));
    expect(await screen.findByText('Too many codes asked for')).toBeTruthy();
    expect(screen.getByText('For your security, wait before asking for another code.')).toBeTruthy();
    expect(screen.getByText('You can ask for a new code at 6:48 pm.')).toBeTruthy();
    expect(isDisabled('SignIn-send')).toBe(true);
    expect(screen.getByTestId('SignIn-send').props.accessibilityHint).toBe('You can ask for a new code at 6:48 pm.');

    act(() => setNowOverride({ at: Date.parse('2026-10-09T22:48:30Z') }));
    expect(screen.getByText('You can ask for a code again.')).toBeTruthy();
    expect(screen.queryByText('Too many codes asked for')).toBeNull();
    expect(isDisabled('SignIn-send')).toBe(false);
  });

  it('503 with the line open: Try again, Call support and the hours', async () => {
    mock.answer('requestOtp', { status: 503, code: 'RATE_LIMITER_UNAVAILABLE' });
    mock.answer('getPublicConfig', 'public_config');
    renderRedesign(<SignInScreen />);
    typePhone('4165550134');
    fireEvent.press(screen.getByText('Send code'));
    expect(await screen.findByText("We can't send codes right now")).toBeTruthy();
    expect(screen.getByText('The problem is on our side, not with your number. Try again in a few minutes.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(await screen.findByText('Call support')).toBeTruthy();
    expect(screen.getByText(`Support hours: ${CONFIG.support_hours}`)).toBeTruthy();
  });

  it('503 with the line closed: the hours as written, no Call support', async () => {
    mock.answer('requestOtp', { status: 503, code: 'RATE_LIMITER_UNAVAILABLE' });
    mock.answer('getPublicConfig', {
      status: 200,
      body: { data: { ...CONFIG, support_enabled: false, support_phone_e164: null, support_hours: '11:00 am to 11:00 pm' } },
    });
    renderRedesign(<SignInScreen />);
    typePhone('4165550134');
    fireEvent.press(screen.getByText('Send code'));
    expect(await screen.findByText("Our phone line is closed right now. It's open 11:00 am to 11:00 pm.")).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('503 with support off and no hours: no hours line, no Call support', async () => {
    mock.answer('requestOtp', { status: 503, code: 'RATE_LIMITER_UNAVAILABLE' });
    mock.answer('getPublicConfig', {
      status: 200,
      body: { data: { ...CONFIG, support_enabled: false, support_phone_e164: null, support_hours: null } },
    });
    renderRedesign(<SignInScreen />);
    typePhone('4165550134');
    fireEvent.press(screen.getByText('Send code'));
    expect(await screen.findByText("We can't send codes right now")).toBeTruthy();
    await waitFor(() => expect(mock.callsTo('getPublicConfig').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Our phone line is closed/)).toBeNull();
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('a 5xx send failure keeps the number and offers Try again', async () => {
    mock.answer('requestOtp', 'error_internal_error');
    renderRedesign(<SignInScreen />);
    typePhone('4165550134');
    fireEvent.press(screen.getByText('Send code'));
    expect(await screen.findByText("We couldn't send your code")).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    mock.answer('requestOtp', 'otp_challenge');
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Enter the 6-digit code')).toBeTruthy();
    expect(mock.callsTo('requestOtp')[1]!.body).toEqual({ phone_e164: '+14165550134', purpose: 'SIGN_IN' });
  });

  it('offline: says so and disables Send code with the reason, until the API answers again', async () => {
    mock.answer('requestOtp', 'offline');
    renderRedesign(<SignInScreen />);
    typePhone('4165550134');
    fireEvent.press(screen.getByText('Send code'));
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByText('Connect to Wi-Fi or mobile data to get your code.')).toBeTruthy();
    expect(isDisabled('SignIn-send')).toBe(true);
    await act(async () => {
      await api.GET('/v1/config/public').catch(() => {});
    });
    expect(screen.queryByText("You're offline")).toBeNull();
    expect(isDisabled('SignIn-send')).toBe(false);
  });

  it('opens Terms and privacy signed out, and Back returns to Sign in', async () => {
    renderRedesign(<SignInScreen />);
    fireEvent.press(screen.getByText('Terms and privacy'));
    expect(await screen.findByText(`Version ${CONFIG.terms_version}`)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Back to sign in'));
    expect(screen.getByText('Sign in or create an account')).toBeTruthy();
  });
});

describe('S6 Signed out', () => {
  it("after sign-out: You're signed out, addresses are saved", () => {
    act(() => {
      setToken('access', 'hgrt_x');
      signOut('signedOut');
    });
    renderRedesign(<SignInScreen />);
    expect(screen.getByText("You're signed out")).toBeTruthy();
    expect(screen.getByText(/Your addresses are saved to your account\. Sign in with your number to order again\./)).toBeTruthy();
    expect(screen.queryByText(/We'll finish signing this phone out/)).toBeNull();
  });

  it('signed out offline: says the server side finishes when back online, and retries then', async () => {
    mock.answer('logout', 'offline');
    act(() => {
      setToken('access', 'hgrt_x');
      signOut('signedOut');
    });
    renderRedesign(<SignInScreen />);
    expect(
      await screen.findByText(/We'll finish signing this phone out on our side when you're back online\./),
    ).toBeTruthy();
    mock.answer('logout', { status: 204, body: null });
    await act(async () => {
      await api.GET('/v1/config/public').catch(() => {});
    });
    await waitFor(() => expect(screen.queryByText(/We'll finish signing this phone out/)).toBeNull());
    expect(mock.callsTo('logout').length).toBe(2);
    expect(mock.callsTo('logout')[1]!.headers.authorization).toBe('Bearer access');
  });

  it('an expired access token: the kept refresh token gets a new one and the session is still revoked', async () => {
    const grant = payloadOf('session_grant_customer');
    mock.answer('logout', [{ status: 401, code: 'AUTHENTICATION_REQUIRED' }, { status: 204, body: null }]);
    mock.answer('refreshSession', { status: 200, body: { data: { ...grant, access_token: 'fresh', refresh_token: 'hgrt_y' } } });
    act(() => {
      setToken('stale', 'hgrt_x');
      signOut('signedOut');
    });
    await waitFor(() => expect(mock.callsTo('logout')).toHaveLength(2));
    expect(mock.callsTo('refreshSession')[0]!.body).toEqual({ refresh_token: 'hgrt_x' });
    expect(mock.callsTo('logout')[0]!.headers.authorization).toBe('Bearer stale');
    expect(mock.callsTo('logout')[1]!.headers.authorization).toBe('Bearer fresh');
    expect(isLogoutPending()).toBe(false);
    expect(getForced()).toBeNull();
  });

  it('a session the server already revoked: done, with no refresh and no forced route', async () => {
    mock.answer('logout', { status: 401, code: 'SESSION_REVOKED' });
    act(() => {
      setToken('access', 'hgrt_x');
      signOut('signedOut');
    });
    await waitFor(() => expect(mock.callsTo('logout')).toHaveLength(1));
    await act(async () => {});
    expect(mock.callsTo('refreshSession')).toHaveLength(0);
    expect(isLogoutPending()).toBe(false);
    expect(getForced()).toBeNull();
  });

  it('"Not you?": the right number to continue', () => {
    act(() => {
      setToken('access', 'hgrt_x');
      signOut('notYou');
    });
    renderRedesign(<SignInScreen />);
    expect(screen.getByText("You're signed out")).toBeTruthy();
    expect(screen.getByText('Enter the right mobile number to continue.')).toBeTruthy();
  });
});
