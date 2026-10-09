/**
 * WP0: cold start with no token shows sign-in; with a token, `getRiderMe` routes by
 * `next_route`; a session that ends under the rider shows sign-in "signed out" and keeps the
 * outbox; the redesign follows the phone into dark mode.
 */
import * as React from 'react';
import * as RN from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

import { setToken } from '../../token';
import { Text } from 'react-native';
import { useTheme } from '../ds';
import { clearScreens, registerScreen, type ScreenProps } from '../nav/registry';
import { useNav } from '../nav/Navigator';
import { RedesignRoot } from '../RedesignApp';
import { SessionGate, useSession } from '../session/Session';
import { signOut } from '../session/signOut';
import { outbox } from '../data/outbox';
import { mockApi, payload, type MockApi } from '../test/mockApi';

// Probe screens: each route renders its name and params so the test reads where the gate went.
function probe(name: string) {
  return function Probe({ params }: ScreenProps<any>) {
    return <Text testID="route">{`${name} ${JSON.stringify(params ?? null, (k, v) => (typeof v === 'function' ? undefined : v))}`}</Text>;
  };
}

function TabProbe({ name }: { name: string }) {
  const nav = useNav();
  const session = useSession();
  return <Text testID="route">{`${name} tab=${nav.tab} me=${session.me.next_route}`}</Text>;
}

let api: MockApi;
const riderMe = (over: Record<string, unknown>) => ({ status: 200, body: { data: { ...payload('rider_me'), ...over } } });

beforeEach(() => {
  clearScreens();
  for (const name of ['signIn', 'splash', 'trip', 'application', 'suspended', 'terminal'] as const) {
    registerScreen(name, { component: probe(name) });
  }
  registerScreen('home', { component: () => <TabProbe name="home" /> });
});

afterEach(() => {
  api?.restore();
  act(() => setToken(null));
});

it('cold start with no token shows sign-in', () => {
  api = mockApi();
  render(<SessionGate />);
  expect(screen.getByTestId('route').props.children).toBe('signIn {}');
});

it.each([
  ['HOME', 'home tab=home me=HOME'],
  ['ONBOARDING_DOCUMENTS', 'application {"step":"documents"}'],
  ['SUSPENDED', 'suspended null'],
  ['APP_UPDATE_REQUIRED', 'terminal {"kind":"update"}'],
])('signed in, next_route %s routes to its screen', async (route, shown) => {
  api = mockApi({ getRiderMe: riderMe({ next_route: route, account_status: 'ACTIVE', active_assignment_id: null }) });
  act(() => setToken('t', 'r'));
  render(<SessionGate />);
  expect(screen.getByTestId('route').props.children).toMatch(/^splash/);
  await waitFor(() => expect(screen.getByTestId('route').props.children).toBe(shown));
});

it('ACTIVE_DELIVERY opens the trip flow over the tabs', async () => {
  api = mockApi({ getRiderMe: riderMe({ next_route: 'ACTIVE_DELIVERY', account_status: 'ACTIVE', active_assignment_id: 'a-1' }) });
  act(() => setToken('t', 'r'));
  render(<SessionGate />);
  await waitFor(() => expect(screen.getByTestId('route').props.children).toBe('trip {"assignmentId":"a-1"}'));
  expect(screen.queryByTestId('tab-home')).toBeNull(); // BottomNav hidden during a flow
});

it('a failed getRiderMe shows the splash error, and Try again re-reads it', async () => {
  api = mockApi({ getRiderMe: (_c, nth) => (nth === 0 ? 'offline' : riderMe({ next_route: 'HOME', account_status: 'ACTIVE' })) });
  act(() => setToken('t', 'r'));
  render(<SessionGate />);
  await waitFor(() => expect(screen.getByTestId('route').props.children).toBe('splash {"phase":"error"}'));
  expect(api.callsTo('getRiderMe')).toHaveLength(1);
});

it('a session that ends under the rider shows "signed out" and keeps queued steps; signing out on purpose does not', async () => {
  api = mockApi({
    getRiderMe: riderMe({ next_route: 'HOME', account_status: 'ACTIVE' }),
    createAssignmentTransition: 'offline',
  });
  act(() => setToken('t', 'r'));
  await outbox.send('a-1', { to_state: 'ARRIVED_AT_PICKUP' });
  render(<SessionGate />);
  await waitFor(() => expect(screen.getByTestId('route').props.children).toMatch(/^home/));

  act(() => setToken(null)); // refresh failed
  expect(screen.getByTestId('route').props.children).toBe('signIn {"reason":"signed-out"}');
  expect(outbox.snapshot()).toHaveLength(1);

  act(() => setToken('t', 'r'));
  await waitFor(() => expect(screen.getByTestId('route').props.children).toMatch(/^home/));
  act(() => signOut());
  expect(screen.getByTestId('route').props.children).toBe('signIn {}');
  await outbox.clearAssignment('a-1');
});

it('the phone in dark mode renders dark tokens', () => {
  const spy = jest.spyOn(RN, 'useColorScheme');
  let seen: { light?: string; dark?: string } = {};
  function Swatch({ k }: { k: 'light' | 'dark' }) {
    seen[k] = useTheme().color.surface.base;
    return null;
  }
  spy.mockReturnValue('light');
  render(
    <RedesignRoot>
      <Swatch k="light" />
    </RedesignRoot>,
  );
  spy.mockReturnValue('dark');
  render(
    <RedesignRoot>
      <Swatch k="dark" />
    </RedesignRoot>,
  );
  spy.mockRestore();
  expect(seen.light).toBeTruthy();
  expect(seen.dark).toBeTruthy();
  expect(seen.dark).not.toBe(seen.light);
});
