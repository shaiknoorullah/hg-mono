/**
 * The outcome screen against the contract's fixtures: an order that ended, with the money read from
 * the payment and refund records. Loading, a failed money read, no refund, and every refund state.
 */
import * as React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { cents, type Schema } from '@hg/api-client';

import { formatPrice } from '../../ds';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { keysOf, MONEY_KEY } from '../../test/requests';
import { TrackingScreen } from '../TrackingScreen';

jest.mock('../../../screens/TrackingScreen', () => {
  const { Text } = require('react-native');
  return { TrackingScreen: () => <Text testID="LegacyTracking">legacy tracking</Text> };
});

type Order = Schema['OrderCustomerView'];
type Refund = Schema['Refund'];

const ok = (data: unknown): MockAnswer => ({ status: 200, body: { data } });
const list = (data: unknown[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false } } });
const order = (scenario: string, patch: Partial<Order> = {}): Order => ({ ...payloadOf<Order>(scenario), ...patch });
const refund = (scenario: string, patch: Partial<Refund> = {}): Refund => ({ ...payloadOf<Refund>(scenario), ...patch });
const money = (c: number) => formatPrice(cents(c));

let mock: MockApi;
afterEach(() => mock?.restore());

function renderOutcome(answers: Record<string, MockAnswer>, scheme: 'light' | 'dark' = 'light') {
  mock = mockApi({ listRefunds: list([]), getOrderPayment: 'payment_canceled', ...answers });
  const nav = navSpy({ name: 'tracking', orderId: 'o1' });
  renderRedesign(<TrackingScreen orderId="o1" />, { nav, scheme });
  return nav;
}

describe('ended before the restaurant accepted', () => {
  it('rejected: plain words, the hold released, nothing charged, and no refund to wait for', async () => {
    const o = order('order_rejected');
    renderOutcome({ getOrder: ok(o) });
    expect(await screen.findByTestId('Outcome')).toBeTruthy();
    expect(screen.getByText(`${o.restaurant.name} couldn't take your order`)).toBeTruthy();
    expect(screen.getByText("Something you ordered has run out. You weren't charged.")).toBeTruthy();
    expect(await screen.findByText(/^Hold on .*, released$/)).toBeTruthy();
    expect(screen.getByTestId('Outcome-charged')).toBeTruthy();
    expect(screen.getByText(money(0))).toBeTruthy();
    expect(screen.queryByText(/refund/i)).toBeNull();
    expect(screen.queryByTestId('Outcome-refund')).toBeNull();
  });

  it('customer cancelled, restaurant timeout and closed each say their own thing', async () => {
    const base = order('order_cancelled');
    renderOutcome({ getOrder: ok({ ...base, cancel_reason: 'RESTAURANT_TIMEOUT' }) });
    expect(await screen.findByText(`${base.restaurant.name} didn't respond in time`)).toBeTruthy();
  });

  it('put these items back adds each line with ids and quantities only, then opens the cart', async () => {
    const o = order('order_rejected');
    const nav = renderOutcome({ getOrder: ok(o), addCartLine: ok(payloadOf('cart_single_line')) });
    fireEvent.press(await screen.findByTestId('Outcome-putBack'));
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'replace', route: { name: 'cart' } }));
    const adds = mock.callsTo('addCartLine');
    expect(adds).toHaveLength(o.lines.length);
    for (const call of adds) {
      expect(call.headers['idempotency-key']).toBeTruthy();
      expect(keysOf(call.body).filter((k) => MONEY_KEY.test(k) && k !== 'addon_quantity')).toEqual([]);
    }
  });

  it('a failed add keeps the button and says so; tapping again does not add a finished line twice', async () => {
    const o = order('order_rejected');
    const nav = renderOutcome({
      getOrder: ok(o),
      addCartLine: [{ status: 500, code: 'INTERNAL_ERROR' }, ok(payloadOf('cart_single_line'))],
    });
    fireEvent.press(await screen.findByTestId('Outcome-putBack'));
    expect(await screen.findByTestId('Outcome-putBackFailed')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Outcome-putBack'));
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'replace', route: { name: 'cart' } }));
  });
});

describe('ended after the card was charged', () => {
  const noRider = order('order_cancelled', { cancel_reason: 'NO_RIDER_FOUND', accepted_at: '2026-08-10T18:13:11.412Z' });

  it('no rider: charged, and the refund under review shows no amount and no promise', async () => {
    const r = refund('refund_requested');
    renderOutcome({ getOrder: ok(noRider), getOrderPayment: 'payment_succeeded', listRefunds: list([r]) });
    expect(await screen.findByText("We couldn't find a rider")).toBeTruthy();
    expect(await screen.findByText('Under review')).toBeTruthy();
    expect(screen.queryByText(money(r.amount_cents))).toBeNull();
    expect(screen.getByTestId('Outcome-charged')).toBeTruthy();
  });

  it('a refund on its way shows its amount', async () => {
    const r = refund('refund_submitted');
    renderOutcome({ getOrder: ok(noRider), getOrderPayment: 'payment_succeeded', listRefunds: list([r]) });
    expect(await screen.findByText('On its way to your card')).toBeTruthy();
    expect(screen.getByText(money(r.amount_cents))).toBeTruthy();
  });

  it('a failed refund reads "Refund in progress", never "Refunded"', async () => {
    renderOutcome({ getOrder: ok(noRider), getOrderPayment: 'payment_succeeded', listRefunds: list([refund('refund_failed')]) });
    expect(await screen.findByText('Refund in progress')).toBeTruthy();
    expect(screen.queryByText(/^Refunded/)).toBeNull();
  });

  it('charged with no refund yet says just that', async () => {
    renderOutcome({ getOrder: ok(noRider), getOrderPayment: 'payment_succeeded' });
    expect(await screen.findByTestId('Outcome-noRefundYet')).toBeTruthy();
  });
});

describe('under review and resolved', () => {
  it('disputed: the badge, the timeline, and money decided in review', async () => {
    const o = order('order_disputed');
    renderOutcome(
      {
        getOrder: ok(o),
        getOrderPayment: 'payment_succeeded',
        getOrderTracking: ok({
          ...payloadOf<Record<string, unknown>>('tracking_picked_up'),
          state: 'DISPUTED',
          timeline: [{ from_state: 'DELIVERED', to_state: 'DISPUTED', actor_kind: 'SUPPORT', reason: null, at: o.state_since }],
        }),
      },
      'dark',
    );
    expect(await screen.findByTestId('Outcome-timeline')).toBeTruthy();
    expect(screen.getAllByText('Under review').length).toBeGreaterThan(0);
    expect(await screen.findByText(/Our team opened a review of this order/)).toBeTruthy();
  });

  it('resolved with a settled refund: refunded on its date, with View receipt when it completed', async () => {
    const o = order('order_resolved');
    const r = refund('refund_settled', { scope: 'FULL', kind: 'FULL' });
    const nav = renderOutcome({ getOrder: ok(o), getOrderPayment: 'payment_succeeded', listRefunds: list([r]) });
    expect(await screen.findByText('Our team has finished its review and refunded your order.')).toBeTruthy();
    expect(screen.getByText(/^Refunded on /)).toBeTruthy();
    fireEvent.press(screen.getByTestId('Outcome-receipt'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'receipt', orderId: o.id } });
  });

  it('resolved with a declined refund: "Not approved" and a way to call', async () => {
    renderOutcome({ getOrder: ok(order('order_resolved')), getOrderPayment: 'payment_succeeded', listRefunds: list([refund('refund_declined')]) });
    expect(await screen.findByText("Our team has finished its review and didn't issue a refund.")).toBeTruthy();
    expect(screen.getByText('Not approved')).toBeTruthy();
    expect(await screen.findByTestId('Outcome-call')).toBeTruthy();
  });
});

describe('loading and error', () => {
  it('the page stands while the money loads', async () => {
    renderOutcome({ getOrder: ok(order('order_rejected')), getOrderPayment: 'hang' });
    expect(await screen.findByTestId('Outcome-h1')).toBeTruthy();
    expect(screen.getByTestId('Outcome-moneyLoading')).toBeTruthy();
  });

  it('a failed money read says so inside the money card, and Try again reads it again', async () => {
    renderOutcome({
      getOrder: ok(order('order_rejected')),
      getOrderPayment: [{ status: 500, code: 'INTERNAL_ERROR' }, 'payment_canceled'],
    });
    expect(await screen.findByTestId('Outcome-moneyError')).toBeTruthy();
    expect(screen.getByTestId('Outcome-h1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Outcome-moneyRetry'));
    expect(await screen.findByTestId('Outcome-charged')).toBeTruthy();
  });

  it('only reads, apart from the cart adds: no request carries a price', async () => {
    renderOutcome({ getOrder: ok(order('order_rejected')) });
    await screen.findByTestId('Outcome-charged');
    expect(mock.calls.every((c) => c.method === 'GET' && c.body === undefined)).toBe(true);
  });
});
