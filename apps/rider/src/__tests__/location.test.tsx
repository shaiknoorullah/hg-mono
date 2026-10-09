/**
 * Position reporting cadence: every 5 s while the rider holds an active assignment (heading to
 * the restaurant or carrying the order), every 20 s when online and idle, nothing while offline.
 * The 5 s is what moves the rider on the customer's live map, so a regression to 20 s is a
 * tracking map that lags by up to 20 s; this pins it.
 */
import * as React from 'react';
import { act, render } from '@testing-library/react-native';

const mockPost = jest.fn(async (..._args: unknown[]) => ({ data: { data: {} } }));
jest.mock('../api', () => ({ api: { POST: (...args: unknown[]) => mockPost(...args) } }));

const {
  DELIVERY_REPORT_INTERVAL_MS,
  REPORT_INTERVAL_MS,
  reportIntervalMs,
  useLocationReporting,
} = require('../location') as typeof import('../location');

type Ref = import('../location').ActiveAssignmentRef | null;

function Reporter({ online, assignment }: { online: boolean; assignment: Ref }): null {
  useLocationReporting(online, assignment);
  return null;
}

/** Let the in-flight report (permission → fix → POST, all promises) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockPost.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('reportIntervalMs', () => {
  it('is 5 s for every state in which the rider is heading to the restaurant or carrying the order', () => {
    for (const state of [
      'ASSIGNED',
      'EN_ROUTE_TO_PICKUP',
      'ARRIVED_AT_PICKUP',
      'PICKED_UP',
      'EN_ROUTE_TO_DROPOFF',
      'ARRIVED_AT_DROPOFF',
      'RETURNING',
    ] as const) {
      expect(reportIntervalMs({ id: 'a', state })).toBe(5_000);
    }
  });

  it('is 20 s when idle or once the delivery is over', () => {
    expect(reportIntervalMs(null)).toBe(20_000);
    for (const state of ['DELIVERED', 'UNDELIVERABLE', 'RETURNED', 'CANCELLED_BY_PLATFORM', 'REASSIGNED'] as const) {
      expect(reportIntervalMs({ id: 'a', state })).toBe(20_000);
    }
  });
});

describe('useLocationReporting', () => {
  it('reports every 5 s on a delivery, tagged with the assignment, in the contract shape', async () => {
    render(<Reporter online assignment={{ id: 'asg-1', state: 'EN_ROUTE_TO_DROPOFF' }} />);
    await act(flush);
    expect(mockPost).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.advanceTimersByTime(DELIVERY_REPORT_INTERVAL_MS);
        await flush();
      });
    }
    expect(mockPost).toHaveBeenCalledTimes(4);
    const [path, init] = mockPost.mock.calls[0] as [string, { body: { points: Record<string, unknown>[] } }];
    expect(path).toBe('/v1/riders/me/positions');
    const point = init.body.points[0]!;
    expect(point.assignment_id).toBe('asg-1');
    // The device's -1 "unknown" heading and speed are dropped, never sent out of range.
    expect(point).not.toHaveProperty('heading_deg', -1);
    expect(point.heading_deg).toBeUndefined();
    expect(point.speed_mps).toBeUndefined();
  });

  it('reports every 20 s when online and idle', async () => {
    render(<Reporter online assignment={null} />);
    await act(flush);
    await act(async () => {
      jest.advanceTimersByTime(REPORT_INTERVAL_MS - 1);
      await flush();
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
      await flush();
    });
    expect(mockPost).toHaveBeenCalledTimes(2);
    const [, init] = mockPost.mock.calls[0] as [string, { body: { points: Record<string, unknown>[] } }];
    expect(init.body.points[0]!.assignment_id).toBeNull();
  });

  it('sends nothing while offline', async () => {
    render(<Reporter online={false} assignment={{ id: 'asg-1', state: 'PICKED_UP' }} />);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await flush();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
