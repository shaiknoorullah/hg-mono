/**
 * R01 Sign in or apply — phone: every state on the SO phone boards, light and dark, against the
 * contract fixtures (requestOtp, getPublicConfig).
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

import { reportReachable, resetConnectivity } from '../../data/connectivity';
import { mockApi, type MockApi } from '../../test/mockApi';
import { renderRedesign, SCHEMES } from '../../test/render';
import { SignInScreen } from '../SignInScreen';
import { hasPriceField, invalidPhone, rateLimited, supportOff, unavailable } from './fixtures';

let api: MockApi;

beforeEach(() => resetConnectivity());
afterEach(() => api?.restore());

function typePhone(digits: string) {
  fireEvent.changeText(screen.getByTestId('phone-field'), digits);
}

function sendButton() {
  return screen.getByTestId('send-code');
}

describe.each(SCHEMES)('phone step (%s)', (scheme) => {
  const show = (params: { reason?: 'signed-out' } = {}) => renderRedesign(<SignInScreen params={params} />, { scheme });

  it('default: the approved copy, and Call support from PublicConfig', async () => {
    api = mockApi();
    show();
    expect(screen.getByText('Sign in or apply to ride')).toBeTruthy();
    expect(screen.getByText("Enter your mobile number. We'll send a 6-digit code. New riders start here too.")).toBeTruthy();
    expect(screen.getByText(/Mobile number/)).toBeTruthy();
    expect(screen.getByText('Canadian numbers only (+1).')).toBeTruthy();
    expect(screen.getByText('Send code')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Call support')).toBeTruthy());
    expect(api.callsTo('getPublicConfig')).toHaveLength(1);
  });

  it('support off: no Call support button', async () => {
    api = mockApi({ getPublicConfig: supportOff() });
    show();
    await waitFor(() => expect(api.callsTo('getPublicConfig')).toHaveLength(1));
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('a short number is caught on the phone, with no request', async () => {
    api = mockApi();
    show();
    typePhone('41655501');
    fireEvent.press(sendButton());
    expect(await screen.findByText(/Enter all 10 digits of a Canadian mobile number, like 416 555 0134\./)).toBeTruthy();
    expect(api.callsTo('requestOtp')).toHaveLength(0);
    typePhone('416555013');
    expect(screen.queryByText(/Enter all 10 digits/)).toBeNull();
  });

  it('422 INVALID_PHONE shows the number error', async () => {
    api = mockApi({ requestOtp: invalidPhone() });
    show();
    typePhone('4165550134');
    fireEvent.press(sendButton());
    expect(await screen.findByText(/Enter all 10 digits/)).toBeTruthy();
  });

  it('sending: the button keeps its label and loads; the field is read-only', async () => {
    api = mockApi({ requestOtp: 'pending' });
    show();
    typePhone('4165550134');
    fireEvent.press(sendButton());
    await waitFor(() => expect(sendButton().props.accessibilityState.busy).toBe(true));
    expect(screen.getByText('Send code')).toBeTruthy();
    expect(screen.getByTestId('phone-field').props.editable).toBe(false);
  });

  it('sent: asks for SIGN_IN as the rider app, with no price, and opens the code step', async () => {
    api = mockApi({ requestOtp: 'otp_challenge' });
    show();
    typePhone('4165550134');
    fireEvent.press(sendButton());
    expect(await screen.findByText('Enter your code')).toBeTruthy();
    expect(screen.getByText('We sent a 6-digit code to the number ending 0134.')).toBeTruthy();
    const [call] = api.callsTo('requestOtp');
    expect(call!.body).toEqual({ phone_e164: '+14165550134', purpose: 'SIGN_IN' });
    expect(call!.headers['x-hg-client']).toBe('rider-app');
    expect(hasPriceField(call!.body)).toBe(false);
  });

  it('429: too many codes, with the wait from the server, and Send code off', async () => {
    api = mockApi({ requestOtp: rateLimited(14 * 60) });
    show();
    typePhone('4165550134');
    fireEvent.press(sendButton());
    expect(await screen.findByText('Too many codes requested')).toBeTruthy();
    expect(screen.getByText('For your security, wait 14 minutes before asking for another code.')).toBeTruthy();
    expect(sendButton().props.accessibilityState.disabled).toBe(true);
  });

  it('429 with no wait given falls back to the 15-minute window (error_rate_limited as is)', async () => {
    api = mockApi({ requestOtp: 'error_rate_limited' });
    show();
    typePhone('4165550134');
    fireEvent.press(sendButton());
    expect(await screen.findByText('For your security, wait 15 minutes before asking for another code.')).toBeTruthy();
  });

  it('503: codes unavailable, and the button becomes Try again, which sends again', async () => {
    api = mockApi({ requestOtp: (_c, nth) => (nth === 0 ? unavailable() : 'otp_challenge') });
    show();
    typePhone('4165550134');
    fireEvent.press(sendButton());
    expect(await screen.findByText("We can't send codes right now")).toBeTruthy();
    expect(screen.getByText('The problem is on our side, not your phone. Try again in a few minutes.')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Enter your code')).toBeTruthy();
    expect(api.callsTo('requestOtp')).toHaveLength(2);
  });

  it('offline: nothing was sent, Send code waits for the connection', async () => {
    api = mockApi({ requestOtp: 'offline' });
    show();
    typePhone('4165550134');
    fireEvent.press(sendButton());
    expect(await screen.findByText('You are offline')).toBeTruthy();
    expect(screen.getByText('Nothing was sent. Connect to mobile data or Wi-Fi, then try again.')).toBeTruthy();
    expect(sendButton().props.accessibilityState.disabled).toBe(true);
    act(() => reportReachable());
    expect(screen.queryByText('You are offline')).toBeNull();
    expect(sendButton().props.accessibilityState.disabled).toBe(false);
  });

  it('signed out under the rider: says so', () => {
    api = mockApi();
    show({ reason: 'signed-out' });
    expect(screen.getByText('You were signed out')).toBeTruthy();
    expect(screen.getByText('Sign in again to keep working.')).toBeTruthy();
  });
});
