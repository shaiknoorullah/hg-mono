import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { installDomShims } from '@hg/ui-web/testing';
import { RealtimeProvider, type SocketLike } from '@hg/ui-web/live';

import { RiderApproachMap } from '../src/components/RiderApproachMap';

/**
 * The "rider approaching" map listens on the order's channel: a dispatch event refetches the
 * order (events are signals, REST is the truth) and "Rider arrived" shows on AT_RESTAURANT.
 * With the socket down it says the live position is paused rather than freezing silently —
 * the restaurant has no REST read of the rider's position to fall back to.
 */

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
}

const rider = { display_name: 'Yusuf K.', vehicle_type: 'BICYCLE' as const, photo_url: null, eta_at: null };

describe('restaurant — rider approaching map', () => {
  beforeAll(installDomShims);
  afterEach(cleanup);

  it('subscribes to the order, refetches on dispatch events and shows "Rider arrived"', async () => {
    const sockets: FakeSocket[] = [];
    const onOrderChanged = vi.fn();
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
        <RiderApproachMap orderId="o1" rider={rider} restaurant={null} onOrderChanged={onOrderChanged} />
      </RealtimeProvider>,
    );
    await act(async () => {});
    const socket = sockets[0]!;
    await act(async () => {
      socket.readyState = 1;
      socket.onopen?.({});
    });
    expect(socket.sent).toContainEqual({ type: 'subscribe', channel: 'order:o1' });
    expect(screen.getByText(/Yusuf K\. · Bicycle/)).toBeTruthy();

    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({
          id: 'e1',
          seq: 1,
          channel: 'order:o1',
          type: 'dispatch.state_changed',
          v: 1,
          ts: '2026-10-05T12:00:00Z',
          data: { order_id: 'o1', from: 'ASSIGNED', to: 'AT_RESTAURANT', at: '2026-10-05T12:00:00Z' },
        }),
      });
    });
    expect(screen.getByText('Rider arrived')).toBeTruthy();
    expect(onOrderChanged).toHaveBeenCalledTimes(1);
  });

  it('says the live position is paused when the socket is not open', () => {
    render(<RiderApproachMap orderId="o1" rider={rider} restaurant={null} onOrderChanged={() => {}} />);
    expect(screen.getByText('Live position paused — reconnecting')).toBeTruthy();
  });
});
