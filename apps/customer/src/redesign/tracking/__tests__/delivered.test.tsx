/**
 * The delivered and completed order page against the contract's fixtures, reached the way a customer
 * reaches it (the tracking route for an order that was delivered). Loading, a failed money read,
 * a refund in every shape that matters, the one action for each state, no halal badge, dark, and
 * that nothing here sends a request with a body.
 */
import * as React from 'react';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { cents, type Schema } from '@hg/api-client';

import { formatPrice } from '../../ds';
import { formatTime } from '../../lib/time';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { ok, list, order } from '../../test/answers';
import { navSpy, renderRedesign } from '../../test/render';
import { TrackingScreen } from '../TrackingScreen';

type Order = Schema['OrderCustomerView'];
type Refund = Schema['Refund'];
type Payment = Schema['OrderPayment'];

const refund = (scenario: string, patch: Partial<Refund> = {}): Refund => ({ ...payloadOf<Refund>(scenario), ...patch });
const money = (c: number) => formatPrice(cents(c));

let mock: MockApi;
afterEach(() => mock?.restore());

function renderDelivered(o: Order, answers: Record<string, MockAnswer> = {}, scheme: 'light' | 'dark' = 'light') {
  mock = mockApi({
    getOrder: ok(o),
    getOrderPayment: 'payment_succeeded',
    getOrderTracking: 'tracking_preparing',
    listRefunds: list([]),
    ...answers,
  });
  const nav = navSpy({ name: 'tracking', orderId: o.id });
  renderRedesign(<TrackingScreen orderId={o.id} />, { nav, scheme });
  return nav;
}

describe('a delivered order', () => {
  it('is its own page: the time, what was asked at the door, the timeline, Get help, no map', async () => {
    const o = order('order_delivered', { delivery_instructions: ['MEET_AT_DOOR'] });
    renderDelivered(o);
    expect(await screen.findByTestId('Delivered')).toBeTruthy();
    expect(screen.getByLabelText(`Delivered at ${formatTime(o.delivered_at!)}`)).toBeTruthy();
    expect(screen.getByText('You asked to meet at the door.')).toBeTruthy();
    expect(screen.getByTestId('Delivered-timeline')).toBeTruthy();
    expect(screen.getByTestId('Delivered-getHelp')).toBeTruthy();
    expect(screen.queryByTestId('Tracking-body')).toBeNull();
    expect(screen.queryByTestId('Tracking-map')).toBeNull();
  });

  it('promises a receipt but does not offer one until the order is complete', async () => {
    renderDelivered(order('order_delivered'));
    expect(await screen.findByTestId('Delivered-receiptNote')).toBeTruthy();
    expect(screen.getByText("We'll add your receipt here when the order is complete, and let you know.")).toBeTruthy();
    expect(screen.queryByTestId('Delivered-receipt')).toBeNull();
  });

  it('has no halal badge, even when the restaurant is certified today', async () => {
    const o = order('order_delivered');
    expect(o.restaurant.halal?.display_state).toBe('CERTIFIED');
    renderDelivered(o);
    await screen.findByTestId('Delivered');
    expect(screen.queryByTestId('Tracking-halalBadge')).toBeNull();
    expect(screen.queryByText(/halal/i)).toBeNull();
  });

  it('a lapsed or missing halal record changes nothing: still no badge, still no notice', async () => {
    const o = order('order_delivered');
    const lapsed = { ...o.restaurant.halal, display_state: 'EXPIRED' } as Order['restaurant']['halal'];
    renderDelivered({ ...o, restaurant: { ...o.restaurant, halal: lapsed } });
    await screen.findByTestId('Delivered');
    expect(screen.queryByText(/expired|lapsed|halal/i)).toBeNull();
  });

  it('leaving it at the door is what was asked, not what happened', async () => {
    renderDelivered(order('order_delivered', { delivery_instructions: ['LEAVE_AT_DOOR', 'DO_NOT_RING_BELL'] }));
    expect(await screen.findByText('You asked us to leave it at the door and not ring the bell.')).toBeTruthy();
    expect(screen.queryByText(/proof|photo|left it/i)).toBeNull();
  });

  it('Get help opens the after-delivery sheet', async () => {
    renderDelivered(order('order_delivered'));
    fireEvent.press(await screen.findByTestId('Delivered-getHelp'));
    expect(await screen.findByTestId('GetHelp-topicsAfter')).toBeTruthy();
  });
});

describe('a completed order', () => {
  it('says it is complete, offers View receipt first and opens the receipt', async () => {
    const o = order('order_completed');
    const nav = renderDelivered(o);
    // The visual lines are hidden from a screen reader; one label says the whole heading.
    expect(await screen.findByLabelText(`Order complete, delivered at ${formatTime(o.delivered_at!)}`)).toBeTruthy();
    expect(screen.getByText('Order complete', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(`Delivered at ${formatTime(o.delivered_at!)}`, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('Delivered-receiptNote')).toBeNull();
    fireEvent.press(screen.getByTestId('Delivered-receipt'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'receipt', orderId: o.id } });
    expect(screen.getByTestId('Delivered-getHelp')).toBeTruthy();
  });

  it('never offers a rating', async () => {
    renderDelivered(order('order_completed'));
    await screen.findByTestId('Delivered');
    expect(screen.queryByText(/\brat(e|ing)\b/i)).toBeNull();
  });
});

describe('the money card', () => {
  it('Charged is the payment record, not the order total', async () => {
    const payment = { ...payloadOf<Payment>('payment_succeeded'), amount_captured_cents: cents(4321) };
    renderDelivered(order('order_completed'), { getOrderPayment: ok(payment) });
    const row = await screen.findByTestId('Delivered-charged');
    expect(within(row).getByText('Charged')).toBeTruthy();
    expect(within(row).getByText(money(4321))).toBeTruthy();
  });

  it('shows a loading state while the payment is being read', async () => {
    renderDelivered(order('order_completed'), { getOrderPayment: 'hang' });
    expect(await screen.findByTestId('Delivered-moneyLoading')).toBeTruthy();
    expect(screen.queryByTestId('Delivered-charged')).toBeNull();
  });

  it('a failed payment read says so, guesses no amount, and Try again reads it again', async () => {
    renderDelivered(order('order_completed'), { getOrderPayment: [{ status: 500, code: 'INTERNAL_ERROR' }, 'payment_succeeded'] });
    expect(await screen.findByTestId('Delivered-moneyError')).toBeTruthy();
    expect(screen.queryByTestId('Delivered-charged')).toBeNull();
    fireEvent.press(screen.getByTestId('Delivered-moneyRetry'));
    expect(await screen.findByTestId('Delivered-charged')).toBeTruthy();
  });

  it('a refund made before delivery stays visible under Charged, on its way, with its amount', async () => {
    const r = refund('refund_submitted');
    renderDelivered(order('order_delivered'), { listRefunds: list([r]) });
    const row = await screen.findByTestId('Delivered-refund');
    expect(within(row).getByText('Refund')).toBeTruthy();
    expect(within(row).getByText('On its way')).toBeTruthy();
    expect(within(row).getByText(money(r.amount_cents))).toBeTruthy();
  });

  it('a report under review is "Your report" with no amount', async () => {
    const r = refund('refund_requested');
    renderDelivered(order('order_completed'), { listRefunds: list([r]) });
    const row = await screen.findByTestId('Delivered-refund');
    expect(within(row).getByText('Your report')).toBeTruthy();
    expect(within(row).getByText('Under review')).toBeTruthy();
    expect(within(row).queryByText(money(r.amount_cents))).toBeNull();
  });

  it('a settled refund says Refunded', async () => {
    renderDelivered(order('order_completed'), { listRefunds: list([refund('refund_settled')]) });
    expect(await within(await screen.findByTestId('Delivered-refund')).findByText('Refunded')).toBeTruthy();
  });

  it('a failed refund is never called Refunded', async () => {
    renderDelivered(order('order_completed'), { listRefunds: list([refund('refund_failed')]) });
    const row = await screen.findByTestId('Delivered-refund');
    expect(within(row).getByText('Refund in progress')).toBeTruthy();
    expect(within(row).queryByText('Refunded')).toBeNull();
  });

  it('no refund, no refund row', async () => {
    renderDelivered(order('order_completed'));
    await screen.findByTestId('Delivered-charged');
    expect(screen.queryByTestId('Delivered-refund')).toBeNull();
  });
});

describe('around the page', () => {
  it('dark renders the same page', async () => {
    renderDelivered(order('order_completed'), {}, 'dark');
    expect(await screen.findByTestId('Delivered-body')).toBeTruthy();
  });

  it('only reads: no request carries a price or a body', async () => {
    renderDelivered(order('order_completed'));
    await screen.findByTestId('Delivered-charged');
    expect(mock.calls.every((c) => c.method === 'GET' && c.body === undefined)).toBe(true);
  });
});
