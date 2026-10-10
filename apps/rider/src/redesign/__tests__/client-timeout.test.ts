/**
 * The API client has a deadline: a request with no answer in 20 s is a lost connection, not a
 * spinner forever. It reads as the offline copy, marks the app offline, and a step that times
 * out is queued for replay under the same Idempotency-Key.
 */
import { HgTransportError, unwrap } from '@hg/api-client';

import { REQUEST_TIMEOUT_MS, rider, trackedFetchWithin } from '../data/client';
import { isOnline, resetConnectivity } from '../data/connectivity';
import { OFFLINE, toRiderError } from '../data/errors';
import { Outbox } from '../data/outbox';
import { memoryStore } from '../data/storage';
import { mockApi, type MockApi } from '../test/mockApi';

let api: MockApi | null = null;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  api?.restore();
  api = null;
  jest.useRealTimers();
  resetConnectivity();
});

const getMe = () => unwrap(rider.GET('/v1/riders/me'));

it('a request with no answer fails at 20 s as a transport failure, with the offline copy', async () => {
  api = mockApi({ getRiderMe: 'pending' });
  const failure = getMe().catch((e: unknown) => e);
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
  expect(isOnline()).toBe(true); // not yet
  await jest.advanceTimersByTimeAsync(1);
  const e = await failure;
  expect(REQUEST_TIMEOUT_MS).toBe(20_000);
  expect(e).toBeInstanceOf(HgTransportError);
  const shown = toRiderError(e);
  expect(shown).toMatchObject({ kind: 'offline', title: OFFLINE.title, message: OFFLINE.message, retryable: true });
  expect(isOnline()).toBe(false);
  expect(api.callsTo('getRiderMe')).toHaveLength(1); // aborted, never retried behind the rider's back
});

it('an answer inside the deadline is untouched, and the deadline is cleared', async () => {
  api = mockApi({ getRiderMe: 'rider_me' });
  const me = await getMe();
  expect(me.data).toBeDefined();
  expect(jest.getTimerCount()).toBe(0);
  expect(isOnline()).toBe(true);
});

it('one call can wait longer by passing its own deadline', async () => {
  api = mockApi({ getRiderMe: 'pending' });
  let settled = false;
  const slow = unwrap(rider.GET('/v1/riders/me', { fetch: trackedFetchWithin(60_000) })).catch((e: unknown) => {
    settled = true;
    return e;
  });
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(await slow).toBeInstanceOf(HgTransportError);
});

it('a step that times out is queued, and replays with the same Idempotency-Key', async () => {
  api = mockApi({ createAssignmentTransition: (_call, nth) => (nth === 0 ? 'pending' : 'assignment_arrived_at_pickup') });
  const box = new Outbox(memoryStore());
  const sent = box.send('a-1', { to_state: 'ARRIVED_AT_PICKUP' });
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
  const r = await sent;
  expect(r.queued).toBe(true);
  expect(box.snapshot()).toHaveLength(1);

  await box.drain();
  const calls = api.callsTo('createAssignmentTransition');
  expect(calls).toHaveLength(2);
  expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
  expect(calls[1]!.body).toEqual(calls[0]!.body);
  expect(box.snapshot()).toHaveLength(0);
});
