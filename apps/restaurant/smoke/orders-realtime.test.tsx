import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { FakeRealtimeSocket as FakeSocket, installDomShims } from '@hg/ui-web/testing';
import { RealtimeProvider } from '@hg/ui-web/live';

import queueBusy from '../../../contracts/fixtures/orders/restaurant_order_queue_busy.json';
import profile from '../../../contracts/fixtures/onboarding/restaurant_profile.json';

/**
 * The order queue on the socket: an offer on `restaurant:{id}` refetches the queue over REST
 * at once (events are signals, REST is the truth). The socket only makes updates sooner — with
 * it down, the 7-second polling still refreshes the queue and the page says so quietly.
 */

function stubOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Answers the profile and the queue; returns how many times the queue was read. */
function stubServer() {
  const queueReads = { count: 0 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/v1/restaurant/profile')) return stubOk({ data: profile.payload });
    if (url.includes('/v1/restaurant/orders')) {
      queueReads.count++;
      return stubOk({ data: queueBusy.payload, meta: { next_cursor: null, has_more: false, total: queueBusy.payload.length } });
    }
    return new Response(null, { status: 404 });
  });
  return queueReads;
}

describe('restaurant order queue — realtime with polling fallback', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('refetches the queue when an order offer arrives on the restaurant channel', async () => {
    const queueReads = stubServer();
    const sockets: FakeSocket[] = [];
    const { OrdersPage } = await import('../src/routes/OrdersPage');
    render(
      <RealtimeProvider
        client="restaurant-web"
        mintTicket={async () => ({ ticket: 't', websocket_url: 'ws://test/v1/ws' })}
        createSocket={() => {
          const s = new FakeSocket();
          sockets.push(s);
          return s;
        }}
      >
        <OrdersPage />
      </RealtimeProvider>,
    );
    await screen.findByText('Live orders');
    const socket = sockets[0]!;
    await act(async () => socket.open());
    const channel = `restaurant:${profile.payload.id}`;
    expect(socket.sent).toContainEqual({ type: 'subscribe', channel });
    await act(async () => {});
    const before = queueReads.count;

    await act(async () => {
      socket.push({
        id: 'e1',
        seq: 1,
        channel,
        type: 'restaurant.order_offered',
        data: { order_id: 'o-new' },
      });
    });
    expect(queueReads.count).toBe(before + 1);
    expect(screen.queryByText(/Live updates paused/)).toBeNull();
  });

  it('keeps polling every 7 seconds when the socket is down', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const queueReads = stubServer();
    const { OrdersPage } = await import('../src/routes/OrdersPage');
    // No provider: the socket never connects.
    render(<OrdersPage />);
    await act(async () => {});
    await screen.findByText('Live orders');
    expect(screen.getByText('Live updates paused, refreshing every few seconds.')).toBeTruthy();
    const before = queueReads.count;

    await act(async () => {
      vi.advanceTimersByTime(7_000);
    });
    expect(queueReads.count).toBe(before + 1);
  });
});
