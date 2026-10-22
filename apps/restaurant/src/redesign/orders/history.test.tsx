/**
 * Past orders (restaurant redesign, #658; boards `History*`): every status against the contract
 * fixtures, the chips as server filters, load more (loading, failed, end), every list state, and the read-only panel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, errorBody, fixture, installFakeApi, type FakeResponse, type Handler } from '../test/fakeApi';
import { renderRedesign } from '../test/render';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const past = () => ({
  completed: fixture('restaurant_order_completed'),
  delivered: fixture('restaurant_order_delivered'),
  resolved: fixture('restaurant_order_resolved'),
  rejected: fixture('restaurant_order_rejected'),
  cancelled: fixture('restaurant_order_cancelled'),
  cancelledAfter: fixture('restaurant_order_cancelled_after_accept'),
  disputed: fixture('restaurant_order_disputed'),
});

const envelope = (data: unknown[], next: string | null = null) => ({ envelope: false, body: { data, meta: { next_cursor: next, has_more: next !== null, total: null } } });
const states = (req: Request) => (new URL(req.url).searchParams.get('state') ?? '').split(',').filter(Boolean);
const isPending = (req: Request) => states(req).includes('RESTAURANT_PENDING');

/** The page's list reads (the strip's pending-list reads share the route). */
function pastCalls(api: { callsTo: (route: string) => Request[] }): Request[] {
  return api.callsTo('GET /v1/restaurant/orders').filter((r) => !isPending(r));
}

type Serve = (req: Request, call: number) => FakeResponse | Promise<FakeResponse>;

/** The history list, answered by `serve`; the strip's own read gets nothing waiting. */
function routes(serve: Serve, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return consoleRoutes({
    'GET /v1/restaurant/orders': (req, n) => (isPending(req) ? envelope([]) : serve(req, n)),
    ...extra,
  });
}

const list = (rows: unknown[]): Serve => () => envelope(rows);
const region = () => screen.getByRole('region', { name: 'Past orders' });
const table = () => within(region()).getByRole('grid', { name: /Past orders/ });

describe('Past orders list', () => {
  it('draws every status, with each amount as the server’s cents', async () => {
    const p = past();
    installFakeApi(routes(list(Object.values(p))));
    await renderRedesign('/orders/history');
    const grid = await within(await screen.findByRole('region', { name: 'Past orders' })).findByRole('grid', { name: 'Past orders' });
    for (const label of ['Completed', 'Delivered, settling', 'Resolved', 'Declined', 'Cancelled', 'Disputed']) {
      expect((await within(grid).findAllByText(label)).length).toBeGreaterThan(0);
    }
    // 7987 cents is $79.87: formatted from the integer, not computed.
    expect(within(grid).getAllByText(/79\.87/).length).toBeGreaterThan(0);
    // Orders nobody accepted owe nothing; a cancelled one that was accepted keeps its payout open.
    expect(within(grid).getAllByText('Not charged')).toHaveLength(2);
    expect(within(grid).getAllByText('Payout open')).toHaveLength(2);
  });

  it('asks the server for the past states, 20 at a time, and draws exactly what it sends', async () => {
    const p = past();
    const api = installFakeApi(routes(list([p.completed])));
    await renderRedesign('/orders/history');
    await screen.findByRole('button', { name: p.completed.code });
    const call = new URL(pastCalls(api)[0]!.url);
    expect(call.searchParams.get('state')).toBe('DELIVERED,COMPLETED,RESOLVED,REJECTED,CANCELLED,DISPUTED');
    expect(call.searchParams.get('limit')).toBe('20');
  });

  it('shows the placeholder rows while loading, with the chips already there', async () => {
    installFakeApi(routes(() => new Promise<FakeResponse>(() => undefined)));
    await renderRedesign('/orders/history');
    await screen.findByRole('group', { name: 'Filter past orders' });
    expect(screen.getByTestId('past-orders').getAttribute('data-state')).toBe('loading');
  });

  it('says there is nothing yet, and what will appear', async () => {
    installFakeApi(routes(list([])));
    await renderRedesign('/orders/history');
    expect(await screen.findByText('No past orders yet')).toBeTruthy();
    expect(screen.getByText('Finished, cancelled and declined orders appear here after service.')).toBeTruthy();
  });

  it('says it could not load, keeps the header and chips, and tries again', async () => {
    const p = past();
    let n = 0;
    installFakeApi(routes(() => (++n === 1 ? { status: 500, body: errorBody('INTERNAL') } : envelope([p.completed]))));
    await renderRedesign('/orders/history');
    expect(await screen.findByText(/We couldn’t load past orders/)).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Order' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Filter past orders' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('button', { name: p.completed.code })).toBeTruthy();
  });
});

describe('the chips', () => {
  it('send the chosen status to the server and show only it', async () => {
    const p = past();
    const api = installFakeApi(
      routes((req) => envelope(states(req).length === 1 ? Object.values(p).filter((o: { state: string }) => o.state === states(req)[0]) : Object.values(p))),
    );
    await renderRedesign('/orders/history');
    await screen.findByRole('button', { name: p.rejected.code });
    fireEvent.click(screen.getByRole('button', { name: 'Declined' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: p.completed.code })).toBeNull());
    expect(screen.getByRole('button', { name: p.rejected.code })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Declined' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('grid', { name: 'Past orders: Declined' })).toBeTruthy();
    expect(states(pastCalls(api).at(-1)!)).toEqual(['REJECTED']);
  });

  it('keep Disputed under its own Open issues label', async () => {
    installFakeApi(routes(list([])));
    await renderRedesign('/orders/history');
    const group = await screen.findByRole('group', { name: 'Filter past orders' });
    expect(within(group).getByText('Open issues')).toBeTruthy();
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toContain('Disputed');
  });

  it('say a status is empty, not that nothing ever happened, and offer all orders', async () => {
    const p = past();
    installFakeApi(routes((req) => envelope(states(req).length === 1 ? [] : [p.completed])));
    await renderRedesign('/orders/history');
    await screen.findByRole('button', { name: p.completed.code });
    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(await screen.findByText('No resolved orders')).toBeTruthy();
    expect(screen.getByText('Choose another status, or show all past orders.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all past orders' }));
    expect(await screen.findByRole('button', { name: p.completed.code })).toBeTruthy();
  });
});

describe('load more', () => {
  const page1 = () => [past().completed];
  const page2 = () => [past().rejected];

  it('loads the next page, keeps what is on screen when that fails, and ends the list', async () => {
    let second = 0;
    const api = installFakeApi(
      routes((req) => {
        if (!new URL(req.url).searchParams.get('cursor')) return envelope(page1(), 'c2');
        return ++second === 1 ? { status: 500, body: errorBody('INTERNAL') } : envelope(page2());
      }),
    );
    await renderRedesign('/orders/history');
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    const failed = await screen.findByTestId('load-more-failed');
    expect(within(failed).getByText('We couldn’t load older orders. The ones above are up to date.')).toBeTruthy();
    expect(screen.getByRole('button', { name: past().completed.code })).toBeTruthy();
    fireEvent.click(within(failed).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('That’s every past order so far.')).toBeTruthy();
    expect(screen.getByRole('button', { name: past().rejected.code })).toBeTruthy();
    expect(new URL(pastCalls(api).at(-1)!.url).searchParams.get('cursor')).toBe('c2');
  });
});

describe('a past order beside the list', () => {
  const open = async (o: { id: string; code: string }, serve: Serve) => {
    installFakeApi(routes(serve, { [`GET /v1/restaurant/orders/${o.id}`]: { body: o } }));
    await renderRedesign('/orders/history');
    fireEvent.click(await screen.findByRole('button', { name: o.code }));
    return screen.findByTestId('history-detail');
  };

  it('opens a finished order read-only, with the server’s figures and where it stays', async () => {
    const p = past();
    const panel = await open(p.completed, list(Object.values(p)));
    expect(within(panel).getByTestId('history-badge').textContent).toContain('Completed');
    expect(within(panel).getByText('Order net')).toBeTruthy();
    expect(within(panel).getByText('This order is finished. It stays in History.')).toBeTruthy();
    // Nothing to do to a past order.
    expect(within(panel).queryByRole('button', { name: /mark|ready|accept|decline/i })).toBeNull();
  });

  it('says a declined order was not charged, and shows neither phone nor address', async () => {
    const p = past();
    const panel = await open(p.rejected, list(Object.values(p)));
    expect(within(panel).getByTestId('not-charged').textContent).toContain('Not charged');
    expect(within(panel).getByTestId('history-note').textContent).toBe('Declined');
    expect(within(panel).queryByText(p.rejected.customer.phone_masked)).toBeNull();
  });

  it('tells a cancelled order apart by whether it was accepted, naming no reason the server did not give', async () => {
    const p = past();
    const after = await open(p.cancelledAfter, list(Object.values(p)));
    expect(within(after).getByText('Cancelled after you accepted')).toBeTruthy();
    expect(within(after).getByText('Payout open')).toBeTruthy();
    cleanup();
    const before = await open(p.cancelled, list(Object.values(p)));
    expect(within(before).getByText('Cancelled before it was accepted')).toBeTruthy();
    expect(within(before).getByText('Nothing was prepared. The customer was not charged.')).toBeTruthy();
  });

  it('closes with Close and hands focus back to the row', async () => {
    const p = past();
    const panel = await open(p.completed, list(Object.values(p)));
    fireEvent.click(within(panel).getByRole('button', { name: `Close order ${p.completed.code} details` }));
    await waitFor(() => expect(screen.queryByTestId('history-detail')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: p.completed.code })));
  });

  it('says an order that is not this restaurant’s cannot be shown', async () => {
    const p = past();
    installFakeApi(routes(list(Object.values(p)), { 'GET /v1/restaurant/orders/not-mine': { status: 404, body: errorBody('NOT_FOUND') } }));
    await renderRedesign('/orders/history?order=not-mine');
    expect(await screen.findByText('We can’t show this order')).toBeTruthy();
  });
});
