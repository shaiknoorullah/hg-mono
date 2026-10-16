/**
 * The cancel sheet: opens with nothing chosen, validates on press, sends one idempotent request
 * with no price in it, keeps the reason on a failure, and hands over when the window has closed.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { formatPrice } from '../../ds';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { keysOf, MONEY_KEY } from '../../test/requests';
import { TrackingScreen } from '../TrackingScreen';
import { cents } from '@hg/api-client';

jest.mock('../../../screens/TrackingScreen', () => {
  const { Text } = require('react-native');
  return { TrackingScreen: () => <Text testID="LegacyTracking">legacy tracking</Text> };
});

type Order = Schema['OrderCustomerView'];
const ok = (data: unknown): MockAnswer => ({ status: 200, body: { data } });
const list = (data: unknown[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false } } });
const order = (scenario: string, patch: Partial<Order> = {}): Order => ({ ...payloadOf<Order>(scenario), ...patch });
const tracking = (state: string) => ({ ...payloadOf('tracking_preparing'), state });

let mock: MockApi;
afterEach(() => mock?.restore());

function renderWaiting(answers: Record<string, MockAnswer> = {}, pollMs?: number) {
  const pending = order('order_restaurant_pending');
  mock = mockApi({
    getOrder: ok(pending),
    getOrderTracking: ok(tracking('RESTAURANT_PENDING')),
    listRefunds: list([]),
    ...answers,
  });
  const nav = navSpy({ name: 'tracking', orderId: 'o1' });
  renderRedesign(<TrackingScreen orderId="o1" pollMs={pollMs} />, { nav });
  return { nav, pending };
}

async function openSheet() {
  fireEvent.press(await screen.findByTestId('Tracking-cancel'));
  expect(await screen.findByTestId('Cancel-sheet')).toBeTruthy();
}

describe('the cancel sheet', () => {
  it('opens with no reason chosen and says what cancelling will do', async () => {
    renderWaiting();
    await openSheet();
    expect(screen.getByText("If you cancel, the hold on your card is released and you won't be charged.")).toBeTruthy();
    expect(screen.getByTestId('Cancel-reason-OTHER').props.accessibilityState?.checked).not.toBe(true);
  });

  it('pressing Cancel order with no reason sends nothing and shows the group error', async () => {
    renderWaiting();
    await openSheet();
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    const error = await screen.findByTestId('Cancel-reasons-error');
    expect(JSON.stringify(error.props.children)).toContain('Choose a reason to cancel');
    expect(mock.callsTo('cancelOrder')).toHaveLength(0);
  });

  it('"Something else" needs five characters before anything is sent', async () => {
    renderWaiting();
    await openSheet();
    fireEvent.press(screen.getByTestId('Cancel-reason-OTHER'));
    fireEvent.changeText(screen.getByTestId('Cancel-note'), 'Late');
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    expect(await screen.findByText('Write at least 5 characters.')).toBeTruthy();
    expect(mock.callsTo('cancelOrder')).toHaveLength(0);
  });

  it('sends the reason with an Idempotency-Key and no price, then shows the ended order', async () => {
    const pending = order('order_restaurant_pending');
    renderWaiting({
      getOrder: [ok(pending), ok(order('order_cancelled', { id: pending.id }))],
      cancelOrder: ok(order('order_cancelled', { id: pending.id })),
      getOrderPayment: 'payment_canceled',
    });
    await openSheet();
    fireEvent.press(screen.getByTestId('Cancel-reason-CHANGED_MIND'));
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    expect(await screen.findByTestId('Outcome')).toBeTruthy();
    const [call] = mock.callsTo('cancelOrder');
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(call.body).toEqual({ reason_code: 'CHANGED_MIND' });
    expect(keysOf(call.body).filter((k) => MONEY_KEY.test(k))).toEqual([]);
    expect(await screen.findByText('Order cancelled')).toBeTruthy();
  });

  it('a failure keeps the reason; pressing again repeats the same request with the same key', async () => {
    renderWaiting({ cancelOrder: [{ status: 500, code: 'INTERNAL_ERROR' }, ok(order('order_cancelled'))] });
    await openSheet();
    fireEvent.press(screen.getByTestId('Cancel-reason-TOO_LONG_WAIT'));
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    expect(await screen.findByTestId('Cancel-failed')).toBeTruthy();
    expect(screen.getByText('Your order is still active. Check your connection and try again.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    await waitFor(() => expect(mock.callsTo('cancelOrder')).toHaveLength(2));
    const [first, second] = mock.callsTo('cancelOrder');
    expect(second.headers['idempotency-key']).toBe(first.headers['idempotency-key']);
    expect(second.body).toEqual(first.body);
  });

  it('409 window closed: the sheet closes and the page says it is too late, with the charge', async () => {
    renderWaiting({
      cancelOrder: { status: 409, code: 'CANCELLATION_WINDOW_CLOSED' },
      getOrderPayment: 'payment_succeeded',
    });
    await openSheet();
    fireEvent.press(screen.getByTestId('Cancel-reason-CHANGED_MIND'));
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    expect(await screen.findByText("It's too late to cancel here")).toBeTruthy();
    expect(await screen.findByTestId('Cancel-charge')).toBeTruthy();
    expect(screen.getAllByText(formatPrice(cents(payloadOf('payment_succeeded').amount_captured_cents))).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('Cancel-sheet')).toBeNull();
  });

  it('the restaurant accepts while the sheet is open: the sheet says so instead of closing', async () => {
    const pending = order('order_restaurant_pending');
    renderWaiting(
      {
        getOrder: [ok(pending), ok(order('order_preparing', { id: pending.id }))],
        getOrderTracking: ok(payloadOf('tracking_preparing')),
      },
      2500,
    );
    await openSheet();
    expect(await screen.findByText(/has accepted your order/)).toBeTruthy();
    expect(screen.queryByTestId('Cancel-confirm')).toBeNull();
    expect(screen.getByTestId('Cancel-backToOrder')).toBeTruthy();
  });
});

describe('the Cancel button', () => {
  it('is not drawn when the server says the order can no longer be cancelled', async () => {
    renderWaiting({ getOrder: ok(order('order_restaurant_pending', { can_cancel: false })) });
    await screen.findByTestId('Tracking-body');
    expect(screen.queryByTestId('Tracking-cancel')).toBeNull();
    await act(async () => {});
  });
});
