/**
 * S5 forced full-screen routes (boards `SI/Blocked`, `SI/Blocked-*`): each kind with the phone line
 * open, closed and off, the mid-checkout line, icons only where the design system has them, and
 * every way out.
 */
import * as React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { getToken, setToken } from '../../../api/token';
import { resetAuthForTests } from '../../api/auth';
import { api } from '../../api/client';
import { resetPublicConfigCache } from '../../api/config';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { renderRedesign } from '../../test/render';
import { BlockedScreen } from '../BlockedScreen';
import { clearForced, getForced, raiseForced, type ForcedKind, type ForcedRoute } from '../forced';
import { getSession, resetSessionForTests } from '../session';

const CONFIG = payloadOf('public_config');
const OPEN = 'public_config';
const CLOSED = { status: 200, body: { data: { ...CONFIG, support_enabled: false, support_phone_e164: null, support_hours: '11:00 am to 11:00 pm' } } };
const OFF = { status: 200, body: { data: { ...CONFIG, support_enabled: false, support_phone_e164: null, support_hours: null } } };

let mock: MockApi;

beforeEach(() => {
  resetPublicConfigCache();
  resetAuthForTests();
  clearForced();
  resetSessionForTests();
  act(() => setToken('access', 'hgrt_x'));
  mock = mockApi();
});

afterEach(() => {
  mock.restore();
  clearForced();
  act(() => setToken(null));
  resetSessionForTests();
});

async function show(forced: ForcedRoute, config: unknown = OPEN, scheme: 'light' | 'dark' = 'light'): Promise<void> {
  mock.answer('getPublicConfig', config as never);
  act(() => raiseForced(forced));
  renderRedesign(<BlockedScreen forced={forced} />, { scheme });
  await waitFor(() => expect(mock.callsTo('getPublicConfig').length).toBeGreaterThan(0));
  await act(async () => {});
}

describe('account kinds', () => {
  const ACCOUNT: Array<[ForcedKind, string, string, string]> = [
    [
      'on-hold',
      'Your account is on hold',
      "You can't place orders while your account is on hold.",
      'If you think this is a mistake, or you have a question about an order or refund, call support.',
    ],
    [
      'banned',
      "This account can't be used",
      'HalalGoes has closed this account.',
      'If you have a question about a past order or a refund, call support and give them your phone number.',
    ],
    [
      'unavailable',
      "This account isn't available",
      "You can't sign in to this account right now.",
      'Call support if you have a question about a past order or refund.',
    ],
  ];

  it.each(ACCOUNT)('%s, line open: Call support with its hours, then Use a different number', async (kind, title, body, more) => {
    await show({ kind });
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    expect(screen.getByText(more)).toBeTruthy();
    expect(screen.getByText('Call support')).toBeTruthy();
    expect(screen.getByText(`Support hours: ${CONFIG.support_hours}`)).toBeTruthy();
    expect(screen.getByText('Use a different number')).toBeTruthy();
    expect(screen.queryByText('Sign out')).toBeNull();
    // user-block is missing from the DS icon set: the circle stays empty, never a borrowed glyph.
    const circle = screen.getByTestId('Blocked-icon', { includeHiddenElements: true });
    expect(within(circle).queryByTestId(/hg-icon-/, { includeHiddenElements: true })).toBeNull();
  });

  it.each(ACCOUNT)('%s, line closed: the hours as written and one way out, Sign out', async (kind) => {
    await show({ kind }, CLOSED);
    expect(
      screen.getByText(
        "Our phone line is closed right now. It's open 11:00 am to 11:00 pm. Sign out to use HalalGoes with a different number.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
    expect(screen.queryByText('Use a different number')).toBeNull();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('support off with no hours: the hours sentence drops', async () => {
    await show({ kind: 'banned' }, OFF);
    expect(screen.getByText('Sign out to use HalalGoes with a different number.')).toBeTruthy();
  });

  it('Call support dials the line from PublicConfig', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await show({ kind: 'on-hold' });
    fireEvent.press(screen.getByText('Call support'));
    expect(open).toHaveBeenCalledWith(`tel:${CONFIG.support_phone_e164}`);
    expect(getForced()).toEqual({ kind: 'on-hold' });
    open.mockRestore();
  });

  it('Sign out leaves for the signed-out screen and tells the server', async () => {
    await show({ kind: 'on-hold' }, CLOSED);
    act(() => {
      fireEvent.press(screen.getByText('Sign out'));
    });
    expect(getForced()).toBeNull();
    expect(getToken()).toBeNull();
    expect(getSession().signedOut).toBe('signedOut');
    await waitFor(() => expect(mock.callsTo('logout')).toHaveLength(1));
  });

  it('Use a different number returns to Sign in', async () => {
    await show({ kind: 'banned' });
    act(() => {
      fireEvent.press(screen.getByText('Use a different number'));
    });
    expect(getForced()).toBeNull();
    expect(getToken()).toBeNull();
  });

  it('mid-checkout adds "That order wasn\'t placed." and says nothing about the cart', async () => {
    await show({ kind: 'on-hold', midCheckout: true });
    expect(screen.getByText("You can't place orders while your account is on hold. That order wasn't placed.")).toBeTruthy();
    expect(screen.queryByText(/cart/i)).toBeNull();
  });

  it('a 403 ACCOUNT_SUSPENDED from createOrder raises the mid-checkout state', async () => {
    mock.answer('createOrder', { status: 403, code: 'ACCOUNT_SUSPENDED' });
    await api.POST('/v1/orders', {
      params: { header: { 'Idempotency-Key': 'test-key' } },
      body: { quote_id: 'q_1' },
    } as never);
    expect(getForced()).toEqual({ kind: 'on-hold', midCheckout: true });
    renderRedesign(<BlockedScreen forced={getForced()!} />);
    await waitFor(() => expect(mock.callsTo('getPublicConfig').length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.getByText("You can't place orders while your account is on hold. That order wasn't placed.")).toBeTruthy();
  });

  it('a 403 ACCOUNT_SUSPENDED from createQuote raises the mid-checkout state too', async () => {
    mock.answer('createQuote', { status: 403, code: 'ACCOUNT_SUSPENDED' });
    await api.POST('/v1/quotes', { body: { restaurant_id: 'r_1', items: [] } } as never);
    expect(getForced()).toEqual({ kind: 'on-hold', midCheckout: true });
  });

  it('a 403 ACCOUNT_SUSPENDED from any other call leaves "That order wasn\'t placed." out', async () => {
    mock.answer('getCustomerProfile', { status: 403, code: 'ACCOUNT_SUSPENDED' });
    await api.GET('/v1/me/profile');
    expect(getForced()).toEqual({ kind: 'on-hold' });
    renderRedesign(<BlockedScreen forced={getForced()!} />);
    await waitFor(() => expect(mock.callsTo('getPublicConfig').length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.getByText("You can't place orders while your account is on hold.")).toBeTruthy();
    expect(screen.queryByText(/That order wasn't placed/)).toBeNull();
  });

  it('renders in dark', async () => {
    await show({ kind: 'on-hold' }, OPEN, 'dark');
    expect(screen.getByText('Your account is on hold')).toBeTruthy();
  });
});

describe('session kinds', () => {
  it('security, line open: Sign in again, then Call support with its hours', async () => {
    await show({ kind: 'security' });
    expect(screen.getByText('We signed you out to keep your account safe')).toBeTruthy();
    expect(screen.getByText('Your sign-in was used from two places at the same time, so we signed you out everywhere.')).toBeTruthy();
    expect(screen.getByText("Sign in again with your phone. If you didn't expect this, call support.")).toBeTruthy();
    expect(screen.getByText('Sign in again')).toBeTruthy();
    expect(screen.getByText('Call support')).toBeTruthy();
    expect(screen.getByText(`Support hours: ${CONFIG.support_hours}`)).toBeTruthy();
  });

  it('security, line closed: the support sentence and button drop', async () => {
    await show({ kind: 'security' }, CLOSED);
    expect(screen.getByText('Sign in again with your phone.')).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('revoked, line open and closed', async () => {
    await show({ kind: 'revoked' });
    expect(screen.getByText("You've been signed out")).toBeTruthy();
    expect(screen.getByText('This phone is no longer signed in to your account.')).toBeTruthy();
    expect(screen.getByText('Call support')).toBeTruthy();
  });

  it('revoked with the line closed: one way out', async () => {
    await show({ kind: 'revoked' }, CLOSED, 'dark');
    expect(screen.getByText('Sign in again with your number to keep ordering.')).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
    act(() => {
      fireEvent.press(screen.getByText('Sign in again'));
    });
    expect(getForced()).toBeNull();
    expect(getToken()).toBeNull();
  });

  it.each(['security', 'revoked'] as const)('%s carries the lock icon in the circle', async (kind) => {
    await show({ kind });
    const circle = screen.getByTestId('Blocked-icon', { includeHiddenElements: true });
    expect(within(circle).getByTestId('hg-icon-lock', { includeHiddenElements: true })).toBeTruthy();
  });

  it('expired: Sign in, with the clock icon', async () => {
    await show({ kind: 'expired' });
    expect(screen.getByText('Please sign in again')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.queryByText('Call support')).toBeNull();
    const circle = screen.getByTestId('Blocked-icon', { includeHiddenElements: true });
    expect(within(circle).getByTestId('hg-icon-clock', { includeHiddenElements: true })).toBeTruthy();
  });

  it('update: Update the app opens the store and does not sign out', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await show({ kind: 'update' });
    expect(screen.getByText('Update HalalGoes to keep ordering')).toBeTruthy();
    expect(screen.getByText('This version of the app is no longer supported.')).toBeTruthy();
    fireEvent.press(screen.getByText('Update the app'));
    expect(open).toHaveBeenCalled();
    expect(getForced()).toEqual({ kind: 'update' });
    open.mockRestore();
  });
});
