import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FakeRealtimeSocket as FakeSocket, installDomShims } from '@hg/ui-web/testing';

import completed from '../../../contracts/fixtures/orders/order_admin_view_completed.json';
import { setToken } from '../src/lib/token';

/**
 * The live operations map: empty when nothing is active; otherwise every active order is
 * followed on its own `order:{id}` channel plus `admin:ops`, a `rider.location` updates that
 * order's rider (the text list beneath the map is its accessible alternative), and a dispatch
 * failure raises a banner.
 */

const recorded = new Date(Date.now() - 5_000).toISOString();
const active = {
  ...completed.payload,
  state: 'PICKED_UP',
  restaurant_location: { latitude: 43.7735, longitude: -79.2577 },
  destination_location: { latitude: 43.78, longitude: -79.25 },
  rider_location: { latitude: 43.775, longitude: -79.255, recorded_at: recorded },
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function renderOps(orders: unknown[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/v1/admin/orders?')) {
      return ok({ data: orders.map((o: any) => ({ id: o.id, code: o.code, state: o.state, restaurant: o.restaurant, total_cents: 0, currency: 'CAD', placed_at: o.placed_at })), meta: { next_cursor: null, has_more: false } });
    }
    if (url.includes('/v1/admin/orders/')) return ok({ data: orders[0] });
    if (url.includes('/v1/realtime/ticket')) return ok({ data: { ticket: 't', expires_at: recorded, websocket_url: 'ws://test/v1/ws', allowed_channels: [] } });
    return ok({ data: null });
  });
  const sockets: FakeSocket[] = [];
  // Imported after `vi.resetModules()` alongside the screen, so both share one realtime context.
  const { LiveOpsScreen } = await import('../src/screens/LiveOpsScreen');
  const { RealtimeProvider } = await import('@hg/ui-web/live');
  render(
    <MemoryRouter>
      <RealtimeProvider
        client="admin-web"
        mintTicket={async () => ({ ticket: 't', websocket_url: 'ws://test/v1/ws' })}
        createSocket={() => {
          const s = new FakeSocket();
          sockets.push(s);
          return s;
        }}
      >
        <LiveOpsScreen />
      </RealtimeProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
  const socket = sockets[0]!;
  await act(async () => socket.open());
  return socket;
}

describe('admin live operations map', () => {
  beforeAll(() => {
    installDomShims();
    setToken('test-token');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('shows the empty state when no order is active', async () => {
    await renderOps([]);
    expect(await screen.findByText('No active orders right now')).toBeTruthy();
  });

  it('follows each active order live and raises a banner on a dispatch failure', async () => {
    const socket = await renderOps([active]);
    expect(await screen.findByText(active.code)).toBeTruthy();
    // One list read, not one per render: useLoad reloads whenever its fetcher changes.
    await act(async () => new Promise((r) => setTimeout(r, 200)));
    const listReads = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('/v1/admin/orders?'));
    expect(listReads).toHaveLength(1);
    expect(screen.getByText(/Bilal S\. — last updated \d+s ago/)).toBeTruthy();
    expect(socket.sent).toContainEqual({ type: 'subscribe', channel: 'admin:ops' });
    expect(socket.sent).toContainEqual({ type: 'subscribe', channel: `order:${active.id}` });

    await act(async () => {
      socket.push({
        id: 'loc1',
        seq: 1,
        channel: `order:${active.id}`,
        type: 'rider.location',
        data: { order_id: active.id, lat: 43.776, lng: -79.254, heading_deg: 90, speed_mps: 6, accuracy_m: 8, recorded_at: new Date().toISOString() },
      });
      socket.push({
        id: 'fail1',
        seq: 1,
        channel: 'admin:ops',
        type: 'admin.dispatch_failure',
        data: { order_id: '0f1e2d3c-0000-4000-8000-000000000000', waves: 3, riders_offered: 9, radius_m: 6000 },
      });
    });
    expect(screen.getByText(/Bilal S\. — last updated 0s ago/)).toBeTruthy();
    expect(screen.getByText('1 order could not find a rider')).toBeTruthy();
  });
});
