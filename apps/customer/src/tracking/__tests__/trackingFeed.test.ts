/**
 * The live-tracking state machine: socket fixes and REST polls feed one snapshot, and REST polling
 * every 5 s covers whenever the socket is down (contracts/websocket.md, client rules 7-8).
 */
import type { RiderLocationData } from '@hg/api-client';

import type { OrderTracking } from '../../api/orders';
import {
  POLL_MS,
  boundsOf,
  createTrackingFeed,
  lerpPoint,
  staleSeconds,
  type TrackingFeedDeps,
} from '../trackingFeed';

const T0 = Date.parse('2026-10-06T12:00:00.000Z');

function tracking(over: Partial<OrderTracking> = {}): OrderTracking {
  return {
    order_id: 'o1',
    state: 'PICKED_UP',
    restaurant_location: { latitude: 43.65, longitude: -79.38 },
    destination_location: { latitude: 43.7, longitude: -79.4 },
    rider_location: null,
    ...over,
  } as OrderTracking;
}

const restFix = (lat: number, at: number) =>
  ({ latitude: lat, longitude: -79.39, recorded_at: new Date(at).toISOString() }) as never;

const sockFix = (lat: number, at: number): RiderLocationData => ({
  order_id: 'o1',
  lat,
  lng: -79.39,
  heading_deg: 90,
  speed_mps: 5,
  accuracy_m: 8,
  recorded_at: new Date(at).toISOString(),
});

function setup(initial = tracking()) {
  const fetchTracking = jest.fn<Promise<OrderTracking>, []>().mockResolvedValue(initial);
  let handlers!: Parameters<TrackingFeedDeps['openSocket']>[0];
  const closeSocket = jest.fn();
  const feed = createTrackingFeed({
    fetchTracking,
    openSocket: (h) => {
      handlers = h;
      return closeSocket;
    },
  });
  return { feed, fetchTracking, closeSocket, handlers: () => handlers };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('polls the tracking endpoint every 5 s while the socket is not open', async () => {
  const { feed, fetchTracking } = setup();
  feed.start();
  await flush();
  expect(fetchTracking).toHaveBeenCalledTimes(1);
  expect(feed.getSnapshot().link).toBe('polling');

  for (let n = 2; n <= 4; n++) {
    await jest.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchTracking).toHaveBeenCalledTimes(n);
  }
  feed.stop();
});

test('stops polling once the socket is open, and uses its fixes', async () => {
  const { feed, fetchTracking, handlers } = setup();
  feed.start();
  await flush();
  handlers().onLink(true);
  await flush();
  expect(feed.getSnapshot().link).toBe('live');
  const calls = fetchTracking.mock.calls.length; // one catch-up read on open

  await jest.advanceTimersByTimeAsync(POLL_MS * 3);
  expect(fetchTracking).toHaveBeenCalledTimes(calls);

  handlers().onRiderLocation(sockFix(43.66, T0));
  expect(feed.getSnapshot().rider).toMatchObject({ latitude: 43.66, headingDeg: 90, recordedAtMs: T0 });
  feed.stop();
});

test('falls back to polling when the socket drops', async () => {
  const { feed, fetchTracking, handlers } = setup();
  feed.start();
  await flush();
  handlers().onLink(true);
  await flush();
  const calls = fetchTracking.mock.calls.length;

  handlers().onLink(false);
  expect(feed.getSnapshot().link).toBe('polling');
  await jest.advanceTimersByTimeAsync(POLL_MS);
  expect(fetchTracking).toHaveBeenCalledTimes(calls + 1);
  feed.stop();
});

test('REST and socket render identically: the newest fix wins, an older one never rewinds the rider', async () => {
  const { feed, handlers } = setup(tracking({ rider_location: restFix(43.66, T0) }));
  feed.start();
  await flush();
  expect(feed.getSnapshot().rider?.latitude).toBe(43.66);

  handlers().onRiderLocation(sockFix(43.67, T0 + 5_000));
  expect(feed.getSnapshot().rider?.latitude).toBe(43.67);

  handlers().onRiderLocation(sockFix(43.5, T0 - 60_000)); // delayed, older
  expect(feed.getSnapshot().rider?.latitude).toBe(43.67);
  feed.stop();
});

test('a malformed socket fix is ignored', async () => {
  const { feed, handlers } = setup();
  feed.start();
  await flush();
  handlers().onRiderLocation({ ...sockFix(1, T0), recorded_at: 'not a date' });
  handlers().onRiderLocation({ ...sockFix(1, T0), lat: Number.NaN });
  expect(feed.getSnapshot().rider).toBeNull();
  feed.stop();
});

test('stops polling when the order is finished', async () => {
  const { feed, fetchTracking } = setup(tracking({ state: 'DELIVERED' }));
  feed.start();
  await flush();
  await jest.advanceTimersByTimeAsync(POLL_MS * 3);
  expect(fetchTracking).toHaveBeenCalledTimes(1);
  feed.stop();
});

test('a failed first fetch is an error state that retry() clears and refetches', async () => {
  const { feed, fetchTracking } = setup();
  fetchTracking.mockRejectedValueOnce(new Error('offline'));
  feed.start();
  await flush();
  expect(feed.getSnapshot()).toMatchObject({ error: true, tracking: null });

  feed.retry();
  await flush();
  expect(feed.getSnapshot()).toMatchObject({ error: false });
  expect(feed.getSnapshot().tracking).not.toBeNull();
  feed.stop();
});

test('stop closes the socket and cancels the poll timer', async () => {
  const { feed, fetchTracking, closeSocket } = setup();
  feed.start();
  await flush();
  feed.stop();
  expect(closeSocket).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(POLL_MS * 3);
  expect(fetchTracking).toHaveBeenCalledTimes(1);
});

test('"updated Ns ago" only once a fix is more than 30 s old', () => {
  const fix = { latitude: 1, longitude: 1, headingDeg: null, recordedAtMs: T0 };
  expect(staleSeconds(null, T0)).toBeNull();
  expect(staleSeconds(fix, T0 + 30_000)).toBeNull();
  expect(staleSeconds(fix, T0 + 47_900)).toBe(47);
});

test('lerpPoint glides and clamps; boundsOf boxes every known point in [lng, lat]', () => {
  const a = { latitude: 0, longitude: 0 };
  const b = { latitude: 10, longitude: -20 };
  expect(lerpPoint(a, b, 0.5)).toEqual({ latitude: 5, longitude: -10 });
  expect(lerpPoint(a, b, 3)).toEqual(b);
  expect(boundsOf([a, null, b, undefined])).toEqual({ sw: [-20, 0], ne: [0, 10] });
  expect(boundsOf([null])).toBeNull();
});
