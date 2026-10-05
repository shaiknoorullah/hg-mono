import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { FakeRealtimeSocket as FakeSocket, installDomShims } from '@hg/ui-web/testing';
import { RealtimeProvider } from '@hg/ui-web/live';

import { RiderApproachMap } from '../src/components/RiderApproachMap';

/**
 * The "rider approaching" map listens on the order's channel: a dispatch event refetches the
 * order (events are signals, REST is the truth) and "Rider arrived" shows on AT_RESTAURANT.
 * With the socket down it says the live position is paused rather than freezing silently —
 * the restaurant has no REST read of the rider's position to fall back to.
 */

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
    await act(async () => socket.open());
    expect(socket.sent).toContainEqual({ type: 'subscribe', channel: 'order:o1' });
    expect(screen.getByText(/Yusuf K\. · Bicycle/)).toBeTruthy();

    await act(async () => {
      socket.push({
        id: 'e1',
        seq: 1,
        channel: 'order:o1',
        type: 'dispatch.state_changed',
        data: { order_id: 'o1', from: 'ASSIGNED', to: 'AT_RESTAURANT', at: '2026-10-05T12:00:00Z' },
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
