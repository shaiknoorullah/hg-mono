/**
 * T9 Orders against the contract's fixtures (WP9 DONE list): Active and Past loaded separately,
 * every row badge on screen, money wording, partial failure keeping the active card, both failed,
 * empty, loading, paging (load more, failed, end), DISPUTED under Active, the row menu without
 * reorder or rating, and dark.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { ORDER_ROW_BADGE } from '../format';
import { OrdersScreen } from '../OrdersScreen';

type OrderSummary = Schema['OrderSummary'];

const T0 = Date.parse('2026-10-09T22:42:00Z');

const activeList = payloadOf<OrderSummary[]>('order_list_active');
const pastList = payloadOf<OrderSummary[]>('order_list_past');
const active = activeList[0]!;

function page(data: OrderSummary[], nextCursor: string | null = null): MockAnswer {
  return { status: 200, body: { data, meta: { next_cursor: nextCursor, has_more: nextCursor !== null, total: null } } };
}

const SERVER_ERROR: MockAnswer = { status: 500, code: 'INTERNAL_ERROR' };

let mock: MockApi;

beforeEach(() => {
  resetConnectivity();
  setNowOverride({ at: T0 });
});

afterEach(() => {
  mock?.restore();
  setNowOverride(null);
});

/** `listOrders` answers in call order: ACTIVE first, then PAST, then whatever follows. */
function renderOrders(listOrders: MockAnswer[], extra: Record<string, MockAnswer> = {}, scheme: 'light' | 'dark' = 'light') {
  mock = mockApi({ listOrders, getOrderTracking: 'tracking_preparing', ...extra });
  const nav = navSpy({ name: 'orders' });
  renderRedesign(<OrdersScreen />, { nav, scheme });
  return nav;
}

const groups = () => mock.callsTo('listOrders').map((c) => new URL(c.url).searchParams);

describe('Orders (T9)', () => {
  it('loads Active and Past separately and pins the active order first', async () => {
    const nav = renderOrders([page(activeList), page(pastList)]);
    expect(await screen.findByText('Active orders')).toBeTruthy();
    expect(await screen.findByText('Past orders')).toBeTruthy();
    expect(groups().map((q) => q.get('status_group'))).toEqual(['ACTIVE', 'PAST']);
    expect(groups().every((q) => !q.has('cursor'))).toBe(true);

    const rows = screen.getAllByTestId(/^OrderRow-[^-]+-[^-]+-[^-]+-[^-]+-[^-]+$/);
    expect(rows[0]!.props.testID).toBe(`OrderRow-${active.id}`);

    // The live card: badge, the static arrival window from tracking, Track and Get help.
    const row = within(screen.getByTestId(`OrderRow-${active.id}`));
    expect(row.getByText('Being prepared')).toBeTruthy();
    expect(row.getByText('3 items · Chicken Biryani, Beef Nihari')).toBeTruthy();
    expect(await row.findByText('2:55–3:05 pm')).toBeTruthy();
    fireEvent.press(row.getByLabelText(`Track order ${active.code} from Karachi Kitchen`));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'tracking', orderId: active.id } });
    expect(row.getByLabelText(`Get help with order ${active.code}`)).toBeTruthy();
    // Orders and receipts carry no halal badge.
    expect(screen.queryByText(/Halal certified/)).toBeNull();
  });

  it('words money per state: only REJECTED and FAILED say "Not charged", no bare totals on cancels', async () => {
    renderOrders([page([]), page(pastList)]);
    await screen.findByText('Past orders');
    for (const o of pastList) {
      const row = within(screen.getByTestId(`OrderRow-${o.id}`));
      if (o.state === 'REJECTED' || o.state === 'FAILED') {
        expect(row.getByText('Not charged')).toBeTruthy();
        expect(row.queryByTestId(`OrderRow-${o.id}-total`)).toBeNull();
      } else if (o.state === 'CANCELLED' || o.state === 'RESOLVED') {
        expect(row.getByText('See details for your money')).toBeTruthy();
        expect(row.queryByTestId(`OrderRow-${o.id}-total`)).toBeNull();
      } else {
        expect(row.getByTestId(`OrderRow-${o.id}-total`)).toBeTruthy();
        expect(row.queryByText('Not charged')).toBeNull();
      }
    }
    expect(screen.getAllByText('Not charged')).toHaveLength(pastList.filter((o) => o.state === 'REJECTED' || o.state === 'FAILED').length);
  });

  it('renders the badge for every one of the fourteen states', async () => {
    const states = Object.keys(ORDER_ROW_BADGE) as Schema['OrderState'][];
    const live = states.filter((s) => !['COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED'].includes(s));
    const ended = states.filter((s) => !live.includes(s));
    const make = (state: Schema['OrderState'], i: number): OrderSummary => ({
      ...active,
      id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
      code: `HG-${state}`,
      state,
      deadline_at: live.includes(state) ? '2026-10-10T00:00:00Z' : null,
    });
    renderOrders([page(live.map(make)), page(ended.map((s, i) => make(s, i + 50)))]);
    await screen.findByText('Past orders');
    for (const s of states) {
      const id = live.includes(s) ? live.indexOf(s) : ended.indexOf(s) + 50;
      const badge = screen.getByTestId(`OrderRow-00000000-0000-4000-8000-0000000000${String(id).padStart(2, '0')}-badge`);
      expect(within(badge).getByText(ORDER_ROW_BADGE[s])).toBeTruthy();
    }
    expect(screen.getAllByText('Not charged')).toHaveLength(2);
  });

  it('lists an order under review under Active, with its answer-by time and Details, not Track', async () => {
    const disputed: OrderSummary = { ...active, state: 'DISPUTED', deadline_at: '2026-09-29T23:20:00Z' };
    const nav = renderOrders([page([disputed]), page(pastList)]);
    const row = within(await screen.findByTestId(`OrderRow-${disputed.id}`));
    expect(screen.getByText('Active orders')).toBeTruthy();
    expect(row.getByText('Under review')).toBeTruthy();
    expect(row.getByText("We'll get back to you by")).toBeTruthy();
    expect(row.getByText('29 September, 7:20 pm')).toBeTruthy();
    expect(row.queryByText('Track')).toBeNull();
    fireEvent.press(row.getByLabelText(`Details for order ${disputed.code} from Karachi Kitchen`));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'tracking', orderId: disputed.id } });
    expect(mock.callsTo('getOrderTracking')).toHaveLength(0);
  });

  it('shows loading while both lists load', () => {
    renderOrders(['hang']);
    expect(screen.getByTestId('Orders-loading')).toBeTruthy();
    expect(screen.queryByText('No orders yet')).toBeNull();
  });

  it('shows the empty state for someone who has never ordered, and Find a restaurant goes Home', async () => {
    const nav = renderOrders(['order_list_empty', 'order_list_empty']);
    expect(await screen.findByText('No orders yet')).toBeTruthy();
    expect(screen.getByText('When you order, you can follow it here, then find your receipt.')).toBeTruthy();
    fireEvent.press(screen.getByText('Find a restaurant'));
    expect(nav.log).toContainEqual({ action: 'selectTab', tab: 'home' });
  });

  it('keeps the active card when only the history fails, and retries the history alone', async () => {
    renderOrders([page(activeList), SERVER_ERROR, page(pastList)]);
    expect(await screen.findByText("We couldn't load your past orders")).toBeTruthy();
    expect(screen.getByText('Your active order above is up to date.')).toBeTruthy();
    expect(screen.getByTestId(`OrderRow-${active.id}`)).toBeTruthy();
    expect(screen.getByLabelText(`Track order ${active.code} from Karachi Kitchen`)).toBeTruthy();
    expect(screen.queryByText("We couldn't load your orders")).toBeNull();

    fireEvent.press(within(screen.getByTestId('Orders-past-error')).getByText('Try again'));
    await waitFor(() => expect(screen.getByTestId(`OrderRow-${pastList[0]!.id}`)).toBeTruthy());
    expect(groups().map((q) => q.get('status_group'))).toEqual(['ACTIVE', 'PAST', 'PAST']);
    expect(screen.getByTestId(`OrderRow-${active.id}`)).toBeTruthy();
  });

  it('shows one page error when both lists fail, and Try again reloads both', async () => {
    renderOrders([SERVER_ERROR, SERVER_ERROR, page(activeList), page(pastList)]);
    expect(await screen.findByText("We couldn't load your orders")).toBeTruthy();
    expect(
      screen.getByText("This is a problem loading the page. It doesn't change your orders. We'll let you know if anything changes."),
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Active orders')).toBeTruthy();
    expect(mock.callsTo('listOrders')).toHaveLength(4);
  });

  it('pages the history by cursor near the end, then says it is the end', async () => {
    const more = pastList.slice(0, 1).map((o) => ({ ...o, id: '11111111-1111-4111-8111-111111111111', code: 'HG-PAGE-2' }));
    renderOrders([page([]), page(pastList, 'cursor-2'), 'hang']);
    const list = await screen.findByTestId('Orders-list');
    await screen.findByText('Past orders');
    expect(screen.queryByTestId('Orders-end')).toBeNull();

    mock.answer('listOrders', page(more));
    act(() => {
      fireEvent.scroll(list, {
        nativeEvent: { contentOffset: { y: 700 }, contentSize: { height: 1000, width: 390 }, layoutMeasurement: { height: 300, width: 390 } },
      });
    });
    expect(await screen.findByText(/HG-PAGE-2/)).toBeTruthy();
    const last = groups().at(-1)!;
    expect(last.get('status_group')).toBe('PAST');
    expect(last.get('cursor')).toBe('cursor-2');
    expect(screen.getByText("That's all your orders")).toBeTruthy();
  });

  it('shows a loading tail while the next page loads, keeping the rows above', async () => {
    renderOrders([page([]), page(pastList, 'cursor-2')]);
    const list = await screen.findByTestId('Orders-list');
    await screen.findByText('Past orders');
    const scrollToEnd = () =>
      fireEvent.scroll(list, {
        nativeEvent: { contentOffset: { y: 700 }, contentSize: { height: 1000, width: 390 }, layoutMeasurement: { height: 300, width: 390 } },
      });

    mock.answer('listOrders', 'hang');
    act(() => scrollToEnd());
    expect(await screen.findByTestId('Orders-more-loading')).toBeTruthy();
    expect(screen.getByTestId(`OrderRow-${pastList[0]!.id}`)).toBeTruthy();
  });

  it('says it could not load more and retries with the same cursor', async () => {
    renderOrders([page([]), page(pastList, 'cursor-2'), SERVER_ERROR, page([])]);
    const list = await screen.findByTestId('Orders-list');
    await screen.findByText('Past orders');
    act(() => {
      fireEvent.scroll(list, {
        nativeEvent: { contentOffset: { y: 700 }, contentSize: { height: 1000, width: 390 }, layoutMeasurement: { height: 300, width: 390 } },
      });
    });
    expect(await screen.findByText("Couldn't load more orders")).toBeTruthy();
    expect(screen.getByText('Check your connection. The orders above are up to date.')).toBeTruthy();
    expect(screen.getByTestId(`OrderRow-${pastList[0]!.id}`)).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('Orders-more-error')).getByText('Try again'));
    expect(await screen.findByText("That's all your orders")).toBeTruthy();
    const cursors = groups().map((q) => q.get('cursor'));
    expect(cursors.slice(-2)).toEqual(['cursor-2', 'cursor-2']);
  });

  it('opens the row menu with View receipt and Get help only: no reorder, no rating', async () => {
    const completed = pastList.find((o) => o.state === 'COMPLETED')!;
    const rejected = pastList.find((o) => o.state === 'REJECTED')!;
    const nav = renderOrders([page([]), page(pastList)]);
    await screen.findByText('Past orders');
    expect(screen.queryByText(/Order again|Reorder|Rate/)).toBeNull();

    expect(screen.getAllByLabelText(`Actions for order ${rejected.code} from Karachi Kitchen`).length).toBeGreaterThan(0);
    fireEvent.press(screen.getByTestId(`OrderRow-${rejected.id}-menu`));
    let menu = within(await screen.findByTestId('Orders-rowMenu'));
    expect(menu.queryByText('View receipt')).toBeNull();
    expect(menu.getByText('Get help')).toBeTruthy();
    fireEvent.press(menu.getByText('Get help'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'tracking', orderId: rejected.id } });

    fireEvent.press(screen.getByTestId(`OrderRow-${completed.id}-menu`));
    menu = within(await screen.findByTestId('Orders-rowMenu'));
    expect(menu.queryByText(/Order again|Reorder|Rate/)).toBeNull();
    fireEvent.press(menu.getByText('View receipt'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'receipt', orderId: completed.id } });
  });

  it('never sends anything but reads', async () => {
    renderOrders([page(activeList), page(pastList)]);
    await screen.findByText('Past orders');
    expect(mock.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('renders in dark', async () => {
    renderOrders([page(activeList), page(pastList)], {}, 'dark');
    expect(await screen.findByText('Active orders')).toBeTruthy();
    expect(screen.getByText('Past orders')).toBeTruthy();
    expect(screen.getByTestId('OrdersScreen')).toBeTruthy();
  });
});
