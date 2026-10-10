/**
 * Shared set-up for the drop-off and proof tests: WP4's trip harness (module mocks, the trip flow
 * render, transition helpers), plus the camera, the storage PUT and the answers this leg needs.
 *
 * Import this file first in a test file: its `jest.mock` calls must run before the screens load.
 *
 * Answers the contract's fixtures do not have yet are literals derived from real fixtures, each
 * filed as a fixture request in the PR. The delivery-code errors are copied verbatim from contract
 * PR #290 (`contracts/fixtures/error_delivery_code_{incorrect,locked}.json` there); they land with
 * #290 and these literals then become `mockApi` scenario names.
 */
import * as React from 'react';
import { Text } from 'react-native';

jest.mock('../../../capture', () => ({ captureImage: jest.fn() }));

import { ID, apiError, renderTrip, type Answer } from '../../trip/__tests__/harness';
import { captureImage, type CaptureOutcome } from '../../../capture';
import { useNav } from '../../nav/Navigator';
import { registerScreen, type ScreenProps } from '../../nav/registry';
import type { MockApi, ScenarioChoice } from '../../test/mockApi';
import { payload } from '../../test/mockApi';
import type { Scheme } from '../../test/render';
import { resetDropoffState } from '..';

export { ID, apiError, goOffline, keys, transitions } from '../../trip/__tests__/harness';
export type { Answer } from '../../trip/__tests__/harness';

/** `assignment_<state>` with top-level and drop-off fields changed (a state the fixtures lack: filed). */
export function withDropoff(scenario: string, over: Record<string, unknown> = {}, dropoff: Record<string, unknown> = {}): Answer {
  const base = payload(scenario);
  return { status: 200, body: { data: { ...base, ...over, dropoff: { ...base.dropoff, ...dropoff } } } };
}

/** The proof's 200 as a server that has not committed DELIVERED yet returns it: proof recorded. */
export const PROOF_RECORDED = (scenario = 'assignment_arrived_at_dropoff') => withDropoff(scenario, { pod_recorded: true });

/** `assignment_arrived_at_dropoff` with `required_pod_method: PHOTO_WITH_ATTESTATION` (filed). */
export const ATTESTATION_ASSIGNMENT = withDropoff('assignment_arrived_at_dropoff', { required_pod_method: 'PHOTO_WITH_ATTESTATION' });

/** Verbatim from #290 `error_delivery_code_incorrect.json` (422). */
export const DELIVERY_CODE_INCORRECT: Answer = {
  status: 422,
  body: {
    error: {
      code: 'DELIVERY_CODE_INCORRECT',
      message: 'That delivery code is not right. 2 attempts remaining.',
      request_id: 'TBY6JES0NYSV3AR3GY6989AKRY',
      details: { attempts_remaining: 2 },
    },
  },
};

/** Verbatim from #290 `error_delivery_code_locked.json` (423). */
export const DELIVERY_CODE_LOCKED: Answer = {
  status: 423,
  body: {
    error: {
      code: 'DELIVERY_CODE_LOCKED',
      message: 'Too many wrong codes. HalalGoes support is taking over this delivery; please stay with the order.',
      request_id: '9JSEBKQ9PBDC20C8T2RH984WVP',
    },
  },
};

export const POD_REQUIRED = (required = 'PHOTO') => apiError(422, 'POD_REQUIRED', { required_pod_method: required });

/** `earning_entries_mixed` with its DELIVERY and TIP lines on this delivery (filed). */
export function entriesFor(assignmentId: string = ID): Answer {
  const lines = payload<{ type: string; assignment_id: string | null }[]>('earning_entries_mixed').map((e) =>
    e.type === 'DELIVERY' || e.type === 'TIP' ? { ...e, assignment_id: assignmentId } : e,
  );
  return { status: 200, body: { data: lines, meta: { next_cursor: null, has_more: false, total: lines.length } } };
}

/* ------------------------------------------------------------------ the camera */

const capture = captureImage as jest.MockedFunction<typeof captureImage>;

/** A tiny JPEG-shaped capture: the bytes the upload declares and sends. */
export const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xff, 0xd9]);

export function cameraGives(...outcomes: CaptureOutcome[]): jest.MockedFunction<typeof captureImage> {
  capture.mockReset();
  for (const o of outcomes) capture.mockResolvedValueOnce(o);
  return capture;
}

export const SHOT: CaptureOutcome = {
  ok: true,
  image: { bytes: PHOTO_BYTES, contentType: 'image/jpeg', sha256: (hex) => hex(PHOTO_BYTES) },
};
export const CAMERA_DENIED: CaptureOutcome = { ok: false, reason: 'PERMISSION_DENIED', message: 'denied' };

/* ------------------------------------------------------------------ the presigned PUT */

/** The PUT to the presigned URL is not our API: answer it here, and record it. */
export function storage(api: MockApi, answer: (nth: number) => 'ok' | 'fail' | 'offline' = () => 'ok') {
  const puts: { url: string; headers: Record<string, string>; size: number }[] = [];
  const spy = globalThis.fetch as unknown as jest.Mock;
  const api_ = spy.getMockImplementation()!;
  spy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://cdn.halalgoes.ca/')) return api_(input, init);
    const outcome = answer(puts.length);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    puts.push({ url, headers, size: (init?.body as Uint8Array | undefined)?.byteLength ?? 0 });
    if (outcome === 'offline') throw new TypeError('Network request failed');
    return new Response(null, { status: outcome === 'ok' ? 200 : 500 });
  });
  return { puts, api };
}

/* ------------------------------------------------------------------ WP6 routes */

/** Something's wrong and the return leg are WP6: a probe shows the route and its params. */
function Wp6Probe({ params }: ScreenProps<'tripException'> | ScreenProps<'tripReturn'>) {
  const nav = useNav();
  return (
    <>
      <Text testID="wp6-probe">{`${nav.current.name}:${JSON.stringify(params)}`}</Text>
      {/* WP6's "Back to the delivery": the step under it opens again. */}
      <Text testID="wp6-back" onPress={() => nav.pop()}>
        Back to the delivery
      </Text>
    </>
  );
}
registerScreen('tripException', { component: Wp6Probe, back: 'pop' });
registerScreen('tripReturn', { component: Wp6Probe, back: 'none' });

/* ------------------------------------------------------------------ render */

/** Open the trip on `scenario` (or a literal) for `getAssignment`, plus any other choices. */
export function renderDropoff(scheme: Scheme, getAssignment: ScenarioChoice, choices: Record<string, ScenarioChoice> = {}) {
  return renderTrip(scheme, { getAssignment, ...choices });
}

beforeEach(() => {
  resetDropoffState();
  capture.mockReset();
});
