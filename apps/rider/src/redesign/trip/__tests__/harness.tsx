/**
 * Shared set-up for the trip screen tests: module mocks, fixture-derived answers, and a render
 * of the redesign navigator with the trip flow open.
 *
 * Import this file first in a test file: its `jest.mock` calls must run before the screens load.
 *
 * Answers the contract's fixtures do not have yet are literals derived from real fixtures, each
 * filed as a fixture request in the PR. The pickup-code errors are the contract's own fixtures
 * (#290).
 */
import * as React from 'react';
import { AppState, Linking, Text } from 'react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
}));
jest.mock('../../../push', () => ({ registerForPush: jest.fn(async () => undefined), unregisterForPush: jest.fn() }));
jest.mock('../../../location', () => ({
  ...jest.requireActual('../../../location'),
  getFreshFix: jest.fn(async () => ({
    ok: true,
    fix: { latitude: 43.6817, longitude: -79.3403, accuracy_m: 6, recorded_at: '2026-10-09T21:40:00.000Z' },
  })),
}));

import { resetConnectivity } from '../../data/connectivity';
import { outbox } from '../../data/outbox';
import { memoryStore } from '../../data/storage';
import { useNav } from '../../nav/Navigator';
import { registerScreen, type ScreenProps } from '../../nav/registry';
import { ScreenView } from '../../nav/Shell';
import { fixture, mockApi, payload, type MockApi, type ScenarioChoice } from '../../test/mockApi';
import { renderRedesign, type Scheme } from '../../test/render';
import { resetTripState } from '../assignment';
import { SavedStepLayer } from '../TripScreens';
import '..';

/** The fixtures' assignment id (all `assignment_*` fixtures share it). */
export const ID = payload('assignment_en_route_to_pickup').id as string;

export type Answer = { status: number; body: unknown };

/** `assignment_<state>` with fields changed: a state the fixture set lacks (filed). */
export function assignment(scenario: string, over: Record<string, unknown> = {}, pickup: Record<string, unknown> = {}): Answer {
  const base = payload(scenario);
  return { status: 200, body: { data: { ...base, ...over, pickup: { ...base.pickup, ...pickup } } } };
}

/** An error envelope shaped like the real `error_validation_failed` fixture, with another code. */
export function apiError(status: number, code: string, details?: Record<string, unknown>): Answer {
  const p = payload('error_validation_failed');
  p.error = { ...p.error, code, message: code, details };
  return { status, body: p };
}

/** A contract error fixture as a mockApi answer. */
function errorFixture(scenario: string): Answer {
  const f = fixture(scenario);
  return { status: f.status, body: f.payload };
}

/** `error_pickup_code_incorrect` (422, 3 attempts remaining) and `error_pickup_code_locked` (423). */
export const PICKUP_CODE_INCORRECT: Answer = errorFixture('error_pickup_code_incorrect');
export const PICKUP_CODE_LOCKED: Answer = errorFixture('error_pickup_code_locked');

export const GEOFENCE_REQUIRED = () => apiError(422, 'GEOFENCE_REQUIRED');
export const INVALID_TRANSITION = (current: string) => apiError(409, 'INVALID_TRANSITION', { current_state: current });

/** `public_config` with phone support switched off (the `*-NoSupport` boards). */
export const SUPPORT_OFF: Answer = { status: 200, body: { data: { ...payload('public_config'), support_enabled: false } } };

/** Drop-off and endings are WP5/WP6: a probe stands in so a test can see the route it reached. */
function RouteProbe({ params }: ScreenProps<'tripDropoff'> | ScreenProps<'tripEnded'>) {
  const nav = useNav();
  return <Text testID="route-probe">{`${nav.current.name}:${params.assignmentId}`}</Text>;
}
registerScreen('tripDropoff', { component: RouteProbe, back: 'none' });
registerScreen('tripEnded', { component: RouteProbe, back: 'none' });

function Current(): React.ReactElement {
  const nav = useNav();
  return (
    <>
      <ScreenView key={nav.current.key} entry={nav.current} />
      <SavedStepLayer />
    </>
  );
}

export interface TripTest {
  api: MockApi;
  openURL: jest.SpyInstance;
}

let current: TripTest | null = null;

/** Open the trip flow on `assignmentId` (or `null`: the gate's cold start) against `choices`. */
export function renderTrip(scheme: Scheme, choices: Record<string, ScenarioChoice>, assignmentId: string | null = ID) {
  const api = mockApi({ getPublicConfig: 'public_config', ...choices });
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  current = { api, openURL };
  const utils = renderRedesign(<Current />, { scheme, nav: { initialFlow: { name: 'trip', params: { assignmentId } } } });
  return { ...utils, api, openURL };
}

beforeEach(() => {
  // The jest preset leaves `AppState.currentState` a mock function, which reads as "not in the
  // foreground" and pauses every poll: the phone is in the rider's hand here.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  resetTripState();
  outbox.useStore(memoryStore());
});

afterEach(() => {
  current?.api.restore();
  current?.openURL.mockRestore();
  current = null;
  resetConnectivity();
});

/** The phone loses signal: every read fails as well as the step (a real dead zone). */
export function goOffline(api: MockApi): void {
  for (const op of ['getAssignment', 'getPublicConfig', 'getRiderMe', 'getRiderDashboard']) api.set(op, 'offline');
}

/** Every transition body the screens sent. */
export function transitions(api: MockApi): Record<string, unknown>[] {
  return api.callsTo('createAssignmentTransition').map((c) => c.body as Record<string, unknown>);
}

export function keys(api: MockApi): string[] {
  return api.callsTo('createAssignmentTransition').map((c) => c.headers['idempotency-key']!);
}
