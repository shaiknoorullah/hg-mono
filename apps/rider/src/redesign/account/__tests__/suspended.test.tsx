/**
 * WP9 Account paused (next_route SUSPENDED) against the fixtures, light and dark: the reason is
 * facts only, from blocking_reasons and the EXPIRED document; every version says money already
 * earned is still paid out; nothing is red.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../push', () => ({ registerForPush: jest.fn(), unregisterForPush: jest.fn(), takeRegisteredDeviceId: jest.fn(() => null) }));

import { isAuthed, setToken } from '../../../token';
import { consumeVoluntarySignOut } from '../../session/signOut';
import { mockApi, type MockApi } from '../../test/mockApi';
import { renderRedesign, SCHEMES } from '../../test/render';
import { SuspendedScreen } from '../SuspendedScreen';
import { apiError, config, dashboardBlocked, docsExpired, docsExpiredInReview, supportOff } from './fixtures';

let api: MockApi;

afterEach(() => {
  api?.restore();
  act(() => setToken(null));
  consumeVoluntarySignOut();
});

describe.each(SCHEMES)('Account paused (%s)', (scheme) => {
  it('generic: facts only, money still paid, Call support and Sign out (PA/Suspended-Generic)', async () => {
    api = mockApi({ getRiderDashboard: dashboardBlocked(['ACCOUNT_NOT_ACTIVE']), listRiderDocuments: 'rider_document_pack_complete', getPublicConfig: config() });
    renderRedesign(<SuspendedScreen />, { scheme });
    expect(screen.getByLabelText('Loading your account')).toBeTruthy();
    await screen.findByText("You can't go online right now");
    expect(screen.getByText('Account paused')).toBeTruthy();
    expect(screen.getByText('Your account is paused.')).toBeTruthy();
    expect(screen.getByText("Money you've already earned is still paid out.")).toBeTruthy();
    await screen.findByText('Call support to find out more.');
    expect(screen.getByText('Support is open 9 am to 9 pm.')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('generic with support off (PA/Suspended-Generic-NoSupport)', async () => {
    api = mockApi({ getRiderDashboard: dashboardBlocked(['ACCOUNT_NOT_ACTIVE']), getPublicConfig: supportOff() });
    renderRedesign(<SuspendedScreen />, { scheme });
    await screen.findByText("Support isn't available right now. Try again later.");
    expect(screen.queryByText('Call support')).toBeNull();
    expect(screen.queryByText('Call support to find out more.')).toBeNull();
  });

  it('a dashboard that refuses a paused account (403) is the generic pause, not an error', async () => {
    api = mockApi({ getRiderDashboard: apiError(403, 'ACCOUNT_NOT_ACTIVE'), listRiderDocuments: apiError(403, 'ACCOUNT_NOT_ACTIVE'), getPublicConfig: config() });
    renderRedesign(<SuspendedScreen />, { scheme });
    await screen.findByText('Your account is paused.');
    expect(screen.queryByText("We couldn't load your account")).toBeNull();
  });

  it('a documents failure on a plain pause is still the generic pause, not the error', async () => {
    api = mockApi({ getRiderDashboard: dashboardBlocked(['ACCOUNT_NOT_ACTIVE']), listRiderDocuments: 'error_internal_error', getPublicConfig: config() });
    renderRedesign(<SuspendedScreen />, { scheme });
    await screen.findByText('Your account is paused.');
    expect(screen.queryByText("We couldn't load your account")).toBeNull();
  });

  it('document expired: names it and its date (PA/Suspended-DocExpired)', async () => {
    api = mockApi({ getRiderDashboard: dashboardBlocked(['DOCUMENT_EXPIRED']), listRiderDocuments: docsExpired(), getPublicConfig: config() });
    renderRedesign(<SuspendedScreen />, { scheme });
    await screen.findByText(
      "Your vehicle insurance expired on Monday 28 September 2026. Add your new insurance and we will check it. Money you've already earned is still paid out.",
    );
    expect(screen.getByText('Vehicle insurance')).toBeTruthy();
    expect(screen.getByText('Expired 28 September 2026')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('new document in review (PA/Suspended-InReview)', async () => {
    api = mockApi({ getRiderDashboard: dashboardBlocked(['DOCUMENT_EXPIRED']), listRiderDocuments: docsExpiredInReview(), getPublicConfig: config() });
    renderRedesign(<SuspendedScreen />, { scheme });
    await screen.findByText(
      "Your vehicle insurance expired. We're checking your new one. You can go online again once a person approves it. Money you've already earned is still paid out.",
    );
    expect(screen.getByText("We'll send you a notification when your account is active again. This screen also updates as soon as a person decides.")).toBeTruthy();
    expect(screen.getByText('Sent Tuesday 29 September 2026')).toBeTruthy();
    expect(screen.getByText('In review')).toBeTruthy();
    expect(screen.getByText('Vehicle insurance (earlier)')).toBeTruthy();
    expect(screen.getByText('Replaced')).toBeTruthy();
  });

  it('error, then Try again (PA/Suspended-Error)', async () => {
    api = mockApi({ getRiderDashboard: (_c, nth) => (nth === 0 ? 'offline' : dashboardBlocked(['ACCOUNT_NOT_ACTIVE'])), getPublicConfig: config() });
    renderRedesign(<SuspendedScreen />, { scheme });
    await screen.findByText("We couldn't load your account");
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Your account is paused.');
  });

  it('Sign out from a paused account goes through the same confirm', async () => {
    api = mockApi({ getRiderDashboard: dashboardBlocked(['ACCOUNT_NOT_ACTIVE']), getPublicConfig: config() });
    act(() => setToken('t', 'r'));
    renderRedesign(<SuspendedScreen />, { scheme });
    fireEvent.press(await screen.findByText('Sign out'));
    expect(screen.getByText('Sign out?')).toBeTruthy();
    fireEvent.press(screen.getByTestId('sign-out-confirm'));
    await waitFor(() => expect(isAuthed()).toBe(false));
    expect(api.callsTo('logout')).toHaveLength(1);
  });
});
