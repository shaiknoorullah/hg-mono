/**
 * Payment recovery against the contract's fixtures, reached through the tracking route for an unpaid
 * order: the bank check (3-D Secure), a declined card, choosing another card, and cancelling.
 *
 * What the contract cannot do is asserted as absent: nothing here pays the same order with another
 * card, and cancelling is the only way out of a declined card.
 */
import * as React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { clearNextCard, peekNextCard } from '../../checkout/nextCard';
import { setNowOverride } from '../../lib/now';
import { formatTime } from '../../lib/time';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { keysOf, MONEY_KEY } from '../../test/requests';
import { TrackingScreen } from '../TrackingScreen';

jest.mock('../../../payments/pay', () => ({ payWithSheet: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { payWithSheet } = require('../../../payments/pay') as { payWithSheet: jest.Mock };

type Order = Schema['OrderCustomerView'];
type Payment = Schema['OrderPayment'];
type Method = Schema['PaymentMethod'];

const ok = (data: unknown): MockAnswer => ({ status: 200, body: { data } });
const list = (data: unknown[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false } } });
const order = (scenario: string, patch: Partial<Order> = {}): Order => ({ ...payloadOf<Order>(scenario), ...patch });
const payment = (scenario: string, patch: Partial<Payment> = {}): Payment => ({ ...payloadOf<Payment>(scenario), ...patch });
const DECLINED = (): Payment =>
  payment('payment_requires_payment_method', {
    card_brand: 'visa',
    card_last4: '4242',
    failure_code: 'card_declined',
    decline_code: 'insufficient_funds',
  });
const cards = (): Method[] => payloadOf<Method[]>('payment_methods_list');

let mock: MockApi;
beforeEach(() => {
  payWithSheet.mockReset();
  clearNextCard();
  // Fixed so the fixture cards' expiry dates (Amex 08/2026) read the same on every run.
  setNowOverride({ at: Date.parse('2026-09-15T16:00:00Z') });
});
afterEach(() => {
  mock?.restore();
  setNowOverride(null);
});

function renderUnpaid(answers: Record<string, MockAnswer> = {}) {
  const created = order('order_created');
  mock = mockApi({
    getOrder: ok(created),
    getOrderPayment: 'payment_requires_action',
    getOrderTracking: 'tracking_preparing',
    listRefunds: list([]),
    listPaymentMethods: list(cards()),
    ...answers,
  });
  const nav = navSpy({ name: 'tracking', orderId: created.id });
  renderRedesign(<TrackingScreen orderId={created.id} />, { nav });
  return { nav, created };
}

describe('confirm with your bank (3-D Secure)', () => {
  it('says what the bank wants, until when the order waits, and has no cancel in the footer', async () => {
    const { created } = renderUnpaid();
    expect(await screen.findByTestId('Recovery-h1')).toBeTruthy();
    expect(screen.getByText('Confirm with your bank')).toBeTruthy();
    expect(screen.getByTestId('Recovery-line').props.children).toContain("Your bank wants to check it's you");
    expect(screen.getByTestId('Recovery-deadline').props.children).toContain(formatTime(created.deadline_at!));
    // One cancel button, on the page itself.
    expect(screen.getAllByText('Cancel order')).toHaveLength(1);
    expect(screen.queryByTestId('Tracking-cancel')).toBeNull();
    expect(screen.queryByText('Choose another card')).toBeNull();
  });

  it('Continue to your bank resumes the challenge with the client secret, then says the hold is being placed', async () => {
    const needsAction = payment('payment_requires_action');
    payWithSheet.mockResolvedValue({ status: 'paid' });
    renderUnpaid({ getOrderPayment: [ok(needsAction), ok(payment('payment_processing')), ok(payment('payment_processing'))] });
    fireEvent.press(await screen.findByTestId('Recovery-continue'));
    await waitFor(() => expect(payWithSheet).toHaveBeenCalledWith(needsAction.client_secret));
    const line = await screen.findByTestId('Tracking-waitLine');
    expect(JSON.stringify(line.props.children)).toContain("Your bank has confirmed it's you. Placing the hold");
    expect(screen.queryByTestId('Recovery-body')).toBeNull();
  });

  it('closing the bank check is not a failure: nothing was charged and the button is still there', async () => {
    payWithSheet.mockResolvedValue({ status: 'canceled' });
    renderUnpaid();
    fireEvent.press(await screen.findByTestId('Recovery-continue'));
    expect(await screen.findByTestId('Recovery-notice')).toBeTruthy();
    expect(screen.getByText(/You closed your bank's check\. Nothing was charged/)).toBeTruthy();
    expect(screen.getByTestId('Recovery-continue')).toBeTruthy();
  });

  it('a bank that refuses moves to the declined page, from the server\'s word', async () => {
    payWithSheet.mockResolvedValue({ status: 'failed', message: 'raw bank text that must never show' });
    renderUnpaid({ getOrderPayment: [ok(payment('payment_requires_action')), ok(DECLINED()), ok(DECLINED())] });
    fireEvent.press(await screen.findByTestId('Recovery-continue'));
    expect(await screen.findByTestId('Recovery-declined')).toBeTruthy();
    expect(screen.queryByText(/raw bank text/)).toBeNull();
  });

  it('Cancel order opens the same cancel sheet with no card talk', async () => {
    renderUnpaid();
    fireEvent.press(await screen.findByTestId('Recovery-cancel'));
    expect(await screen.findByTestId('Cancel-sheet')).toBeTruthy();
    expect(screen.queryByTestId('Cancel-intro')).toBeNull();
    expect(screen.getByText("Cancelling ends this order and nothing is charged. This can't be undone.")).toBeTruthy();
  });
});

describe('a declined card', () => {
  it('names the card in a fixed headline, says nothing was charged, and offers two ways out', async () => {
    renderUnpaid({ getOrderPayment: ok(DECLINED()) });
    expect(await screen.findByText("Your payment didn't go through")).toBeTruthy();
    const banner = screen.getByTestId('Recovery-declined');
    expect(within(banner).getByText("Visa •••• 4242 doesn't have enough available")).toBeTruthy();
    expect(within(banner).getByText(/Nothing was charged\. If you choose another card, we'll cancel this order/)).toBeTruthy();
    expect(screen.getByText('Choose another card')).toBeTruthy();
    expect(screen.getByText('Cancel order and leave')).toBeTruthy();
    expect(screen.queryByText(/try this card again|retry/i)).toBeNull();
  });

  it('a fresh order with no card tried yet is the ordinary waiting page, not a decline', async () => {
    renderUnpaid({ getOrderPayment: 'payment_requires_payment_method' });
    expect(await screen.findByTestId('Tracking-h1')).toBeTruthy();
    expect(screen.queryByTestId('Recovery-body')).toBeNull();
  });

  it('opening the card sheet cancels nothing; the declined card is listed last and never chosen', async () => {
    renderUnpaid({ getOrderPayment: ok(DECLINED()) });
    fireEvent.press(await screen.findByTestId('Recovery-chooseCard'));
    expect(await screen.findByTestId('ChooseCard-sheet')).toBeTruthy();
    const [visa, mastercard, amex] = cards();
    expect(await screen.findByTestId(`ChooseCard-card-${mastercard.id}`)).toBeTruthy();
    expect(screen.getByTestId(`ChooseCard-card-${mastercard.id}`).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId(`ChooseCard-card-${visa.id}`).props.accessibilityState?.checked).not.toBe(true);
    // An expired card is shown as expired and cannot be the chosen one.
    expect(screen.getByText('Expired 08/26')).toBeTruthy();
    expect(screen.getByTestId(`ChooseCard-card-${amex.id}`).props.accessibilityState?.checked).not.toBe(true);
    expect(screen.getByTestId('ChooseCard-consequence').props.children).toContain('Mastercard •••• 5454 is chosen when you pay.');
    expect(mock.callsTo('cancelOrder')).toHaveLength(0);
  });

  it('Not now closes the sheet and leaves the order as it was', async () => {
    renderUnpaid({ getOrderPayment: ok(DECLINED()) });
    fireEvent.press(await screen.findByTestId('Recovery-chooseCard'));
    fireEvent.press(await screen.findByTestId('ChooseCard-notNow'));
    await waitFor(() => expect(screen.queryByTestId('ChooseCard-sheet')).toBeNull());
    expect(mock.callsTo('cancelOrder')).toHaveLength(0);
    expect(screen.getByTestId('Recovery-declined')).toBeTruthy();
  });

  it('cancel and order again: asks for a reason, cancels with an idempotent request, puts the items back, opens the cart with the card chosen', async () => {
    const { nav, created } = renderUnpaid({
      getOrderPayment: ok(DECLINED()),
      cancelOrder: ok(order('order_cancelled', { id: order('order_created').id })),
      addCartLine: ok(payloadOf('cart_single_line')),
    });
    fireEvent.press(await screen.findByTestId('Recovery-chooseCard'));
    const mastercard = cards()[1];
    await screen.findByTestId(`ChooseCard-card-${mastercard.id}`);
    fireEvent.press(screen.getByTestId('ChooseCard-confirm'));

    // The cancel sheet says where the customer goes next, and still needs a reason.
    expect(await screen.findByTestId('Cancel-intro')).toBeTruthy();
    expect(screen.getByTestId('Cancel-intro').props.children).toContain("we'll put your items back in your cart. Mastercard •••• 5454 is chosen when you pay.");
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    expect(await screen.findByTestId('Cancel-reasons-error')).toBeTruthy();
    expect(mock.callsTo('cancelOrder')).toHaveLength(0);

    fireEvent.press(screen.getByTestId('Cancel-reason-CHANGED_MIND'));
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'replace', route: { name: 'cart' } }));

    const [cancel] = mock.callsTo('cancelOrder');
    expect(cancel.headers['idempotency-key']).toBeTruthy();
    expect(cancel.body).toEqual({ reason_code: 'CHANGED_MIND' });
    const adds = mock.callsTo('addCartLine');
    expect(adds).toHaveLength(created.lines.length);
    for (const call of adds) {
      expect(call.headers['idempotency-key']).toBeTruthy();
      expect(keysOf(call.body).filter((k) => MONEY_KEY.test(k) && k !== 'addon_quantity')).toEqual([]);
    }
    expect(peekNextCard()).toBe(mastercard.id);
  });

  it('Keep my order from that cancel sheet returns to the card sheet and cancels nothing', async () => {
    renderUnpaid({ getOrderPayment: ok(DECLINED()) });
    fireEvent.press(await screen.findByTestId('Recovery-chooseCard'));
    await screen.findByTestId(`ChooseCard-card-${cards()[1].id}`);
    fireEvent.press(screen.getByTestId('ChooseCard-confirm'));
    fireEvent.press(await screen.findByTestId('Cancel-keep'));
    expect(await screen.findByTestId('ChooseCard-sheet')).toBeTruthy();
    expect(mock.callsTo('cancelOrder')).toHaveLength(0);
  });

  it('Cancel order and leave is a plain cancel: no items put back, no card remembered', async () => {
    const { nav } = renderUnpaid({
      getOrderPayment: [ok(DECLINED()), 'payment_canceled'],
      getOrder: [ok(order('order_created')), ok(order('order_cancelled', { id: order('order_created').id }))],
      cancelOrder: ok(order('order_cancelled', { id: order('order_created').id })),
    });
    fireEvent.press(await screen.findByTestId('Recovery-cancel'));
    fireEvent.press(await screen.findByTestId('Cancel-reason-CHANGED_MIND'));
    fireEvent.press(screen.getByTestId('Cancel-confirm'));
    expect(await screen.findByTestId('Outcome')).toBeTruthy();
    expect(mock.callsTo('addCartLine')).toHaveLength(0);
    expect(nav.log.find((l) => l.route?.name === 'cart')).toBeUndefined();
    expect(peekNextCard()).toBeUndefined();
  });
});

describe('the card sheet\'s own states', () => {
  it('loading while the saved cards are read', async () => {
    renderUnpaid({ getOrderPayment: ok(DECLINED()), listPaymentMethods: 'hang' });
    fireEvent.press(await screen.findByTestId('Recovery-chooseCard'));
    expect(await screen.findByTestId('ChooseCard-loading')).toBeTruthy();
    expect(screen.queryByTestId('ChooseCard-confirm')).toBeNull();
  });

  it('a failed read says so, keeps the order as it was, and Try again reads again', async () => {
    renderUnpaid({ getOrderPayment: ok(DECLINED()), listPaymentMethods: [{ status: 500, code: 'INTERNAL_ERROR' }, list(cards())] });
    fireEvent.press(await screen.findByTestId('Recovery-chooseCard'));
    expect(await screen.findByText("We couldn't load your saved cards")).toBeTruthy();
    expect(screen.getByText("Check your connection and try again. Your order hasn't changed.")).toBeTruthy();
    fireEvent.press(screen.getByTestId('ChooseCard-retry'));
    expect(await screen.findByTestId(`ChooseCard-card-${cards()[1].id}`)).toBeTruthy();
  });

  it('with no other usable card it says so and offers a new card or wallet', async () => {
    renderUnpaid({ getOrderPayment: ok(DECLINED()), listPaymentMethods: list([cards()[0]]) });
    fireEvent.press(await screen.findByTestId('Recovery-chooseCard'));
    expect(await screen.findByTestId('ChooseCard-empty')).toBeTruthy();
    expect(screen.queryByTestId(`ChooseCard-card-${cards()[0].id}`)).toBeNull();
    expect(screen.getByTestId('ChooseCard-new')).toBeTruthy();
    expect(screen.getByTestId('ChooseCard-consequence').props.children).toContain('A new card or wallet is chosen when you pay.');
  });
});

describe('a payment that failed for good (the order has ended)', () => {
  it('Choose another card opens the card sheet whose primary only puts the items back', async () => {
    const failed = order('order_failed');
    mock = mockApi({
      getOrder: ok(failed),
      getOrderPayment: 'payment_failed',
      listRefunds: list([]),
      listPaymentMethods: list(cards()),
      addCartLine: ok(payloadOf('cart_single_line')),
    });
    const nav = navSpy({ name: 'tracking', orderId: failed.id });
    renderRedesign(<TrackingScreen orderId={failed.id} />, { nav });

    fireEvent.press(await screen.findByTestId('Outcome-chooseCard'));
    expect(await screen.findByText('Choose a card')).toBeTruthy();
    const mastercard = cards()[1];
    await screen.findByTestId(`ChooseCard-card-${mastercard.id}`);
    expect(screen.getByTestId('ChooseCard-consequence').props.children).toBe('Nothing was charged for this order.');
    expect(screen.queryByText(/^Cancel and order again/)).toBeNull();

    fireEvent.press(screen.getByTestId('ChooseCard-confirm'));
    await waitFor(() => expect(nav.log).toContainEqual({ action: 'replace', route: { name: 'cart' } }));
    expect(mock.callsTo('cancelOrder')).toHaveLength(0);
    expect(mock.callsTo('addCartLine')).toHaveLength(failed.lines.length);
    expect(peekNextCard()).toBe(mastercard.id);
  });
});
