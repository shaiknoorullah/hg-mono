/**
 * In a capture build, a capture link signs the fixture session in and the navigator opens the
 * named screen under the named scenario; the session gate still decides from `getRiderMe`.
 */
import * as React from 'react';
import { Linking, Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});
// A capture build: the real entry in place of the flag-guarded `captureEntry` (the flag is a
// build-time constant, and jest builds without it).
jest.mock('../index', () => ({ captureEntry: jest.requireActual('../entry') }));

import { setMockScenario } from '../../../mockScenario';
import { setToken } from '../../../token';
import { clearScreens, registerScreen, type ScreenProps } from '../../nav/registry';
import { useNav } from '../../nav/Navigator';
import { SessionGate } from '../../session/Session';
import { mockApi, type MockApi } from '../../test/mockApi';
import { CaptureLink } from '../entry';
import { restoreClock } from '@hg/api-client/capture';

declare module '../../nav/routes' {
  interface RedesignRoutes {
    captureProbe: { id: string };
  }
}

const FROZEN = '2026-08-10T18:42:11.412Z';

function Probe({ params }: ScreenProps<'captureProbe'>) {
  const nav = useNav();
  return <Text testID="route">{`captureProbe ${params.id} tab=${nav.tab} depth=${nav.stack.length}`}</Text>;
}

let api: MockApi;

beforeEach(() => {
  clearScreens();
  for (const name of ['signIn', 'splash', 'trip', 'application', 'suspended', 'terminal'] as const) {
    registerScreen(name, { component: () => <Text testID="route">{name}</Text> });
  }
  registerScreen('home', { component: () => <Text testID="route">home</Text> });
  registerScreen('captureProbe', { component: Probe });
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(Linking, 'addEventListener').mockReturnValue({ remove: () => {} } as never);
});

afterEach(() => {
  api?.restore();
  restoreClock();
  setMockScenario(undefined);
  act(() => setToken(null));
  jest.restoreAllMocks();
});

it('opens the named screen, signed in, under the named scenario', async () => {
  api = mockApi();
  jest
    .spyOn(Linking, 'getInitialURL')
    .mockResolvedValue(
      `hgrider://__capture?${new URLSearchParams({
        board: 'shift-offers/Probe',
        route: 'captureProbe',
        params: '{"id":"a1"}',
        scenario: 'getRiderMe=rider_me',
        clock: FROZEN,
      })}`,
    );

  render(
    <>
      <CaptureLink />
      <SessionGate />
    </>,
  );

  await waitFor(() => expect(screen.getByTestId('route').props.children).toBe('captureProbe a1 tab=home depth=2'));
  const sent = api.callsTo('getRiderMe')[0]!;
  expect(sent.headers['x-mock-scenario']).toBe('getRiderMe=rider_me');
});

it('a link for a screen that does not exist leaves the app signed out on sign-in', async () => {
  api = mockApi();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('hgrider://__capture?route=nowhere');
  render(
    <>
      <CaptureLink />
      <SessionGate />
    </>,
  );
  await act(async () => {});
  expect(screen.getByTestId('route').props.children).toBe('signIn');
});
