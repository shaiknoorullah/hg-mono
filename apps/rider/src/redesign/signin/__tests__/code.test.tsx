/**
 * R02 Enter your code: every state on the SO code boards, light and dark, against the contract
 * fixtures (requestOtp, verifyOtp). Each test reaches the code step the way a rider does: phone,
 * Send code.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});
jest.mock('../../../push', () => ({ registerForPush: jest.fn(async () => {}), unregisterForPush: jest.fn() }));

import { registerForPush } from '../../../push';
import { getRefreshToken, getToken, setToken } from '../../../token';
import { reportReachable, resetConnectivity } from '../../data/connectivity';
import { mockApi, type MockApi, type ScenarioChoice } from '../../test/mockApi';
import { renderRedesign, SCHEMES } from '../../test/render';
import { SignInScreen } from '../SignInScreen';
import { accountNotActive, challenge, hasPriceField, otpExpired, otpIncorrect, rateLimited } from './fixtures';

let api: MockApi;

beforeEach(() => resetConnectivity());
afterEach(() => {
  api?.restore();
  act(() => setToken(null));
  jest.clearAllMocks();
});

const typeCode = (code: string) => fireEvent.changeText(screen.getByTestId('code-field'), code);
const disabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState.disabled;

describe.each(SCHEMES)('code step (%s)', (scheme) => {
  async function toCode(choices: Record<string, ScenarioChoice> = {}) {
    api = mockApi({ requestOtp: 'otp_challenge', ...choices });
    renderRedesign(<SignInScreen params={{}} />, { scheme });
    fireEvent.changeText(screen.getByTestId('phone-field'), '4165550134');
    fireEvent.press(screen.getByTestId('send-code'));
    await screen.findByText('Enter your code');
  }

  it('entering: helper, resend countdown from resend_after_s, Verify off until 6 digits', async () => {
    await toCode({ verifyOtp: 'pending' });
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.getByText('We check the code as soon as all 6 digits are in.')).toBeTruthy();
    expect(screen.getByText(/You can ask for a new code in 4[45] s\./)).toBeTruthy();
    typeCode('48');
    expect(disabled('verify')).toBe(true);
    expect(screen.getByText('Use a different number')).toBeTruthy();
    expect(screen.getByText('Call support')).toBeTruthy();
    expect(api.callsTo('verifyOtp')).toHaveLength(0);
  });

  it('typed: the 6th digit checks the code and signs the rider in', async () => {
    await toCode({ verifyOtp: 'session_next_route_home' });
    typeCode('48291');
    typeCode('482913');
    await waitFor(() => expect(getToken()).toBe('Access Token'));
    expect(getRefreshToken()).toBe('Refresh Token');
    expect(registerForPush).toHaveBeenCalledTimes(1);
    const [call] = api.callsTo('verifyOtp');
    expect(call!.body).toEqual({ challenge_id: 'd7d4c0e1-5469-41e0-a991-a23dd706c596', code: '482913' });
    expect(call!.headers['x-hg-client']).toBe('rider-app');
    expect(hasPriceField(call!.body)).toBe(false);
  });

  it('pasted or autofilled: "Filled in from your messages", checking, Verify loading', async () => {
    await toCode({ verifyOtp: 'pending' });
    typeCode('482913');
    expect(await screen.findByText('Filled in from your messages.')).toBeTruthy();
    expect(screen.getByTestId('verify').props.accessibilityState.busy).toBe(true);
    expect(disabled('different-number')).toBe(true);
    expect(api.callsTo('verifyOtp')).toHaveLength(1);
  });

  it('OTP_INCORRECT: clears the field and says how many tries are left', async () => {
    await toCode({ verifyOtp: otpIncorrect(2) });
    typeCode('482913');
    expect(await screen.findByText(/That code is not right\. You have 2 tries left\./)).toBeTruthy();
    expect(screen.getByTestId('code-field').props.value).toBe('');
    expect(screen.getByText(/You can ask for a new code in/)).toBeTruthy();
  });

  it('OTP_INCORRECT with no count (error_otp_incorrect as is) says only that the code is wrong', async () => {
    await toCode({ verifyOtp: 'error_otp_incorrect' });
    typeCode('482913');
    expect(await screen.findByText(/That code is not right\.$/)).toBeTruthy();
  });

  it('tries used: the code no longer works; Send a new code asks again', async () => {
    await toCode({ verifyOtp: otpIncorrect(0) });
    typeCode('482913');
    expect(await screen.findByText('That code no longer works')).toBeTruthy();
    expect(screen.getByText("You've used every try for this code. Ask for a new one to keep going.")).toBeTruthy();
    expect(screen.queryByTestId('verify')).toBeNull();
    fireEvent.press(screen.getByText('Send a new code'));
    expect(await screen.findByTestId('verify')).toBeTruthy();
    expect(screen.queryByText('That code no longer works')).toBeNull();
    expect(api.callsTo('requestOtp')).toHaveLength(2);
  });

  it('expired: says codes last 5 minutes and offers a new one', async () => {
    await toCode({ verifyOtp: otpExpired() });
    typeCode('482913');
    expect(await screen.findByText('This code has expired')).toBeTruthy();
    expect(screen.getByText('Codes last 5 minutes. Ask for a new one to keep going.')).toBeTruthy();
    expect(screen.getByText('Send a new code')).toBeTruthy();
  });

  it('resend: opens when the countdown ends, re-sends inside the challenge, and stops at 3 sends', async () => {
    await toCode({ requestOtp: challenge({ resend_after_s: 0 }), verifyOtp: 'pending' });
    fireEvent.press(await screen.findByText('Send the code again'));
    await waitFor(() => expect(api.callsTo('requestOtp')).toHaveLength(2));
    fireEvent.press(await screen.findByText('Send the code again'));
    expect(await screen.findByText("We've sent 3 codes")).toBeTruthy();
    expect(screen.getByText('Use the latest one. If it has expired, you can ask for a new code in 15 minutes.')).toBeTruthy();
    expect(screen.queryByText('Send the code again')).toBeNull();
    expect(api.callsTo('requestOtp')).toHaveLength(3);
    expect(api.callsTo('requestOtp').every((c) => c.body && (c.body as { purpose: string }).purpose === 'SIGN_IN')).toBe(true);
  });

  it('resend answered 429: the resend limit, with the wait from the server', async () => {
    await toCode({ requestOtp: (_c, nth) => (nth === 0 ? challenge({ resend_after_s: 0 }) : rateLimited(11 * 60)) });
    fireEvent.press(await screen.findByText('Send the code again'));
    expect(await screen.findByText("We've sent 3 codes")).toBeTruthy();
    expect(screen.getByText('Use the latest one. If it has expired, you can ask for a new code in 11 minutes.')).toBeTruthy();
  });

  it('429 on verify: sign-in paused, no Verify', async () => {
    await toCode({ verifyOtp: rateLimited(14 * 60) });
    typeCode('482913');
    expect(await screen.findByText('Too many tries')).toBeTruthy();
    expect(screen.getByText('Sign-in is paused for this number. Try again in 14 minutes.')).toBeTruthy();
    expect(screen.queryByTestId('verify')).toBeNull();
    expect(screen.getByText('Use a different number')).toBeTruthy();
  });

  it('offline: keeps the code, Verify waits for the connection, then checks it', async () => {
    await toCode({ verifyOtp: (_c, nth) => (nth === 0 ? 'offline' : 'session_next_route_home') });
    typeCode('482913');
    expect(await screen.findByText('You are offline')).toBeTruthy();
    expect(screen.getByTestId('code-field').props.value).toBe('482913');
    expect(disabled('verify')).toBe(true);
    act(() => reportReachable());
    fireEvent.press(screen.getByTestId('verify'));
    await waitFor(() => expect(getToken()).toBe('Access Token'));
    expect(api.callsTo('verifyOtp')).toHaveLength(2);
  });

  it('a closed account: This rider account is closed, Back to sign in returns to the phone', async () => {
    await toCode({ verifyOtp: accountNotActive() });
    typeCode('482913');
    expect(await screen.findByText('This rider account is closed')).toBeTruthy();
    expect(screen.queryByText(/different number/)).toBeNull();
    fireEvent.press(screen.getByText('Back to sign in'));
    expect(await screen.findByText('Sign in or apply to ride')).toBeTruthy();
    expect(getToken()).toBeNull();
  });

  it('Use a different number: back to an empty phone field; Back keeps the number', async () => {
    await toCode();
    fireEvent.press(screen.getByLabelText('Back to phone number'));
    expect(await screen.findByText('Sign in or apply to ride')).toBeTruthy();
    expect(screen.getByTestId('phone-field').props.value).toMatch(/416/);
    fireEvent.press(screen.getByTestId('send-code'));
    await screen.findByText('Enter your code');
    fireEvent.press(screen.getByText('Use a different number'));
    expect(await screen.findByText('Sign in or apply to ride')).toBeTruthy();
    expect(screen.getByTestId('phone-field').props.value).toBe('');
  });
});
