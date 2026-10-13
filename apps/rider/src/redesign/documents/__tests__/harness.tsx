/**
 * What the WP8 tests share: the signed-in app rendered through the real gate with the WP7 and
 * WP8 screens registered, the presigned PUT answered (it goes to a storage host, not the API),
 * the camera's permission, and literals built from real fixtures for the states the fixture set
 * lacks (each listed as a fixture request in the PR).
 *
 * The WP7 helpers (`riderMe`, `status`, `apiError`, `press`, `type`, `route`) are reused as is.
 */
import * as React from 'react';
import { Text } from 'react-native';
import { act, screen } from '@testing-library/react-native';

import { setToken } from '../../../token';
import { resetConnectivity } from '../../data/connectivity';
import { clearScreens, registerScreen, type ScreenProps } from '../../nav/registry';
import { SessionGate } from '../../session/Session';
import { mockApi, payload, type Literal, type MockApi, type ScenarioChoice } from '../../test/mockApi';
import { renderRedesign, type Scheme } from '../../test/render';
import { resetApplicationState } from '../../application/data';
import { registerApplication } from '../../application/index';
import { press, riderMe } from '../../application/__tests__/harness';
import { resetFixState } from '../FixScreen';
import { registerDocuments } from '../index';
import { resetUploads } from '../uploads';

export { apiError, press, route, status, type } from '../../application/__tests__/harness';

export interface Camera {
  permission: { granted: boolean; canAskAgain: boolean; status: string } | null;
  shots: number;
  fail: boolean;
}

/** The `expo-camera` mock's controls (mocks.ts). */
export const camera: Camera = (require('expo-camera') as { __camera: Camera }).__camera;

export const SCOOTER = { id: 'v-1', vehicle_type: 'SCOOTER', licence_plate: 'CJRA 204', make: 'Honda', model: 'PCX', year: 2021, colour: 'Black', is_active: true };
export const BICYCLE = { id: 'v-2', vehicle_type: 'BICYCLE', licence_plate: null, make: null, model: null, year: null, colour: null, is_active: true };

/** Answers for the presigned PUT, in order; the last repeats. `'offline'` rejects. */
export type PutAnswer = number | 'offline';

export interface StartOptions {
  scheme: Scheme;
  me?: Record<string, unknown>;
  api?: Record<string, ScenarioChoice>;
  put?: PutAnswer[];
  /** Register a probe for WP9's `payouts`. */
  payouts?: boolean;
}

let api: MockApi | null = null;
export const puts: { url: string; method: string; headers: Record<string, string> }[] = [];

function probe(name: string) {
  return function Probe({ params }: ScreenProps<any>) {
    return <Text testID="route">{`${name} ${JSON.stringify(params ?? null)}`}</Text>;
  };
}

export function start({ scheme, me, api: choices = {}, put = [200], payouts = false }: StartOptions): MockApi {
  resetApplicationState();
  resetConnectivity();
  resetUploads();
  resetFixState();
  clearScreens();
  registerApplication();
  registerDocuments();
  registerScreen('signIn', { component: probe('signIn') });
  if (payouts) registerScreen('payouts' as never, { component: probe('payouts') });
  camera.permission = { granted: true, canAskAgain: true, status: 'granted' };
  camera.shots = 0;
  camera.fail = false;
  puts.length = 0;
  api = mockApi({ getRiderMe: riderMe({ vehicle: SCOOTER, next_route: 'ONBOARDING_DOCUMENTS', onboarding_state: 'DOCUMENTS_PENDING', ...me }), ...choices });
  // The presigned PUT goes to the storage host, which is not in the contract: answer it here.
  const spy = globalThis.fetch as jest.Mock;
  const inner = spy.getMockImplementation()!;
  spy.mockImplementation(async (input: any, init?: any) => {
    const req: Request = input instanceof Request ? input : new Request(String(input), init);
    if (!req.url.startsWith('https://cdn.halalgoes.ca/')) return inner(input, init);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const answer = put[Math.min(puts.length, put.length - 1)]!;
    puts.push({ url: req.url, method: req.method, headers });
    if (answer === 'offline') throw new TypeError('Network request failed');
    return new Response(null, { status: answer });
  });
  act(() => setToken('t', 'r'));
  renderRedesign(<SessionGate />, { scheme });
  return api;
}

export function stop(): void {
  api?.restore();
  api = null;
  resetUploads();
  act(() => setToken(null));
}

/** Gate → hub (documents next) → Continue with documents. */
export async function openDocuments(): Promise<void> {
  await screen.findByText('Continue with documents');
  await press('application-next');
  await screen.findByTestId(/^documents(-loading|-load-error)?$/);
}

/** A rider document from the real `rider_document_pack_complete` fixture, with fields changed. */
export function doc(type: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const base = (payload('rider_document_pack_complete') as { doc_type: string }[]).find((d) => d.doc_type === type)!;
  return { ...base, state: 'SUBMITTED', reviewed_at: null, rejection_reason_code: null, review_note: null, ...over };
}

/** A `listRiderDocuments` answer. */
export function docs(...list: Record<string, unknown>[]): Literal {
  return { status: 200, body: { data: list, meta: { next_cursor: null, has_more: false, total: list.length } } };
}

/** All four of a scooter's documents, added and not yet sent. */
export function scooterSet(over: Record<string, unknown> = {}): Record<string, unknown>[] {
  return ['DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE', 'PROFILE_PHOTO'].map((t) => doc(t, over));
}

/** The requests sent to one operation, as bodies. */
export function bodies(operationId: string): unknown[] {
  return (api?.callsTo(operationId) ?? []).map((c) => c.body);
}

export function keys(operationId: string): string[] {
  return (api?.callsTo(operationId) ?? []).map((c) => c.headers['idempotency-key'] ?? '');
}

/** An ISO timestamp `hours` ago. */
export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}
