import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { mockApi, renderRedesign, resetSession } from '../../testing';
import DisputesRoute from '../DisputesRoute';
import OrdersRoute from '../OrdersRoute';
import { disputed, freezeClock, page, summaries } from './support';

beforeEach(() => freezeClock());
afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const renderOrders = (route = '/orders', role: 'ADMIN' | 'SUPPORT_AGENT' = 'ADMIN') =>
  renderRedesign(<Route path="/orders" element={<OrdersRoute />} />, { route, principal: role });
const renderDisputes = (route = '/disputes') => renderRedesign(<Route path="/disputes" element={<DisputesRoute />} />, { route });

const bodyRows = (grid: HTMLElement) => within(grid).getAllByRole('row').slice(1);

describe('Orders', () => {
  it('draws all 14 order states and all four halal states, and no badge where halal is missing', async () => {
    mockApi({ listOrdersAdmin: 'order_admin_list_every_state' });
    renderOrders();
    const grid = await screen.findByRole('grid');
    expect(bodyRows(grid)).toHaveLength(14);
    for (const label of ['Created', 'Payment authorised', 'Waiting for restaurant', 'Preparing', 'Ready for pickup', 'Picked up', 'Rider arrived', 'Delivered', 'Completed', 'Cancelled', 'Rejected by restaurant', 'Failed', 'Disputed', 'Resolved']) {
      expect(within(grid).getByText(label)).toBeTruthy();
    }
    // The resolved order's restaurant has no halal object: plain text, never an optimistic badge.
    expect(within(grid).getByText('No status on file')).toBeTruthy();
    // All four halal states are drawn, and none of them is red.
    const halal = [...grid.querySelectorAll('[data-testid="HalalBadge"]')];
    expect(new Set(halal.map((b) => b.getAttribute('data-halal-render')))).toEqual(new Set(['certified', 'expiring', 'expired', 'unverified']));
    for (const b of halal) expect(b.className).not.toMatch(/danger|(^|[-\s])red([-\s]|$)/);
  });

  it('asks for newest first with no sort and 25 per page, and states are comma-separated', async () => {
    const api = mockApi({ listOrdersAdmin: 'order_admin_list_every_state' });
    renderOrders('/orders?view=running');
    await screen.findByRole('grid');
    const q = api.callsTo('listOrdersAdmin')[0]!.query;
    expect(q['limit']).toBe('25');
    expect(q['state']).toBe('CREATED,AUTHORIZED,RESTAURANT_PENDING,PREPARING,READY_FOR_PICKUP,PICKED_UP,ARRIVED,DELIVERED,DISPUTED');
    expect(q).not.toHaveProperty('sort');
  });

  it('keeps a deadline that has passed honest: 0:00 and what is due, not a stale timer', async () => {
    const rows = summaries().map((r) => (r.state === 'RESTAURANT_PENDING' ? { ...r, deadline_at: new Date(Date.now() - 8000).toISOString() } : r));
    mockApi({ listOrdersAdmin: page(rows) });
    renderOrders();
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText('0:00, passed 8 s ago')).toBeTruthy();
    expect(within(grid).getByText('Due to auto-cancel now. Waiting for the server.')).toBeTruthy();
  });

  it('does not search an invalid code, and says why', async () => {
    const api = mockApi({ listOrdersAdmin: 'order_admin_list_every_state' });
    renderOrders();
    await screen.findByRole('grid');
    fireEvent.change(screen.getByLabelText(/Order code/), { target: { value: 'HG-7Q2L' } });
    expect(await screen.findByText(/too short and has an L, so it wasn’t searched/)).toBeTruthy();
    expect(api.callsTo('listOrdersAdmin').every((c) => !('code' in c.query))).toBe(true);
  });

  it('a lookup that fails is an error with Try again, never "No orders yet"', async () => {
    let n = 0;
    mockApi({ listOrdersAdmin: () => (n++ === 0 ? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x', request_id: '01JTESTREQUEST0000000000000' } } } : undefined) });
    renderOrders();
    expect(await screen.findByText('Orders didn’t load')).toBeTruthy();
    expect(screen.queryByText('No orders yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy());
  });

  it('says a searched code matched nothing, and offers to clear it', async () => {
    mockApi({ listOrdersAdmin: page([]) });
    renderOrders('/orders?code=HG-7Q2M4K');
    expect(await screen.findByText('No order matches HG-7Q2M4K')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Clear filters/ }).length).toBeGreaterThan(0);
  });

  it('when more orders fail to load, the rows already shown stay', async () => {
    // The end of the list scrolls into view as soon as it is observed.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) {}
        observe() {
          this.cb([{ isIntersecting: true }]);
        }
        disconnect() {}
        unobserve() {}
      },
    );
    const all = summaries();
    const api = mockApi({
      listOrdersAdmin: (req) => (req.query['cursor'] ? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x', request_id: '01JTESTREQUEST0000000000000' } } } : page(all, { next_cursor: 'c2', has_more: true })),
    });
    renderOrders();
    const grid = await screen.findByRole('grid');
    expect(await screen.findByText(/More orders didn’t load. The 14 above are unchanged./)).toBeTruthy();
    expect(bodyRows(grid)).toHaveLength(14);
    expect(api.callsTo('listOrdersAdmin').length).toBeGreaterThan(1);
  });
});

describe('Disputes', () => {
  const pageOne = [disputed('HG-9KD2WA', 2500), disputed('HG-3KX7PB', 1400), disputed('HG-8PW3KC', 700)];
  const pageTwo = [disputed('HG-6MH2QD', 150), disputed('HG-5KR2VE', null)];

  it('follows every cursor, then sorts by next deadline with the soonest first', async () => {
    const api = mockApi({
      listOrdersAdmin: (req) => (req.query['cursor'] === 'c2' ? page(pageTwo, { total: 5 }) : page(pageOne, { next_cursor: 'c2', has_more: true, total: 5 })),
    });
    renderDisputes();
    await screen.findByText(/That’s every open dispute: all 5, in deadline order./);
    const grid = screen.getByRole('grid');
    const codes = bodyRows(grid).map((r) => within(r).getAllByRole('gridcell')[0]!.textContent);
    expect(codes).toEqual(['HG-6MH2QD', 'HG-8PW3KC', 'HG-3KX7PB', 'HG-9KD2WA', 'HG-5KR2VE']);
    expect(api.callsTo('listOrdersAdmin').every((c) => c.query['state'] === 'DISPUTED')).toBe(true);
  });

  it('when a page fails, makes no sort claim and says the missing ones may be due sooner', async () => {
    mockApi({
      listOrdersAdmin: (req) => (req.query['cursor'] ? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x', request_id: '01JTESTREQUEST0000000000000' } } } : page(pageOne, { next_cursor: 'c2', has_more: true, total: 5 })),
    });
    renderDisputes();
    expect(await screen.findByText(/aren’t in deadline order and one of the missing ones may be due sooner/)).toBeTruthy();
    const codes = bodyRows(screen.getByRole('grid')).map((r) => within(r).getAllByRole('gridcell')[0]!.textContent);
    expect(codes).toEqual(['HG-9KD2WA', 'HG-3KX7PB', 'HG-8PW3KC']);
  });
});
