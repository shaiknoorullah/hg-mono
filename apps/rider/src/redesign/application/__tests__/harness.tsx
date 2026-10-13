/**
 * What the application tests share: the signed-in app rendered through the real gate (so the
 * hub, the step screens and the session refresh run as they do on a phone), probe screens for
 * the routes other WPs own, and literals built from real fixtures for the states the fixture
 * set lacks (listed as fixture requests in the PR).
 */
import * as React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { setToken } from '../../../token';
import { resetConnectivity } from '../../data/connectivity';
import { clearScreens, registerScreen, type ScreenProps } from '../../nav/registry';
import { SessionGate } from '../../session/Session';
import { mockApi, payload, type Literal, type MockApi, type ScenarioChoice } from '../../test/mockApi';
import { renderRedesign, type Scheme } from '../../test/render';
import { resetApplicationState } from '../data';
import { registerApplication } from '../index';

/** Routes other WPs own: each renders its name and params so a test reads where the app went. */
const WP8 = ['applicationDocuments', 'applicationReview', 'applicationFix'];
const WP9 = ['payouts', 'legalDocument'];

function probe(name: string) {
  return function Probe({ params }: ScreenProps<any>) {
    return <Text testID="route">{`${name} ${JSON.stringify(params ?? null)}`}</Text>;
  };
}

/** `RiderMe` for a rider mid-application, from the real `rider_me` fixture. */
export function riderMe(over: Record<string, unknown> = {}): Literal {
  return {
    status: 200,
    body: {
      data: {
        ...payload('rider_me'),
        onboarding_state: 'PROFILE_PENDING',
        account_status: 'PENDING',
        availability_state: 'OFFLINE',
        active_assignment_id: null,
        vehicle: null,
        next_route: 'ONBOARDING_PROFILE',
        ...over,
      },
    },
  };
}

/** A `getRiderOnboardingStatus` answer: a real fixture with fields changed. */
export function status(scenario: string, over: Record<string, unknown> = {}): Literal {
  return { status: 200, body: { data: { ...payload(scenario), ...over } } };
}

/** An error envelope for a code the fixtures lack, from the real `error_internal_error` shape. */
export function apiError(httpStatus: number, code: string, message: string, details?: unknown): Literal {
  const base = payload('error_internal_error').error;
  return { status: httpStatus, body: { error: { ...base, code, message, ...(details === undefined ? {} : { details }) } } };
}

/** Three of a scooter's four documents added (from `rider_document_pack_complete`; no insurance yet). */
export function scooterDocs(): unknown[] {
  const added = new Set(['DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'PROFILE_PHOTO']);
  return (payload('rider_document_pack_complete') as { doc_type: string }[])
    .filter((d) => added.has(d.doc_type))
    .map((d) => ({ ...d, state: 'SUBMITTED', reviewed_at: null }));
}

export interface StartOptions {
  scheme: Scheme;
  me?: Record<string, unknown>;
  api?: Record<string, ScenarioChoice>;
  /** Register WP9's `payouts` and `legalDocument` (not on main yet). */
  wp9?: boolean;
  /** The phone's time zone. */
  phoneZone?: string | null;
}

let api: MockApi | null = null;
let tzSpy: jest.SpyInstance | null = null;

export function start({ scheme, me, api: choices = {}, wp9 = false, phoneZone = 'America/Toronto' }: StartOptions): MockApi {
  resetApplicationState();
  resetConnectivity();
  clearScreens();
  registerApplication();
  for (const name of ['signIn', ...WP8, ...(wp9 ? WP9 : [])]) registerScreen(name as never, { component: probe(name) });
  tzSpy = jest
    .spyOn(Intl, 'DateTimeFormat')
    .mockImplementation(() => ({ resolvedOptions: () => ({ timeZone: phoneZone ?? undefined }) }) as unknown as Intl.DateTimeFormat);
  api = mockApi({ getRiderMe: riderMe(me), ...choices });
  act(() => setToken('t', 'r'));
  renderRedesign(<SessionGate />, { scheme });
  return api;
}

export function stop(): void {
  api?.restore();
  api = null;
  tzSpy?.mockRestore();
  tzSpy = null;
  act(() => setToken(null));
}

export function route(): string {
  return String(screen.getByTestId('route').props.children);
}

export async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

export function type(testID: string, text: string): void {
  fireEvent.changeText(screen.getByTestId(`${testID}-field`), text);
}

/** Gate → hub (welcome) → "Start with your details". */
export async function openDetails(): Promise<void> {
  await screen.findByText('Start with your details');
  await press('application-next');
  await screen.findByText('Tell us who you are');
}

/** Gate → hub (in progress, vehicle next) → "Continue with how you deliver". */
export async function openVehicle(): Promise<void> {
  await screen.findByText('Continue with how you deliver');
  await press('application-next');
  await screen.findByText(/How will you deliver\?/);
}

/** The requests sent to one operation, as bodies. */
export function bodies(operationId: string): unknown[] {
  return (api?.callsTo(operationId) ?? []).map((c) => c.body);
}

export async function settle(): Promise<void> {
  await waitFor(() => expect(true).toBe(true));
}
