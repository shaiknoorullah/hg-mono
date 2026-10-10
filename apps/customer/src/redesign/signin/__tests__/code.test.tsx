/**
 * S2 Code (boards `SI/SignInCode`, `SI/Code-*`) and the sign-in gate end to end through the Shell
 * (ported from #635's LoginGate test): deny by default, the server's `next_route` decides the
 * landing, and a new customer is asked for a name before anything else.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { isAuthed, setToken } from '../../../api/token';
import { resetAuthForTests } from '../../api/auth';
import { resetPublicConfigCache } from '../../api/config';
import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { useNav } from '../../navigation/context';
import { REDESIGNED } from '../../navigation/registry';
import { Shell } from '../../navigation/Shell';
import { clearForced, getForced } from '../../session/forced';
import { resetSessionForTests } from '../../session/session';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { renderRedesign } from '../../test/render';
import { SignInScreen } from '../SignInScreen';

const AT = Date.parse('2026-10-09T22:43:01Z');
const SERVER_DATE = new Date(AT).toUTCString();
const ORDER_ID = payloadOf('order_preparing').id as string;

function grant(nextRoute: string, status = 'ACTIVE'): MockAnswer {
  const base = payloadOf('session_grant_customer');
  return { status: 200, body: { data: { ...base, principal: { ...base.principal, next_route: nextRoute, status } } } };
}

// Tab screens other WPs own: probes, so these tests assert the hand-off, not Home.
function Probe({ label }: { label: string }): React.ReactElement {
  const nav = useNav();
  const { Pressable, Text } = require('react-native');
  return (
    <Pressable accessibilityRole="button" onPress={nav.back}>
      <Text>{label}</Text>
    </Pressable>
  );
}
const PROBES = ['home', 'search', 'orders', 'account', 'tracking'] as const;

let mock: MockApi;

beforeEach(() => {
  setNowOverride({ at: AT });
  resetConnectivity();
  resetPublicConfigCache();
  resetAuthForTests();
  clearForced();
  resetSessionForTests();
  mock = mockApi({
    requestOtp: { status: 200, body: { data: payloadOf('otp_challenge') }, headers: { Date: SERVER_DATE } },
    listOrders: 'order_list_active',
  });
  for (const name of PROBES) (REDESIGNED as Record<string, unknown>)[name] = () => <Probe label={`${name} screen`} />;
});

afterEach(() => {
  mock.restore();
  for (const name of PROBES) delete (REDESIGNED as Record<string, unknown>)[name];
  setNowOverride(null);
  clearForced();
  act(() => setToken(null));
  resetSessionForTests();
});

async function toCode(): Promise<void> {
  fireEvent.changeText(screen.getByTestId('SignIn-phone-field'), '4165550134');
  fireEvent.press(screen.getByText('Send code'));
  await screen.findByText('Enter the 6-digit code');
}

function typeCode(code: string): void {
  fireEvent.changeText(screen.getByTestId('Code-input-field'), code);
}

function isDisabled(testID: string): boolean {
  return Boolean(screen.getByTestId(testID).props.accessibilityState?.disabled);
}

describe('S2 Code', () => {
  it('says where the code went and when it can be resent (static time from resend_after_s and the server Date)', async () => {
    renderRedesign(<SignInScreen />);
    await toCode();
    expect(screen.getByText('Check WhatsApp and your text messages.')).toBeTruthy();
    expect(screen.getByText('Change number')).toBeTruthy();
    expect(screen.getByText('The code works for 5 minutes. We fill it in for you if your phone offers it.')).toBeTruthy();
    // 22:43:01 + 45 s, rounded up to the minute, in Toronto time.
    expect(screen.getByText('You can resend the code at 6:44 pm.')).toBeTruthy();
    expect(isDisabled('Code-resend')).toBe(true);
    act(() => setNowOverride({ at: Date.parse('2026-10-09T22:44:05Z') }));
    expect(isDisabled('Code-resend')).toBe(false);
    expect(screen.queryByText(/You can resend the code at/)).toBeNull();
  });

  it('renders in dark', async () => {
    renderRedesign(<SignInScreen />, { scheme: 'dark' });
    await toCode();
    expect(screen.getByText('Enter the 6-digit code')).toBeTruthy();
  });

  it('fewer than 6 digits: says so on Verify, sends nothing', async () => {
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('48291');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(screen.getByText(/Enter all 6 digits of the code\./)).toBeTruthy();
    expect(mock.callsTo('verifyOtp')).toHaveLength(0);
  });

  it('verifying: Checking code', async () => {
    mock.answer('verifyOtp', 'hang');
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(await screen.findByText('Checking code')).toBeTruthy();
    expect(mock.callsTo('verifyOtp')[0]!.body).toEqual({ challenge_id: payloadOf('otp_challenge').challenge_id, code: '482915' });
  });

  it('OTP_INCORRECT with tries left, and the customer stays signed out', async () => {
    mock.answer('verifyOtp', { status: 401, code: 'OTP_INCORRECT', details: { attempts_remaining: 2 } });
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(await screen.findByText(/That code isn't right\. You have 2 tries left\./)).toBeTruthy();
    expect(isAuthed()).toBe(false);
  });

  it('OTP_INCORRECT from the fixture (no attempts count): check it and try again', async () => {
    mock.answer('verifyOtp', 'error_otp_incorrect_no_count');
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(await screen.findByText(/That code isn't right\. Check it and try again\./)).toBeTruthy();
  });

  it('no tries left: Too many wrong codes, Start again returns to Sign in with the number filled', async () => {
    mock.answer('verifyOtp', { status: 401, code: 'OTP_INCORRECT', details: { attempts_remaining: 0 } });
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(await screen.findByText('Too many wrong codes')).toBeTruthy();
    expect(screen.queryByText('Verify and continue')).toBeNull();
    fireEvent.press(screen.getByText('Start again'));
    expect(screen.getByText('Sign in or create an account')).toBeTruthy();
    expect(screen.getByTestId('SignIn-phone-field').props.value).toContain('416');
  });

  it('expired code: Send the code again re-sends the same number, with the resent toast at the top', async () => {
    mock.answer('verifyOtp', { status: 400, code: 'OTP_INVALID_OR_EXPIRED' });
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(await screen.findByText(/This code has run out or was already used\. Send it again to get 5 more minutes\./)).toBeTruthy();
    fireEvent.press(screen.getByText('Send the code again'));
    expect(await screen.findByText('Code sent again')).toBeTruthy();
    expect(screen.getByText("It's the same code as before. It works for 5 minutes from now.")).toBeTruthy();
    expect(mock.callsTo('requestOtp')).toHaveLength(2);
    expect(screen.getByText('Verify and continue')).toBeTruthy();
  });

  it('expired with no resend left: This sign-in timed out, and Start again returns to the ready Sign in', async () => {
    mock.answer('verifyOtp', { status: 400, code: 'OTP_INVALID_OR_EXPIRED' });
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    await screen.findByText('Send the code again');
    mock.answer('requestOtp', { status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '299', Date: SERVER_DATE } });
    fireEvent.press(screen.getByText('Send the code again'));
    expect(await screen.findByText('This sign-in timed out')).toBeTruthy();
    expect(screen.getByText("Sign-in attempts last 15 minutes. Start again with your number and we'll send a fresh code.")).toBeTruthy();
    fireEvent.press(screen.getByText('Start again'));
    expect(screen.getByText('Sign in or create an account')).toBeTruthy();
    expect(screen.getByTestId('SignIn-phone-field').props.value).toContain('416');
    expect(screen.queryByText(/You can ask for a new code at/)).toBeNull();
    expect(screen.queryByText('Too many codes asked for')).toBeNull();
    expect(isDisabled('SignIn-send')).toBe(false);
  });

  it('the third send is the last: No more resends, no toast, no Resend, and no time the server did not give', async () => {
    renderRedesign(<SignInScreen />);
    await toCode();
    act(() => setNowOverride({ at: Date.parse('2026-10-09T22:44:05Z') }));
    fireEvent.press(screen.getByText('Resend code'));
    expect(await screen.findByText('Code sent again')).toBeTruthy();
    act(() => setNowOverride({ at: Date.parse('2026-10-09T22:46:05Z') }));
    fireEvent.press(screen.getByText('Resend code'));
    expect(await screen.findByText('No more resends for this sign-in')).toBeTruthy();
    expect(mock.callsTo('requestOtp')).toHaveLength(3);
    expect(screen.queryByText('Code sent again')).toBeNull();
    expect(screen.queryByText('Resend code')).toBeNull();
    expect(screen.queryByText(/You can ask for a fresh code after/)).toBeNull();
    expect(screen.getByText('Verify and continue')).toBeTruthy();
    expect(screen.getByText('Start again')).toBeTruthy();
  });

  it('a failed submit says its error out loud (focus cannot move into the DS Input yet)', async () => {
    const { AccessibilityInfo } = require('react-native');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('48291');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(announce).toHaveBeenCalledWith('Enter all 6 digits of the code.');
    announce.mockRestore();
  });

  it('resend limit: No more resends, with the time from Retry-After', async () => {
    renderRedesign(<SignInScreen />);
    await toCode();
    act(() => setNowOverride({ at: Date.parse('2026-10-09T22:44:05Z') }));
    mock.answer('requestOtp', { status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '835', Date: new Date(Date.parse('2026-10-09T22:44:05Z')).toUTCString() } });
    fireEvent.press(screen.getByText('Resend code'));
    expect(await screen.findByText('No more resends for this sign-in')).toBeTruthy();
    expect(screen.getByText(/You can ask for a fresh code after 6:58 pm\./)).toBeTruthy();
    expect(screen.getByText('Start again')).toBeTruthy();
  });

  it('resend refused on our side: We couldn’t send the code again', async () => {
    renderRedesign(<SignInScreen />);
    await toCode();
    act(() => setNowOverride({ at: Date.parse('2026-10-09T22:44:05Z') }));
    mock.answer('requestOtp', 'error_internal_error');
    fireEvent.press(screen.getByText('Resend code'));
    expect(await screen.findByText("We couldn't send the code again")).toBeTruthy();
  });

  it('verify failed on our side: the code stays, Try again, and resend opens', async () => {
    mock.answer('verifyOtp', 'error_internal_error');
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(await screen.findByText("We couldn't check your code")).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(isDisabled('Code-resend')).toBe(false);
  });

  it('verify 429: a static time, Verify disabled with the reason', async () => {
    mock.answer('verifyOtp', { status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '299', Date: SERVER_DATE } });
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(await screen.findByText('You can try the code again at 6:48 pm.')).toBeTruthy();
    expect(isDisabled('Code-verify')).toBe(true);
  });

  it('offline: says so, keeps what was typed, Verify and Resend wait for the connection', async () => {
    mock.answer('verifyOtp', 'offline');
    renderRedesign(<SignInScreen />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByText('Connect to Wi-Fi or mobile data to check your code. What you typed stays here.')).toBeTruthy();
    expect(isDisabled('Code-verify')).toBe(true);
    expect(isDisabled('Code-resend')).toBe(true);
    expect(screen.getByTestId('Code-input-field').props.value).toBe('482915');
  });

  it('Change number goes back with the number filled', async () => {
    renderRedesign(<SignInScreen />);
    await toCode();
    fireEvent.press(screen.getByText('Change number'));
    expect(screen.getByText('Sign in or create an account')).toBeTruthy();
    expect(screen.getByTestId('SignIn-phone-field').props.value).toContain('555');
  });
});

describe('the sign-in gate through the Shell (ported from #635 LoginGate)', () => {
  async function signInThroughShell(): Promise<void> {
    renderRedesign(<Shell />);
    await toCode();
    typeCode('482915');
    fireEvent.press(screen.getByText('Verify and continue'));
  }

  it('shows only sign-in before a session: no tabs', () => {
    renderRedesign(<Shell />);
    expect(screen.getByText('Sign in or create an account')).toBeTruthy();
    expect(screen.queryByTestId('RedesignBottomNav')).toBeNull();
  });

  it('HOME: Home with "You\'re signed in · Welcome back, Zainab."', async () => {
    mock.answer('verifyOtp', grant('HOME'));
    await signInThroughShell();
    expect(await screen.findByText('home screen')).toBeTruthy();
    expect(screen.getByText("You're signed in")).toBeTruthy();
    expect(screen.getByText(`Welcome back, ${payloadOf('customer_profile').first_name}.`)).toBeTruthy();
    expect(screen.getByTestId('RedesignBottomNav')).toBeTruthy();
    expect(isAuthed()).toBe(true);
  });

  it('ORDER_TRACKING: straight to the order, and Back goes to Home', async () => {
    mock.answer('verifyOtp', grant('ORDER_TRACKING'));
    mock.answer('getActiveOrder', 'order_preparing');
    await signInThroughShell();
    expect(await screen.findByText('tracking screen')).toBeTruthy();
    expect(screen.getByText("Here's the order you have on the way.")).toBeTruthy();
    fireEvent.press(screen.getByText('tracking screen'));
    expect(screen.getByText('home screen')).toBeTruthy();
    expect(ORDER_ID).toBeTruthy();
  });

  it('PROFILE_CAPTURE: Your details before anything else, no tabs', async () => {
    mock.answer('verifyOtp', grant('PROFILE_CAPTURE'));
    await signInThroughShell();
    expect(await screen.findByText('Tell us what to call you. Only your first name is needed to order.')).toBeTruthy();
    expect(screen.getByText('Your details')).toBeTruthy();
    expect(screen.queryByTestId('RedesignBottomNav')).toBeNull();
    expect(isAuthed()).toBe(true);
  });

  it('SUSPENDED × BANNED: the closed-account screen, signed out behind it', async () => {
    mock.answer('verifyOtp', grant('SUSPENDED', 'BANNED'));
    await signInThroughShell();
    expect(await screen.findByText("This account can't be used")).toBeTruthy();
    expect(getForced()).toEqual({ kind: 'banned' });
    expect(isAuthed()).toBe(false);
  });

  it('a route this build does not know: Update HalalGoes to keep ordering', async () => {
    mock.answer('verifyOtp', grant('ONBOARDING_VEHICLE'));
    await signInThroughShell();
    expect(await screen.findByText('Update HalalGoes to keep ordering')).toBeTruthy();
  });

  it('403 ACCOUNT_SUSPENDED from verifyOtp raises the on-hold screen from the API client', async () => {
    mock.answer('verifyOtp', { status: 403, code: 'ACCOUNT_SUSPENDED' });
    await signInThroughShell();
    expect(await screen.findByText('Your account is on hold')).toBeTruthy();
    await waitFor(() => expect(getForced()).toEqual({ kind: 'on-hold' }));
  });
});
