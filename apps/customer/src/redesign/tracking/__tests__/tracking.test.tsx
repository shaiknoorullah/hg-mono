/**
 * Order tracking against the contract's fixtures: the waiting and live states drawn from fixtures, the halal rules, the delivery code, offline, an open report, loading, error,
 * not found, dark, and the hand-over of states this page does not draw (the outcome and delivered pages).
 */
import * as React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { TrackingScreen } from '../TrackingScreen';

jest.mock('../../../screens/TrackingScreen', () => {
  const { Text } = require('react-native');
  return { TrackingScreen: () => <Text testID="LegacyTracking">legacy tracking</Text> };
});

type Order = Schema['OrderCustomerView'];
type Tracking = Schema['OrderTracking'];

const ok = (data: unknown): MockAnswer => ({ status: 200, body: { data } });
const list = (data: unknown[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false } } });
const SERVER_ERROR: MockAnswer = { status: 500, code: 'INTERNAL_ERROR' };

const order = (scenario: string, patch: Partial<Order> = {}): Order => ({ ...payloadOf<Order>(scenario), ...patch });
const tracking = (scenario: string, patch: Partial<Tracking> = {}): Tracking => ({ ...payloadOf<Tracking>(scenario), ...patch });
// The server's clock is what the page counts against, so a test moves it through `server_time`; the
// phone's own clock is left wrong on purpose, ten minutes fast, to show it is not the one read.
const WRONG_PHONE_CLOCK_MS = 10 * 60_000;
const serverAt = (ms: number) => new Date(ms).toISOString();
const phoneRunsFast = () => setNowOverride({ offsetMs: WRONG_PHONE_CLOCK_MS });

const halal = (display_state: string, extra: Record<string, unknown> = {}) => ({
  display_state,
  certifying_body_name: 'Halal Monitoring Authority (HMA Canada)',
  expires_on: '2027-03-09',
  ...extra,
});
const withHalal = (o: Order, h: unknown): Order => ({ ...o, restaurant: { ...o.restaurant, halal: h as Order['restaurant']['halal'] } });

let mock: MockApi;

beforeEach(() => resetConnectivity());
afterEach(() => {
  mock?.restore();
  setNowOverride(null);
});

function renderTracking(answers: Record<string, MockAnswer>, { scheme = 'light', pollMs }: { scheme?: 'light' | 'dark'; pollMs?: number } = {}) {
  mock = mockApi({ listRefunds: list([]), ...answers });
  const nav = navSpy({ name: 'tracking', orderId: 'o1' });
  renderRedesign(<TrackingScreen orderId="o1" pollMs={pollMs} />, { nav, scheme });
  return nav;
}

const textOf = (id: string) => {
  const kids = screen.getByTestId(id).props.children;
  return Array.isArray(kids) ? kids.flat(9).join('') : String(kids);
};

describe('waiting layout', () => {
  it('RESTAURANT_PENDING: one neutral bar with the absolute reply-by time, the total, and Cancel order while the server allows it', async () => {
    const base = order('order_restaurant_pending');
    const o = { ...base, server_time: serverAt(Date.parse(base.deadline_at!) - 100_000) };
    phoneRunsFast();
    renderTracking({ getOrder: ok(o), getOrderTracking: ok(tracking('tracking_preparing', { state: 'RESTAURANT_PENDING', server_time: o.server_time })) });
    expect(await screen.findByTestId('Tracking-body')).toBeTruthy();
    expect(textOf('Tracking-h1')).toBe(`Waiting for ${o.restaurant.name} to accept`);
    expect(screen.getByText("Your card is authorised, not charged. If they don't accept in time, the hold is released.")).toBeTruthy();
    expect(screen.getByText(/replies by \d{1,2}:\d{2} (am|pm)$/)).toBeTruthy();
    expect(screen.getByTestId('Tracking-total')).toBeTruthy();
    expect(screen.getByTestId('Tracking-cancel')).toBeTruthy();
    expect(screen.queryByTestId('Tracking-getHelp')).toBeNull();
    expect(screen.queryByTestId('Tracking-halalLine')).toBeNull();
  });

  it('at zero it waits for the server: the line changes once and the bar has no time to show', async () => {
    const base = order('order_restaurant_pending');
    const o = { ...base, server_time: serverAt(Date.parse(base.deadline_at!) + 5_000) };
    setNowOverride({ offsetMs: -WRONG_PHONE_CLOCK_MS });
    renderTracking({ getOrder: ok(o), getOrderTracking: ok(tracking('tracking_preparing', { state: 'RESTAURANT_PENDING', server_time: o.server_time })) });
    expect(await screen.findByText(/Checking with .*\. If they haven't accepted, the hold is released and you pay nothing\./)).toBeTruthy();
    expect(screen.queryByText(/replies by/)).toBeNull();
  });

  it('AUTHORIZED: says the hold is placed, then that sending is slow after 30 s', async () => {
    const base = order('order_authorized');
    const o = { ...base, server_time: serverAt(Date.parse(base.state_since!) + 5_000) };
    phoneRunsFast();
    renderTracking({ getOrder: ok(o), getOrderTracking: ok(tracking('tracking_preparing', { state: 'AUTHORIZED', server_time: o.server_time })) });
    expect(await screen.findByText(/Hold placed on your/)).toBeTruthy();
    mock.restore();
    const later = { ...base, server_time: serverAt(Date.parse(base.state_since!) + 60_000) };
    renderTracking({ getOrder: ok(later), getOrderTracking: ok(tracking('tracking_preparing', { state: 'AUTHORIZED', server_time: later.server_time })) });
    expect(await screen.findByText(/Still sending your order to/)).toBeTruthy();
  });

  it('CREATED: nothing is charged until the restaurant accepts', async () => {
    renderTracking({ getOrder: 'order_created', getOrderTracking: ok(tracking('tracking_preparing', { state: 'CREATED' })) });
    expect(await screen.findByText(/Nothing is charged until .* accepts\./)).toBeTruthy();
  });

  it('still draws when the tracking read fails in a waiting state', async () => {
    renderTracking({ getOrder: 'order_restaurant_pending', getOrderTracking: SERVER_ERROR });
    expect(await screen.findByTestId('Tracking-h1')).toBeTruthy();
  });
});

describe('live layout', () => {
  it('PREPARING, rider still being found: the window, no rider pin, a search card', async () => {
    renderTracking({ getOrder: 'order_preparing', getOrderTracking: ok(tracking('tracking_preparing', { rider_location: null })) });
    // The two visual lines are hidden from a screen reader; one label says the whole sentence.
    expect(await screen.findByLabelText(/^Being prepared, arriving between \d/)).toBeTruthy();
    expect(screen.getByText('Being prepared · Arriving', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('Tracking-findingRider')).toBeTruthy();
    // Without a map engine (as in this test) the map degrades to its text: both places, and the window.
    expect(screen.getByText(/^From .*\. To .*\. Arriving \d{1,2}:\d{2}–\d{1,2}:\d{2} (am|pm)\.$/)).toBeTruthy();
  });

  it('READY_FOR_PICKUP with a rider assigned: names them, no map pin promise', async () => {
    renderTracking({ getOrder: 'order_ready_for_pickup', getOrderTracking: 'tracking_ready_for_pickup' });
    expect(await screen.findByTestId('Tracking-rider')).toBeTruthy();
    expect(screen.getByText(/will bring your order|is at /)).toBeTruthy();
    expect(screen.getByText(/once your food is picked up/)).toBeTruthy();
  });

  it('PICKED_UP: names the rider and the vehicle, never a rating', async () => {
    renderTracking({ getOrder: 'order_picked_up', getOrderTracking: 'tracking_picked_up' });
    expect(await screen.findByText(/is bringing your order/)).toBeTruthy();
    expect(screen.queryByText(/4\.9|rating|stars/i)).toBeNull();
  });

  it('no rider found: the state is the headline, the last estimate underneath, a calm notice', async () => {
    const o = order('order_ready_for_pickup', { dispatch_state: 'NO_RIDER_FOUND' });
    renderTracking({ getOrder: ok(o), getOrderTracking: ok(tracking('tracking_ready_for_pickup', { dispatch_state: 'NO_RIDER_FOUND', rider: null })) });
    expect(await screen.findByTestId('Tracking-no-rider')).toBeTruthy();
    expect(screen.getByText(/^Last estimate /)).toBeTruthy();
    expect(screen.getByLabelText(/^Finding a rider, update by/)).toBeTruthy();
  });

  it('a stale rider fix is said, not hidden', async () => {
    const base = tracking('tracking_picked_up');
    const t = { ...base, server_time: serverAt(Date.parse(base.rider_location!.recorded_at!) + 120_000) };
    phoneRunsFast();
    renderTracking({ getOrder: 'order_picked_up', getOrderTracking: ok(t) });
    expect(await screen.findByTestId('Tracking-fixStale')).toBeTruthy();
  });

  it('PREPARING after acceptance with no rider card: what was charged, from the payment', async () => {
    const o = order('order_preparing', { dispatch_state: 'PENDING' });
    renderTracking({
      getOrder: ok(o),
      getOrderTracking: ok(tracking('tracking_preparing', { dispatch_state: 'PENDING', rider_location: null })),
    });
    expect(await screen.findByTestId('Tracking-charged')).toBeTruthy();
    expect(screen.getByText("You can't cancel now the kitchen has started.")).toBeTruthy();
  });

  it('shows an open report before delivery, and not a decided one', async () => {
    const refund = { id: 'r1', order_id: 'o1', state: 'PENDING_APPROVAL', reason_code: 'CUSTOMER_CHANGED_MIND', requested_at: '2026-09-28T19:05:00-04:00' };
    renderTracking({ getOrder: 'order_picked_up', getOrderTracking: 'tracking_picked_up', listRefunds: list([refund]) });
    expect(await screen.findByTestId('Tracking-report')).toBeTruthy();
    expect(screen.getByText('I want to cancel · Sent 7:05 pm')).toBeTruthy();
  });

  it('does not show a report a person has already decided', async () => {
    const decided = { id: 'r1', order_id: 'o1', state: 'DECLINED', reason_code: 'CUSTOMER_CHANGED_MIND', requested_at: '2026-09-28T19:05:00-04:00' };
    renderTracking({ getOrder: 'order_picked_up', getOrderTracking: 'tracking_picked_up', listRefunds: list([decided]) });
    await screen.findByTestId('Tracking-body');
    expect(screen.queryByTestId('Tracking-report')).toBeNull();
  });
});

describe('at the door', () => {
  it('a met handover shows the delivery code, spoken digit by digit, from the read only', async () => {
    renderTracking({ getOrder: 'order_arrived_meet_in_lobby', getOrderTracking: 'tracking_arrived_delivery_code' });
    expect(await screen.findByTestId('Tracking-code')).toBeTruthy();
    expect(screen.getByLabelText(/Delivery code: 4, 8, 2, 7$/)).toBeTruthy();
    expect(screen.getByLabelText('Yusuf is in the lobby'.replace('Yusuf', 'Bilal'))).toBeTruthy();
  });

  it('a locked code shows no digits, only that support will confirm', async () => {
    renderTracking({
      getOrder: ok(order('order_arrived_delivery_code_locked')),
      getOrderTracking: 'tracking_arrived_delivery_code_locked',
    });
    expect(await screen.findByTestId('Tracking-codeLocked')).toBeTruthy();
    expect(screen.queryByTestId('Tracking-codeDigits')).toBeNull();
  });

  it('leave at door: no code is needed, and none is drawn', async () => {
    const o = order('order_arrived', { delivery_instructions: ['LEAVE_AT_DOOR', 'DO_NOT_RING_BELL'], delivery_code: null });
    renderTracking({ getOrder: ok(o), getOrderTracking: ok(tracking('tracking_arrived', { delivery_code: null })) });
    expect(await screen.findByTestId('Tracking-leaveAtDoor')).toBeTruthy();
    expect(screen.getByText(/without ringing the bell\. No code is needed\./)).toBeTruthy();
    expect(screen.queryByTestId('Tracking-code')).toBeNull();
  });
});

describe('halal on the order card (manifest rules: no optimistic badge, never red)', () => {
  const live = (o: Order) => ({ getOrder: ok(o), getOrderTracking: ok(tracking('tracking_preparing')) });

  it('certified shows the badge', async () => {
    renderTracking(live(withHalal(order('order_preparing'), halal('CERTIFIED'))));
    expect(await screen.findByTestId('Tracking-halalBadge')).toBeTruthy();
  });

  it('a missing halal field draws no badge, no placeholder and no notice', async () => {
    renderTracking(live(withHalal(order('order_preparing'), null)));
    await screen.findByTestId('Tracking-restaurant');
    expect(screen.queryByTestId('Tracking-halalBadge')).toBeNull();
    expect(screen.queryByText(/certificate/i)).toBeNull();
  });

  it('a partial record (no certifying body) draws no badge', async () => {
    renderTracking(live(withHalal(order('order_preparing'), halal('CERTIFIED', { certifying_body_name: null }))));
    await screen.findByTestId('Tracking-restaurant');
    expect(screen.queryByTestId('Tracking-halalBadge')).toBeNull();
  });

  it('a lapsed certificate mid-order: the slate badge and one neutral notice, the order goes ahead', async () => {
    renderTracking(live(withHalal(order('order_preparing'), halal('EXPIRED'))));
    expect(await screen.findByTestId('Tracking-certLapsed')).toBeTruthy();
    expect(screen.getByTestId('Tracking-halalBadge')).toBeTruthy();
    expect(screen.getByText(/goes ahead as normal/)).toBeTruthy();
  });

  it('a revoked certificate mid-order: no badge, one neutral notice that never says revoked', async () => {
    renderTracking(live(withHalal(order('order_preparing'), halal('UNVERIFIED'))));
    expect(await screen.findByTestId('Tracking-certRevoked')).toBeTruthy();
    expect(screen.queryByTestId('Tracking-halalBadge')).toBeNull();
    expect(screen.queryByText(/revoked/i)).toBeNull();
  });

  it('before the restaurant accepts, a lapsed certificate says nothing about an accepted order', async () => {
    renderTracking({
      getOrder: ok(withHalal(order('order_restaurant_pending'), halal('EXPIRED'))),
      getOrderTracking: ok(tracking('tracking_preparing', { state: 'RESTAURANT_PENDING' })),
    });
    await screen.findByTestId('Tracking-restaurant');
    expect(screen.queryByTestId('Tracking-certLapsed')).toBeNull();
  });
});

describe('offline and re-reads', () => {
  it('keeps the last copy on screen and says when it was current when a re-read fails', async () => {
    renderTracking(
      { getOrder: [ok(withHalal(order('order_preparing'), halal('CERTIFIED'))), 'offline'], getOrderTracking: ok(tracking('tracking_preparing')) },
      { pollMs: 40 },
    );
    expect(await screen.findByTestId('Tracking-restaurant')).toBeTruthy();
    expect(await screen.findByTestId('Tracking-offline')).toBeTruthy();
    expect(screen.getByText(/This is what we knew at \d{1,2}:\d{2} (am|pm)\./)).toBeTruthy();
    // The last good order is still there, not an error page.
    expect(screen.getByTestId('Tracking-restaurant')).toBeTruthy();
  });

  it('drops the halal badge once the offline copy is older than 15 minutes', async () => {
    renderTracking(
      { getOrder: [ok(withHalal(order('order_preparing'), halal('CERTIFIED'))), 'offline'], getOrderTracking: ok(tracking('tracking_preparing')) },
      { pollMs: 40 },
    );
    await screen.findByTestId('Tracking-halalBadge');
    setNowOverride({ offsetMs: 16 * 60_000 });
    await waitFor(() => expect(screen.queryByTestId('Tracking-halalBadge')).toBeNull());
    expect(screen.getByText("Halal status shows again when you're back online.")).toBeTruthy();
  });
});

describe('states of the page', () => {
  it('loading: the timeline shape with skeletons, no "calculating"', () => {
    renderTracking({ getOrder: 'hang' });
    expect(screen.getByTestId('Tracking-loading')).toBeTruthy();
    expect(screen.queryByText(/calculating/i)).toBeNull();
  });

  it('error: says it does not change the order, and Try again re-reads', async () => {
    renderTracking({ getOrder: [SERVER_ERROR, 'order_preparing'], getOrderTracking: 'tracking_preparing' });
    expect(await screen.findByTestId('Tracking-error')).toBeTruthy();
    expect(screen.getByText("We couldn't load this order")).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('Tracking-body')).toBeTruthy();
  });

  it('not found: points to Orders and to finding a restaurant', async () => {
    const nav = renderTracking({ getOrder: { status: 404, code: 'ORDER_NOT_FOUND' } });
    expect(await screen.findByTestId('Tracking-notFound')).toBeTruthy();
    fireEvent.press(screen.getByText('See your orders'));
    expect(nav.log).toContainEqual({ action: 'selectTab', tab: 'orders' });
    fireEvent.press(screen.getByText('Find a restaurant'));
    expect(nav.log).toContainEqual({ action: 'selectTab', tab: 'home' });
  });

  it('dark renders the same page', async () => {
    renderTracking({ getOrder: 'order_picked_up', getOrderTracking: 'tracking_picked_up' }, { scheme: 'dark' });
    expect(await screen.findByTestId('Tracking-body')).toBeTruthy();
  });

  it('a delivered or completed order hands over to its own page, not the legacy screen', async () => {
    renderTracking({ getOrder: 'order_delivered' });
    expect(await screen.findByTestId('Delivered')).toBeTruthy();
    expect(screen.queryByTestId('LegacyTracking')).toBeNull();
    expect(screen.queryByTestId('Tracking-body')).toBeNull();
  });

  it('only reads: no request carries a price or a body', async () => {
    renderTracking({ getOrder: 'order_picked_up', getOrderTracking: 'tracking_picked_up' });
    await screen.findByTestId('Tracking-body');
    expect(mock.calls.every((c) => c.method === 'GET' && c.body === undefined)).toBe(true);
  });
});
