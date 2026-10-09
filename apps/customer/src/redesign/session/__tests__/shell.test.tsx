import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { setToken } from '../../../api/token';
import { resetPublicConfigCache } from '../../api/config';
import { resetConnectivity, useConnectivity } from '../../lib/connectivity';
import { Shell } from '../../navigation/Shell';
import { REDESIGNED } from '../../navigation/registry';
import { useNav } from '../../navigation/context';
import { mockApi, type MockApi } from '../../test/mockApi';
import { renderRedesign } from '../../test/render';
import { blockedText, BLOCKED_COPY } from '../BlockedScreen';
import { clearForced, forcedKindForCode, forcedKindForStatus, raiseForced } from '../forced';
import { resetSessionForTests } from '../session';
import { api } from '../../api/client';

// The legacy screens the shell falls back to make their own calls; tests here assert the shell.
function Probe({ label }: { label: string }): React.ReactElement {
  const nav = useNav();
  const { Text, Pressable } = require('react-native');
  return (
    <Pressable accessibilityRole="button" onPress={() => nav.push({ name: 'cart' })}>
      <Text>{label}</Text>
    </Pressable>
  );
}

let mock: MockApi;

beforeEach(() => {
  clearForced();
  resetPublicConfigCache();
  resetConnectivity();
  mock = mockApi({ listOrders: 'order_list_active' });
  REDESIGNED.home = () => <Probe label="Home screen" />;
  REDESIGNED.orders = () => <Probe label="Orders screen" />;
  REDESIGNED.search = () => <Probe label="Search screen" />;
  REDESIGNED.account = () => <Probe label="Account screen" />;
  REDESIGNED.cart = () => <Probe label="Cart screen" />;
});

afterEach(() => {
  mock.restore();
  for (const k of Object.keys(REDESIGNED)) delete (REDESIGNED as Record<string, unknown>)[k];
  act(() => setToken(null));
  resetSessionForTests();
});

function signIn(): void {
  act(() => setToken('access', 'hgrt_refresh'));
  resetSessionForTests();
}

describe('the redesign shell (WP0)', () => {
  it('boots to sign-in when signed out', () => {
    renderRedesign(<Shell />);
    expect(screen.getByTestId('RedesignSignedOut')).toBeTruthy();
    expect(screen.queryByTestId('RedesignBottomNav')).toBeNull();
  });

  it('boots to Home with Home · Search · Orders · Account when signed in, and the tabs switch', async () => {
    signIn();
    renderRedesign(<Shell />);
    expect(screen.getByText('Home screen')).toBeTruthy();
    for (const label of ['Home', 'Search', 'Orders', 'Account']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Alerts')).toBeNull();
    fireEvent.press(screen.getByText('Orders'));
    expect(screen.getByText('Orders screen')).toBeTruthy();
    fireEvent.press(screen.getByText('Search'));
    expect(screen.getByText('Search screen')).toBeTruthy();
    await waitFor(() => expect(mock.callsTo('listOrders').length).toBeGreaterThan(0));
    expect(mock.callsTo('listOrders')[0]!.url).toContain('status_group=ACTIVE');
  });

  it('hides the bottom navigation off a tab root', () => {
    signIn();
    renderRedesign(<Shell />);
    fireEvent.press(screen.getByText('Home screen'));
    expect(screen.getByText('Cart screen')).toBeTruthy();
    expect(screen.queryByTestId('RedesignBottomNav')).toBeNull();
  });

  it('renders in dark', () => {
    signIn();
    renderRedesign(<Shell />, { scheme: 'dark' });
    expect(screen.getByText('Home screen')).toBeTruthy();
  });

  it('replaces any screen when any call returns 403 ACCOUNT_SUSPENDED', async () => {
    signIn();
    mock.answer('getCustomerProfile', { status: 403, code: 'ACCOUNT_SUSPENDED' });
    mock.answer('getPublicConfig', { status: 200, body: { data: { support_enabled: false, support_hours: '11:00 am to 11:00 pm' } } });
    renderRedesign(<Shell />);
    fireEvent.press(screen.getByText('Home screen'));
    expect(screen.getByText('Cart screen')).toBeTruthy();
    await act(async () => {
      await api.GET('/v1/me/profile').catch(() => {});
    });
    expect(screen.getByTestId('Blocked-on-hold')).toBeTruthy();
    expect(screen.getByText('Your account is on hold')).toBeTruthy();
    expect(screen.queryByTestId('RedesignBottomNav')).toBeNull();
    await waitFor(() => expect(screen.getByText(/It's open 11:00 am to 11:00 pm/)).toBeTruthy());
    expect(screen.queryByText('Call support')).toBeNull();
  });

  it('raises the revoked screen on WebSocket close 4401 and the security screen on refresh reuse', () => {
    signIn();
    renderRedesign(<Shell />);
    act(() => raiseForced({ kind: 'revoked' }));
    expect(screen.getByText("You've been signed out")).toBeTruthy();
    act(() => {
      clearForced();
      raiseForced({ kind: forcedKindForCode('REFRESH_REUSE_DETECTED')! });
    });
    expect(screen.getByText('We signed you out to keep your account safe')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Blocked-exit'));
    expect(screen.getByTestId('RedesignSignedOut')).toBeTruthy();
  });
});

describe('forced-route mapping', () => {
  it('maps session and account codes, and nothing else', () => {
    expect(forcedKindForCode('ACCOUNT_SUSPENDED')).toBe('on-hold');
    expect(forcedKindForCode('ACCOUNT_BANNED')).toBe('banned');
    expect(forcedKindForCode('ACCOUNT_NOT_ACTIVE')).toBe('unavailable');
    expect(forcedKindForCode('ACCOUNT_DEACTIVATED')).toBe('unavailable');
    expect(forcedKindForCode('SESSION_REVOKED')).toBe('revoked');
    expect(forcedKindForCode('SESSION_EXPIRED')).toBe('expired');
    expect(forcedKindForCode('QUOTE_STALE')).toBeNull();
    expect(forcedKindForStatus('SUSPENDED')).toBe('on-hold');
    expect(forcedKindForStatus('BANNED')).toBe('banned');
    expect(forcedKindForStatus('DELETED')).toBe('unavailable');
    expect(forcedKindForStatus('ACTIVE')).toBeNull();
  });

  it('adds "That order wasn\'t placed." only from checkout', () => {
    expect(blockedText({ kind: 'on-hold', midCheckout: true }, null).description).toContain("That order wasn't placed.");
    expect(blockedText({ kind: 'on-hold' }, null).description).not.toContain("That order wasn't placed.");
    expect(BLOCKED_COPY.banned.title).toBe("This account can't be used");
  });
});

describe('connectivity', () => {
  it('goes offline on a transport failure and back online on any response', async () => {
    mock.answer('getPublicConfig', 'offline');
    const seen: boolean[] = [];
    function Watch(): null {
      seen.push(useConnectivity().online);
      return null;
    }
    renderRedesign(<Watch />);
    await act(async () => {
      await api.GET('/v1/config/public').catch(() => {});
    });
    expect(seen[seen.length - 1]).toBe(false);
    mock.answer('getPublicConfig', 'public_config');
    await act(async () => {
      await api.GET('/v1/config/public').catch(() => {});
    });
    expect(seen[seen.length - 1]).toBe(true);
  });
});
