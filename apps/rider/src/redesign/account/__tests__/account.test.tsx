/**
 * WP9 Account tab against the contract's fixtures, light and dark: the overview (R44) in every
 * state, sign out (R48: unregister the device, then revoke the session, then forget it; failure
 * keeps the rider signed in), Your details (R45), Vehicle (R50), Documents, Terms and privacy and
 * the legal document (R46/R05), Delete account by request (R51).
 */
import * as React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

jest.mock('../../../push', () => ({
  registerForPush: jest.fn(async () => undefined),
  unregisterForPush: jest.fn(),
  takeRegisteredDeviceId: jest.fn(() => 'rider-device-1'),
}));

import { registerForPush, takeRegisteredDeviceId } from '../../../push';
import { isAuthed, setToken } from '../../../token';
import { resetConnectivity } from '../../data/connectivity';
import { Shell } from '../../nav/Shell';
import { consumeVoluntarySignOut } from '../../session/signOut';
import { mockApi, type MockApi } from '../../test/mockApi';
import { renderRedesign, SCHEMES } from '../../test/render';
import { longDate } from '../copy';
import '../index';
import { apiError, config, connectOn, docsEmpty, docsExpiredInReview, docsExpiring, isoDay, riderMe, supportOff } from './fixtures';

let api: MockApi;
let openURL: jest.SpyInstance;

beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  (takeRegisteredDeviceId as jest.Mock).mockReturnValue('rider-device-1');
  (registerForPush as jest.Mock).mockClear();
});

afterEach(() => {
  api?.restore();
  openURL.mockRestore();
  resetConnectivity();
  act(() => setToken(null));
  consumeVoluntarySignOut();
  delete process.env.EXPO_PUBLIC_RIDER_TERMS_URL;
});

/** No scenario: mockApi answers the operation's 204, as `pnpm mock` does for `logout`. */
const NO_CONTENT = '';
const PRICE_KEYS = /price|_cents|amount|total/i;

function renderAccount(scheme: 'light' | 'dark') {
  return renderRedesign(<Shell />, { scheme, nav: { initialTab: 'account' } });
}

describe.each(SCHEMES)('Account tab (%s)', (scheme) => {
  it('overview: name, status line, every row, help with support hours (PA/Account-Overview)', async () => {
    api = mockApi({ getRiderMe: riderMe(), listRiderDocuments: docsExpiring(), getConnectStatus: connectOn(), getPublicConfig: config() });
    renderAccount(scheme);
    expect(screen.getByLabelText('Loading your account')).toBeTruthy();
    await screen.findByText('Yusuf Ahmed');
    expect(screen.getByText('+1 416 555 0134')).toBeTruthy();
    expect(screen.getByText('Approved · can go online')).toBeTruthy();
    expect(screen.getByText('Name, phone, time zone')).toBeTruthy();
    expect(screen.getByText('Scooter · Honda PCX 125 · CJRA 204')).toBeTruthy();
    await screen.findByText('1 expires soon');
    expect(screen.getByText('Expires soon')).toBeTruthy();
    await screen.findByText('Bank account ending 4821 · every Monday');
    expect(screen.getByText('Rider terms and privacy notice')).toBeTruthy();
    expect(screen.getByText('Ask HalalGoes to close your account')).toBeTruthy();
    expect(screen.getByText('Call support')).toBeTruthy();
    await screen.findByText('Support is open 9 am to 9 pm.');
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('overview with support off hides Call support (PA/Account-Overview-NoSupport)', async () => {
    api = mockApi({ getRiderMe: riderMe(), getPublicConfig: supportOff() });
    renderAccount(scheme);
    await screen.findByText("Support isn't available right now. Try again later.");
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('overview with a replacement in review (PA/Account-Overview-ReplaceInReview)', async () => {
    api = mockApi({ getRiderMe: riderMe(), listRiderDocuments: docsExpiredInReview(), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText('New insurance in review. You can keep riding.');
    expect(screen.getByText('In review')).toBeTruthy();
  });

  it('overview error, then Try again (PA/Account-Error)', async () => {
    api = mockApi({ getRiderMe: (_c, nth) => (nth === 0 ? 'offline' : riderMe()), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText("We couldn't load your account");
    expect(screen.getByText('Check your connection and try again. Your deliveries and earnings are not affected.')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Yusuf Ahmed');
  });

  it('sign out: confirm, unregister the device, revoke the session, back to sign-in (PA/Account-SignOut)', async () => {
    api = mockApi({ getRiderMe: riderMe(), getPublicConfig: config() });
    act(() => setToken('t', 'r'));
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('sign-out'));
    expect(screen.getByText('Sign out?')).toBeTruthy();
    expect(screen.getByText('You will stop getting offers on this phone.')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    fireEvent.press(screen.getByTestId('sign-out-confirm'));
    await waitFor(() => expect(isAuthed()).toBe(false));
    const order = api.calls.map((c) => c.operationId).filter((op) => op === 'unregisterDevice' || op === 'logout');
    expect(order).toEqual(['unregisterDevice', 'logout']);
    expect(api.callsTo('unregisterDevice')[0]!.path).toBe('/v1/devices/rider-device-1');
    expect(consumeVoluntarySignOut()).toBe(true); // the gate shows plain sign-in, not "signed out"
  });

  it('sign out during a delivery warns that the delivery stays yours (PA/Account-SignOut-Active)', async () => {
    api = mockApi({ getRiderMe: riderMe({ active_assignment_id: 'd32c6111-bbee-4947-a3db-005a8ae50058', availability_state: 'ON_DELIVERY' }), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('sign-out'));
    expect(screen.getByText('You are on a delivery')).toBeTruthy();
    expect(screen.getByText('Sign out anyway')).toBeTruthy();
    fireEvent.press(screen.getByText('Stay signed in'));
    await waitFor(() => expect(screen.queryByText('You are on a delivery')).toBeNull());
    expect(api.callsTo('logout')).toHaveLength(0);
  });

  it('sign out failed keeps the rider signed in and offers Try again (PA/Account-SignOut-Failed)', async () => {
    api = mockApi({ getRiderMe: riderMe(), getPublicConfig: config(), logout: (_c, nth) => (nth === 0 ? 'offline' : NO_CONTENT) });
    act(() => setToken('t', 'r'));
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('sign-out'));
    fireEvent.press(screen.getByTestId('sign-out-confirm'));
    await screen.findByText("We couldn't sign you out");
    expect(screen.getByText("You're still signed in on this phone. Check your connection and try again.")).toBeTruthy();
    expect(isAuthed()).toBe(true);
    expect(registerForPush).toHaveBeenCalled(); // the device registers again
    fireEvent.press(screen.getByTestId('sign-out-retry'));
    await waitFor(() => expect(isAuthed()).toBe(false));
  });

  it('Your details: RiderMe fields only, loading and error (PA/Account-Profile*)', async () => {
    api = mockApi({ getRiderMe: (_c, nth) => (nth === 1 ? 'offline' : riderMe()), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('row-details'));
    expect(screen.getByLabelText('Loading your details')).toBeTruthy();
    await screen.findByText("We couldn't load your details");
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Mobile number');
    expect(screen.getByText('Eastern time (Toronto)')).toBeTruthy();
    expect(screen.getByText('Your name and date of birth were checked against your ID. To change them, call support.')).toBeTruthy();
  });

  it('Vehicle: read-only summary, call support to change, loading and error (PA/Account-VehicleChange, -Vehicle-*)', async () => {
    api = mockApi({ getRiderMe: (_c, nth) => (nth === 1 ? 'offline' : riderMe()), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('row-vehicle'));
    expect(screen.getByLabelText('Loading your vehicle')).toBeTruthy();
    await screen.findByText("We couldn't load your vehicle");
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Your vehicle');
    expect(screen.getByText('Honda PCX 125, 2021, grey')).toBeTruthy();
    expect(screen.getByText('CJRA 204')).toBeTruthy();
    fireEvent.press(screen.getByText('Call support to change your vehicle'));
    expect(openURL).toHaveBeenCalledWith('tel:+18005550199');
  });

  it('Documents: expiring alert and rows (PA/Account-Documents)', async () => {
    api = mockApi({ getRiderMe: riderMe(), listRiderDocuments: docsExpiring(), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('row-documents'));
    await screen.findByText(`Your insurance expires on ${longDate(isoDay(10))}`);
    expect(screen.getByText(`Expires ${longDate(isoDay(10))}`)).toBeTruthy();
    expect(screen.getByText('Photo of you')).toBeTruthy();
    expect(screen.getByText('No expiry')).toBeTruthy();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
  });

  it('Documents: expired with the new one in review (PA/Account-Documents-Expired)', async () => {
    api = mockApi({ getRiderMe: riderMe(), listRiderDocuments: docsExpiredInReview(), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('row-documents'));
    await screen.findByText('Your insurance expired on Monday 28 September 2026');
    expect(screen.getByText("You can't go online until the new insurance is approved. It is being checked now.")).toBeTruthy();
    expect(screen.getByText('Sent Tuesday 29 September 2026')).toBeTruthy();
    expect(screen.getByText('Vehicle insurance (earlier)')).toBeTruthy();
    expect(screen.getByText('Expired Monday 28 September 2026')).toBeTruthy();
    expect(screen.getByText('Replaced')).toBeTruthy();
  });

  it('Documents: loading, error, empty (PA/Account-Documents-Loading, -Error, -Empty)', async () => {
    let answer: 'pending' | 'offline' | 'empty' = 'pending';
    api = mockApi({ getRiderMe: riderMe(), getPublicConfig: config(), listRiderDocuments: () => (answer === 'empty' ? docsEmpty() : answer) });
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    answer = 'pending';
    fireEvent.press(screen.getByTestId('row-documents'));
    expect(screen.getByLabelText('Loading your documents')).toBeTruthy();
    // Back, then open again failing.
    answer = 'offline';
    fireEvent.press(screen.getByLabelText('Back'));
    fireEvent.press(await screen.findByTestId('row-documents'));
    await screen.findByText("We couldn't load your documents");
    expect(screen.getByText('Your documents are safe. Check your connection and try again.')).toBeTruthy();
    answer = 'empty';
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('No documents on file');
    expect(screen.getByText('Call support')).toBeTruthy();
  });

  it('Terms and privacy → the rider terms: error with no address, text when configured (PA/Account-Terms, Legal-Document*)', async () => {
    api = mockApi({ getRiderMe: riderMe(), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('row-terms'));
    expect(screen.getByText('The rider terms and privacy notice. Opening a link shows the current version.')).toBeTruthy();
    fireEvent.press(screen.getByText('Read the rider terms'));
    await screen.findByText("We couldn't open the rider terms");

    process.env.EXPO_PUBLIC_RIDER_TERMS_URL = 'https://docs.example/rider-terms.txt';
    const fetchMock = globalThis.fetch as jest.Mock;
    const contract = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://docs.example/rider-terms.txt') return new Response('First paragraph.\n\nSecond paragraph.', { status: 200 });
      return contract(input, init);
    });
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('First paragraph.');
    expect(screen.getByText('Second paragraph.')).toBeTruthy();
    expect(screen.getByText('Version 2026-05-01')).toBeTruthy();
  });

  it('Delete account by request: Call support, Email support only with an address (PA/Account-Delete-Request)', async () => {
    api = mockApi({ getRiderMe: riderMe(), getPublicConfig: config() });
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('row-delete'));
    expect(screen.getByText('Delete your account')).toBeTruthy();
    expect(screen.getByText("Money you've already earned is still paid out.", { exact: false })).toBeTruthy();
    await screen.findByText('Call support');
    expect(screen.queryByText('Email support')).toBeNull();

    api.restore();
    api = mockApi({ getRiderMe: riderMe(), getPublicConfig: config({ support_email: 'help@halalgoes.example' }) });
    fireEvent.press(screen.getByLabelText('Back'));
    fireEvent.press(await screen.findByTestId('row-delete'));
    fireEvent.press(await screen.findByText('Email support'));
    expect(openURL).toHaveBeenCalledWith('mailto:help@halalgoes.example');
  });

  it('nothing on this tab sends a price, and every write names no amount', async () => {
    api = mockApi({ getRiderMe: riderMe(), getPublicConfig: config() });
    act(() => setToken('t', 'r'));
    renderAccount(scheme);
    await screen.findByText('Yusuf Ahmed');
    fireEvent.press(screen.getByTestId('sign-out'));
    fireEvent.press(screen.getByTestId('sign-out-confirm'));
    await waitFor(() => expect(isAuthed()).toBe(false));
    for (const c of api.calls) expect(JSON.stringify(c.body ?? {})).not.toMatch(PRICE_KEYS);
  });
});

it('a server error on the overview reads as its error state', async () => {
  api = mockApi({ getRiderMe: apiError(500, 'INTERNAL_ERROR'), getPublicConfig: config() });
  renderAccount('light');
  await screen.findByText("We couldn't load your account");
});
