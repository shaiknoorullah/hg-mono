/**
 * R03 opening and terminal routes, light and dark: the splash phases, the three terminal screens
 * with and without support, and the whole way through the gate — signed out → phone → code →
 * splash → the screen `next_route` names.
 */
import * as React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});
jest.mock('../../../push', () => ({ registerForPush: jest.fn(async () => {}), unregisterForPush: jest.fn() }));

import { getToken, setToken } from '../../../token';
import { ThemeProvider } from '../../ds';
import { resetConnectivity } from '../../data/connectivity';
import { clearScreens, registerScreen } from '../../nav/registry';
import { SessionGate } from '../../session/Session';
import { mockApi, type MockApi } from '../../test/mockApi';
import { renderRedesign, SCHEMES } from '../../test/render';
import { SplashScreen } from '../SplashScreen';
import { TerminalScreen } from '../TerminalScreen';
import { SignInScreen } from '../SignInScreen';
import { accountNotActive, riderMe, supportOff } from './fixtures';

let api: MockApi;

beforeEach(() => resetConnectivity());
afterEach(() => {
  api?.restore();
  act(() => setToken(null));
});

describe.each(SCHEMES)('splash (%s)', (scheme) => {
  const show = (phase: 'loading' | 'slow' | 'error', retry = jest.fn()) => {
    renderRedesign(<SplashScreen params={{ phase, retry }} />, { scheme });
    return retry;
  };

  it('loading: getting your account ready, no buttons', () => {
    api = mockApi();
    show('loading');
    expect(screen.getByText('Getting your account ready.')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('slow: taking longer than usual, Try again re-reads, Sign out', () => {
    api = mockApi();
    const retry = show('slow');
    expect(screen.getByText('This is taking longer than usual')).toBeTruthy();
    expect(screen.getByText('We are still trying. Check your signal, or try again now.')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('error: could not open the account, with Call support', async () => {
    api = mockApi();
    show('error');
    expect(screen.getByText("We couldn't open your account")).toBeTruthy();
    expect(screen.getByText('You are still signed in. Check your connection and try again.')).toBeTruthy();
    expect(await screen.findByText('Call support')).toBeTruthy();
  });

  it('error with support off: says support is not available', async () => {
    api = mockApi({ getPublicConfig: supportOff() });
    show('error');
    expect(await screen.findByText("Support isn't available right now.")).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('Sign out revokes the session and signs out', async () => {
    api = mockApi();
    act(() => setToken('t', 'r'));
    show('error');
    fireEvent.press(screen.getByText('Sign out'));
    expect(getToken()).toBeNull();
    await waitFor(() => expect(api.callsTo('logout')).toHaveLength(1));
    expect(api.callsTo('logout')[0]!.headers.authorization).toBe('Bearer t');
  });
});

describe.each(SCHEMES)('terminal routes (%s)', (scheme) => {
  const show = (kind: 'update' | 'wrong-role' | 'closed') => renderRedesign(<TerminalScreen params={{ kind }} />, { scheme });

  it('update: update the app, Open the app store', () => {
    api = mockApi();
    show('update');
    expect(screen.getByText('Update the app to continue')).toBeTruthy();
    expect(
      screen.getByText('This version of the HalalGoes rider app is out of date. Update it from your app store, then open it again.'),
    ).toBeTruthy();
    expect(screen.getByText('Open the app store')).toBeTruthy();
  });

  it('wrong role: call support, with the hours from PublicConfig', async () => {
    api = mockApi();
    show('wrong-role');
    expect(screen.getByText('Something is wrong with your account setup')).toBeTruthy();
    expect(await screen.findByText("Updating the app won't fix this. Call support and we'll sort it out.")).toBeTruthy();
    expect(screen.getByText('Call support')).toBeTruthy();
    expect(screen.getByText('Support is open Support Hours.')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('wrong role, support off', async () => {
    api = mockApi({ getPublicConfig: supportOff() });
    show('wrong-role');
    expect(await screen.findByText("Support isn't available right now. Try again later.")).toBeTruthy();
    expect(screen.getByText("Updating the app won't fix this.")).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('closed: Back to sign in signs out', async () => {
    api = mockApi();
    act(() => setToken('t', 'r'));
    show('closed');
    expect(screen.getByText('This rider account is closed')).toBeTruthy();
    expect(await screen.findByText(/If you think this is a mistake, call our support team\./)).toBeTruthy();
    fireEvent.press(screen.getByText('Back to sign in'));
    expect(getToken()).toBeNull();
  });

  it('closed, support off', async () => {
    api = mockApi({ getPublicConfig: supportOff() });
    show('closed');
    expect(await screen.findByText("Support isn't available right now. Try again later.")).toBeTruthy();
    expect(screen.getByText("You can no longer sign in with this number. Money you've already earned is still paid out.")).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
  });
});

describe('through the gate', () => {
  beforeEach(() => {
    clearScreens();
    registerScreen('signIn', { component: SignInScreen });
    registerScreen('splash', { component: SplashScreen });
    registerScreen('terminal', { component: TerminalScreen });
    registerScreen('home', { component: () => <Text>Home probe</Text> });
  });

  const gate = () =>
    render(
      <ThemeProvider theme="rider" scheme="dark">
        <SessionGate />
      </ThemeProvider>,
    );

  it('cold start: phone, code 000000, then Home', async () => {
    api = mockApi({
      verifyOtp: 'session_next_route_home',
      getRiderMe: riderMe({ next_route: 'HOME', account_status: 'ACTIVE', active_assignment_id: null }),
    });
    gate();
    fireEvent.changeText(screen.getByTestId('phone-field'), '5550100151');
    fireEvent.press(screen.getByTestId('send-code'));
    await screen.findByText('Enter your code');
    fireEvent.changeText(screen.getByTestId('code-field'), '000000');
    expect(await screen.findByText('Home probe')).toBeTruthy();
    expect(getToken()).toBe('Access Token');
    expect(api.callsTo('requestOtp')[0]!.body).toEqual({ phone_e164: '+15550100151', purpose: 'SIGN_IN' });
  });

  it.each([
    ['APP_UPDATE_REQUIRED', 'Update the app to continue'],
    ['SOMETHING_NEW', 'Update the app to continue'],
    ['PROFILE_CAPTURE', 'Something is wrong with your account setup'],
    ['ORDER_TRACKING', 'Something is wrong with your account setup'],
    ['HOME', 'Home probe'],
  ])('signed in, next_route %s shows "%s"', async (route, text) => {
    api = mockApi({ getRiderMe: riderMe({ next_route: route, account_status: 'ACTIVE', active_assignment_id: null }) });
    act(() => setToken('t', 'r'));
    gate();
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('DEACTIVATED with no delivery, or 403 ACCOUNT_NOT_ACTIVE: the account is closed', async () => {
    api = mockApi({ getRiderMe: riderMe({ account_status: 'DEACTIVATED', active_assignment_id: null }) });
    act(() => setToken('t', 'r'));
    gate();
    expect(await screen.findByText('This rider account is closed')).toBeTruthy();
    api.restore();

    act(() => setToken(null));
    api = mockApi({ getRiderMe: accountNotActive() });
    act(() => setToken('t', 'r'));
    expect(await screen.findByText('This rider account is closed')).toBeTruthy();
  });

  it('getRiderMe fails: the splash error; Try again re-reads it', async () => {
    api = mockApi({ getRiderMe: (_c, nth) => (nth === 0 ? 'offline' : riderMe({ next_route: 'HOME', account_status: 'ACTIVE' })) });
    act(() => setToken('t', 'r'));
    gate();
    expect(await screen.findByText("We couldn't open your account")).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Home probe')).toBeTruthy();
  });
});
