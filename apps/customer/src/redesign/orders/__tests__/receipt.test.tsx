/**
 * T10 Receipt against the contract's fixtures (WP9 DONE list): charged (service fee at $0.00, no
 * tax rows while `tax_lines` is empty, legal names and tax numbers only when present), pickup,
 * the refund section per RefundState, the 409 variants chosen by the payment, loading, error, dark.
 */
import * as React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { resetConnectivity } from '../../lib/connectivity';
import { mockApi, payloadOf, type MockAnswer, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { ReceiptScreen } from '../ReceiptScreen';

type Receipt = Schema['Receipt'];
type Refund = Schema['Refund'];
type OrderPayment = Schema['OrderPayment'];
type Order = Schema['OrderCustomerView'];

const standard = payloadOf<Receipt>('receipt_standard');
const ORDER_ID = standard.order_id;

const ok = (data: unknown): MockAnswer => ({ status: 200, body: { data } });
const list = (data: unknown[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false } } });
const NOT_READY: MockAnswer = 'error_receipt_not_ready';

/** Launch-day receipt: no tax lines (HST registration open), no service fee, no tax numbers. */
const launch: Receipt = {
  ...standard,
  platform_tax_registration_number: null,
  restaurant_tax_registration_number: null,
  money: { ...standard.money, service_fee_cents: 0 as Schema['Cents'], tax_lines: [], tax_total_cents: 0 as Schema['Cents'] },
};

let mock: MockApi;

beforeEach(() => resetConnectivity());
afterEach(() => mock?.restore());

function renderReceipt(answers: Record<string, MockAnswer>, scheme: 'light' | 'dark' = 'light') {
  mock = mockApi({ listRefunds: list([]), ...answers });
  const nav = navSpy({ name: 'receipt', orderId: ORDER_ID });
  renderRedesign(<ReceiptScreen orderId={ORDER_ID} />, { nav, scheme });
  return nav;
}

function textOf(testID: string): string {
  const node = screen.getByTestId(testID);
  const kids = node.props.children;
  return Array.isArray(kids) ? kids.join('') : String(kids);
}

describe('Receipt (T10)', () => {
  it('shows a charged receipt: service fee at $0.00, no tax rows while tax_lines is empty', async () => {
    renderReceipt({ getOrderReceipt: ok(launch) });
    expect(await screen.findByTestId('Receipt-body')).toBeTruthy();
    for (const label of ['Receipt number', 'Order', 'Issued', 'Placed', 'Delivered', 'From', 'Delivered to', 'Items', 'Summary', 'Items subtotal', 'Delivery fee', 'Service fee', 'Rider tip', 'Total', 'Payment']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('HG-2026-000148213')).toBeTruthy();
    expect(screen.getByText('HalalGoes Technologies Inc.')).toBeTruthy();
    expect(screen.getByText('Karachi Kitchen Inc.')).toBeTruthy();
    expect(screen.getByText('88 Harbour Street, Unit 4211, Toronto ON M5J 0C3')).toBeTruthy();
    expect(screen.getByText('1 × Chicken Biryani')).toBeTruthy();
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.getByText('2 × Garlic naan')).toBeTruthy();
    expect(textOf('Receipt-row-service-price')).toContain('$0.00');
    expect(screen.queryByTestId('Receipt-row-tax-0')).toBeNull();
    expect(screen.queryByText(/HST/)).toBeNull();
    expect(screen.getByText('Visa •••• 4242, charged')).toBeTruthy();
    expect(textOf('Receipt-charged')).toContain('$106.84');
    expect(textOf('Receipt-total')).toContain('$106.84');
    // No download or share until the contract has a receipt PDF; no refund section without refunds.
    expect(screen.queryByText(/Download|Share/)).toBeNull();
    expect(screen.queryByText('Refund')).toBeNull();
    // Reads only, and the refunds for this order.
    expect(new URL(mock.callsTo('listRefunds')[0]!.url).searchParams.get('order_id')).toBe(ORDER_ID);
    expect(mock.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('prints tax rows and both tax numbers when the server sends them', async () => {
    renderReceipt({ getOrderReceipt: 'receipt_standard' });
    await screen.findByTestId('Receipt-body');
    expect(screen.getByText('HST (13%)')).toBeTruthy();
    expect(screen.getByTestId('Receipt-platformTax')).toBeTruthy();
    expect(screen.getByTestId('Receipt-restaurantTax')).toBeTruthy();
  });

  it('leaves the zero delivery fee and tip out of a pickup receipt', async () => {
    renderReceipt({ getOrderReceipt: 'receipt_pickup_zero_tip' });
    await screen.findByTestId('Receipt-body');
    expect(screen.queryByText('Delivery fee')).toBeNull();
    expect(screen.queryByText('Rider tip')).toBeNull();
    expect(screen.queryByText('Delivered to')).toBeNull();
    expect(screen.getByText('Service fee')).toBeTruthy();
  });

  it('adds a settled refund below the original receipt with its reason line', async () => {
    const refunds = payloadOf<Receipt>('receipt_with_refund').refunds as Refund[];
    renderReceipt({ getOrderReceipt: 'receipt_with_refund', listRefunds: list(refunds) });
    const card = within(await screen.findByTestId(`Receipt-refund-${refunds[0]!.id}`));
    expect(card.getByText('Refund')).toBeTruthy();
    expect(card.getByText('Refunded')).toBeTruthy();
    expect(card.getByText(/^Refunded to Visa •••• 4242 on /)).toBeTruthy();
    expect(card.getByText('For missing items. Added below the original receipt, which never changes.')).toBeTruthy();
  });

  it('says "Refund in progress", never "Refunded", for a failed refund, and never shows the note', async () => {
    const failed = payloadOf<Refund>('refund_failed');
    renderReceipt({ getOrderReceipt: ok(launch), listRefunds: list([failed]) });
    const card = within(await screen.findByTestId(`Receipt-refund-${failed.id}`));
    expect(card.getByText('Refund in progress')).toBeTruthy();
    expect(card.getByText('Taking longer than usual. Our team is on it.')).toBeTruthy();
    expect(card.queryByText(/Refunded/)).toBeNull();
    expect(screen.queryByText(failed.note!)).toBeNull();
    expect(screen.queryByText(failed.failure_message!)).toBeNull();
  });

  it('words every refund state', async () => {
    const states: Array<[string, string]> = [
      ['refund_requested', 'Under review'],
      ['refund_pending_approval', 'Under review'],
      ['refund_approved', 'On its way'],
      ['refund_submitted', 'On its way'],
      ['refund_settled', 'Refunded'],
      ['refund_declined', 'Not approved'],
      ['refund_cancelled', 'Withdrawn'],
    ];
    const refunds = states.map(([s], i) => ({ ...payloadOf<Refund>(s), id: `00000000-0000-4000-8000-00000000000${i}` }));
    renderReceipt({ getOrderReceipt: ok(launch), listRefunds: list(refunds) });
    await screen.findByTestId('Receipt-body');
    states.forEach(([, badge], i) => {
      expect(within(screen.getByTestId(`Receipt-refund-${refunds[i]!.id}`)).getByText(badge)).toBeTruthy();
    });
    expect(screen.getAllByText("Requested on 10 August 2026. We'll set the amount when we decide.").length).toBeGreaterThan(0);
  });

  it('falls back to the refunds on the snapshot when listRefunds fails', async () => {
    const refunds = payloadOf<Receipt>('receipt_with_refund').refunds as Refund[];
    renderReceipt({ getOrderReceipt: 'receipt_with_refund', listRefunds: { status: 500, code: 'INTERNAL_ERROR' } });
    expect(await screen.findByTestId(`Receipt-refund-${refunds[0]!.id}`)).toBeTruthy();
  });

  describe('when there is no receipt (409 RECEIPT_NOT_READY)', () => {
    const payment = payloadOf<OrderPayment>('payment_succeeded');
    const order = payloadOf<Order>('order_delivered');

    it('is not ready yet while the order is DELIVERED', async () => {
      const nav = renderReceipt({ getOrderReceipt: NOT_READY, getOrder: 'order_delivered', getOrderPayment: ok(payment) });
      expect(await screen.findByText("Your receipt isn't ready yet")).toBeTruthy();
      expect(screen.getByText("We issue it once your order is complete. We'll let you know when it's ready.")).toBeTruthy();
      fireEvent.press(screen.getByText('Back to order'));
      expect(nav.log).toContainEqual({ action: 'replace', route: { name: 'tracking', orderId: ORDER_ID } });
    });

    it('was never issued for an order reviewed before it completed', async () => {
      renderReceipt({
        getOrderReceipt: NOT_READY,
        getOrder: ok({ ...payloadOf<Order>('order_resolved'), completed_at: null }),
        getOrderPayment: ok(payment),
      });
      expect(await screen.findByText("There's no receipt for this order")).toBeTruthy();
      expect(
        screen.getByText(
          'It was reviewed before it was complete, so no receipt was issued. What you were charged and refunded is on the order page.',
        ),
      ).toBeTruthy();
    });

    it('says the hold was released when an authorised order was never captured', async () => {
      const nav = renderReceipt({
        getOrderReceipt: NOT_READY,
        getOrder: 'order_rejected',
        getOrderPayment: ok({ ...payment, state: 'CANCELED', amount_authorized_cents: 4826, amount_captured_cents: 0 }),
      });
      expect(await screen.findByText('No receipt for this order')).toBeTruthy();
      expect(
        screen.getByText(
          "You weren't charged, so there is nothing to show. The hold on your card was released when the order didn't go ahead.",
        ),
      ).toBeTruthy();
      fireEvent.press(screen.getByText('Back to Orders'));
      expect(nav.log).toContainEqual({ action: 'back' });
    });

    it("says the payment didn't go through when nothing was authorised on a failed order", async () => {
      renderReceipt({
        getOrderReceipt: NOT_READY,
        getOrder: ok({ ...order, state: 'FAILED', cancel_reason: null }),
        getOrderPayment: ok({ ...payment, state: 'FAILED', amount_authorized_cents: 0, amount_captured_cents: 0 }),
      });
      expect(
        await screen.findByText("You weren't charged, so there is nothing to show. Your payment didn't go through, so nothing was charged."),
      ).toBeTruthy();
    });

    it('says nothing was charged for a cancel before payment', async () => {
      renderReceipt({ getOrderReceipt: NOT_READY, getOrder: 'order_cancelled', getOrderPayment: 'payment_canceled' });
      expect(await screen.findByText("You weren't charged, so there is nothing to show. Nothing was charged.")).toBeTruthy();
    });

    it('shows the error when it cannot tell which', async () => {
      renderReceipt({
        getOrderReceipt: NOT_READY,
        getOrder: { status: 500, code: 'INTERNAL_ERROR' },
        getOrderPayment: { status: 500, code: 'INTERNAL_ERROR' },
      });
      expect(await screen.findByText("We couldn't load your receipt")).toBeTruthy();
    });
  });

  it('shows loading with the total held in place', () => {
    renderReceipt({ getOrderReceipt: 'hang' });
    expect(screen.getByTestId('Receipt-loading')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('shows the error with Try again and Get help', async () => {
    const nav = renderReceipt({ getOrderReceipt: [{ status: 500, code: 'INTERNAL_ERROR' }, ok(launch)] });
    expect(await screen.findByText("We couldn't load your receipt")).toBeTruthy();
    expect(screen.getByText("Check your connection and try again. Your receipt is kept safely and won't change.")).toBeTruthy();
    fireEvent.press(screen.getByText('Get help'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'tracking', orderId: ORDER_ID } });
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByTestId('Receipt-body')).toBeTruthy());
  });

  it('renders in dark', async () => {
    renderReceipt({ getOrderReceipt: ok(launch) }, 'dark');
    expect(await screen.findByTestId('Receipt-body')).toBeTruthy();
    expect(screen.getByText('Visa •••• 4242, charged')).toBeTruthy();
  });
});
