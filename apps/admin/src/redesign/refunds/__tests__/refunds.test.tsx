import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession, type MockApi } from '../../testing';
import OrderRoute from '../../orders/workspace/OrderRoute';
import { freezeClock, order as orderFixture, page, type Order } from '../../orders/__tests__/support';
import RefundsRoute from '../RefundsRoute';

beforeEach(() => {
  freezeClock();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Role = 'ADMIN' | 'SUPPORT_AGENT';
const REASON_TEXT = 'The platter was cold and undercooked.';
const refundBody = (api: MockApi) => api.callsTo('issueRefund').at(-1)?.body as Record<string, unknown>;

function openOrder(o: Order, role: Role = 'ADMIN', extra: Parameters<typeof mockApi>[0] = {}): MockApi {
  const api = mockApi({ getOrderAdmin: { data: o }, ...extra });
  renderRedesign(<Route path="/orders/:orderId" element={<OrderRoute />} />, { route: `/orders/${o.id}?from=all`, principal: role });
  return api;
}

async function startRefund() {
  fireEvent.click(await screen.findByRole('button', { name: 'Issue refund…' }));
  return screen.findByRole('region', { name: /Issue a refund/ });
}

function fillWhole(panel: HTMLElement) {
  fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'FOOD_QUALITY' } });
  fireEvent.change(within(panel).getByLabelText(/What happened/), { target: { value: REASON_TEXT } });
}

async function review(panel: HTMLElement) {
  fireEvent.click(within(panel).getByRole('button', { name: 'Review refund' }));
  return screen.findByRole('region', { name: /Review before money moves/ });
}

describe('issuing a refund from the order workspace', () => {
  it('sends the whole order with no amount, one Idempotency-Key, and shows the server’s amount and split', async () => {
    const issued = { ...fixture<Record<string, unknown>>('refund_authorised'), state: 'AUTHORISED' };
    const o = orderFixture('order_admin_view_delivered');
    const api = openOrder(o, 'ADMIN', { issueRefund: { status: 201, body: { data: issued } } });
    const panel = await startRefund();
    fillWhole(panel);
    const reviewing = await review(panel);
    expect(within(reviewing).getByText(/Calculated by the server when you issue it/)).toBeTruthy();
    fireEvent.click(within(reviewing).getByRole('button', { name: 'Issue refund' }));

    const done = await screen.findByRole('region', { name: /Refund issued/ });
    expect(within(done).getByText(/Refund issued. Sent to the payment provider./)).toBeTruthy();
    // $16.95 is the server's own figure from the fixture, not anything the page worked out.
    expect(within(done).getAllByText(/16\.95/).length).toBeGreaterThan(0);
    expect(within(done).getByText(/Who bears it: restaurant/)).toBeTruthy();

    const call = api.callsTo('issueRefund')[0]!;
    expect(call.headers['idempotency-key']).toMatch(/.{16,}/);
    expect(call.body).toEqual({ order_id: o.id, scope: 'FULL', reason_code: 'FOOD_QUALITY', reason_text: REASON_TEXT });
    // The order is read again so its refund rows are the server's.
    await waitFor(() => expect(api.callsTo('getOrderAdmin').length).toBeGreaterThan(1));
  });

  it('shows 202 as its own result: nothing moved, who must approve, the server’s amount', async () => {
    const request = fixture<{ proposed_amount_cents: number }>('refund_approval_request_pending');
    openOrder(orderFixture('order_admin_view_delivered'), 'SUPPORT_AGENT', { issueRefund: { status: 202, body: { data: request } } });
    const panel = await startRefund();
    fillWhole(panel);
    fireEvent.click(within(await review(panel)).getByRole('button', { name: 'Issue refund' }));
    const done = await screen.findByRole('region', { name: /Sent for approval/ });
    expect(within(done).getByText(/Sent for approval. Nothing has moved yet./)).toBeTruthy();
    expect(within(done).getAllByText(/45\.00/).length).toBeGreaterThan(0);
    expect(within(done).getByText(/An admin or a super admin/)).toBeTruthy();
    expect(within(done).queryByText(/Refund issued/)).toBeNull();
  });

  it('sends goodwill as whole cents, and offers it to a support agent because the server allows it', async () => {
    const api = openOrder(orderFixture('order_admin_view_delivered'), 'SUPPORT_AGENT', {
      issueRefund: { status: 201, body: { data: fixture('refund_goodwill_admin') } },
    });
    const panel = await startRefund();
    fireEvent.click(within(panel).getByRole('radio', { name: /Goodwill amount/ }));
    fireEvent.change(within(panel).getByLabelText(/Goodwill amount/, { selector: 'input[type="text"]' }), { target: { value: '12.35' } });
    fireEvent.change(within(panel).getByLabelText(/What happened/), { target: { value: 'Late twice this month; a gesture.' } });
    fireEvent.click(within(await review(panel)).getByRole('button', { name: 'Issue refund' }));
    await screen.findByRole('region', { name: /Refund issued/ });
    expect(refundBody(api)).toMatchObject({ scope: 'PARTIAL_AMOUNT', reason_code: 'GOODWILL', amount_cents: 1235 });
  });

  it('checks a short reason and an empty item list before sending anything', async () => {
    const api = openOrder(orderFixture('order_admin_view_delivered'));
    const panel = await startRefund();
    fireEvent.click(within(panel).getByRole('radio', { name: /Selected items/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Review refund' }));
    expect(await within(panel).findByText('Choose at least one item to refund.')).toBeTruthy();
    expect(within(panel).getByText(/Write at least 10 characters/)).toBeTruthy();
    expect(api.callsTo('issueRefund')).toHaveLength(0);
  });

  it('names the lines another refund already holds, and switches to selected items keeping the draft', async () => {
    openOrder(orderFixture('order_admin_view_delivered'), 'ADMIN', { issueRefund: 'error_refund_already_requested_items' });
    const panel = await startRefund();
    fillWhole(panel);
    fireEvent.click(within(await review(panel)).getByRole('button', { name: 'Issue refund' }));
    const again = await screen.findByRole('region', { name: /Review before money moves/ });
    expect(within(again).getByText(/already covers line 1/)).toBeTruthy();
    fireEvent.click(within(again).getByRole('button', { name: 'Switch to selected items' }));
    const items = await screen.findByRole('region', { name: /Issue a refund/ });
    expect(within(items).getByRole('radio', { name: /Selected items/ }).getAttribute('aria-checked')).toBe('true');
    expect((within(items).getByLabelText(/What happened/) as HTMLTextAreaElement).value).toBe(REASON_TEXT);
  });

  it('says what to do when the session has no authenticator code, and keeps the draft', async () => {
    openOrder(orderFixture('order_admin_view_delivered'), 'ADMIN', { issueRefund: 'error_refund_mfa_required' });
    const panel = await startRefund();
    fillWhole(panel);
    fireEvent.click(within(await review(panel)).getByRole('button', { name: 'Issue refund' }));
    expect(await screen.findByText('Turn on two-step sign-in to move money')).toBeTruthy();
    expect((screen.getByRole('region', { name: /Issue a refund|Review before money moves/ })).textContent).toContain(REASON_TEXT);
  });

  it('retries a timed-out request with the same Idempotency-Key, so it can never refund twice', async () => {
    let n = 0;
    const api = openOrder(orderFixture('order_admin_view_delivered'), 'ADMIN', {
      issueRefund: () => (++n === 1 ? { status: 503, body: { error: { code: 'INTERNAL_ERROR', message: 'Upstream timeout.', request_id: '01JTESTREQUEST0000000000000' } } } : { status: 201, body: { data: fixture('refund_authorised') } }),
    });
    const panel = await startRefund();
    fillWhole(panel);
    fireEvent.click(within(await review(panel)).getByRole('button', { name: 'Issue refund' }));
    expect(await screen.findByText('The server didn’t answer in time')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('region', { name: /Refund issued/ });
    const keys = api.callsTo('issueRefund').map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('draws no refund form for an order that was never charged', async () => {
    const rejected = orderFixture('order_admin_view_rejected');
    const api = openOrder({ ...rejected, payment: { ...rejected.payment, state: 'CANCELED' } });
    fireEvent.click(await screen.findByRole('button', { name: /More actions/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Issue refund/ }));
    const panel = await screen.findByRole('region', { name: /Issue a refund/ });
    expect(within(panel).getByText('Nothing was charged, so there is nothing to refund')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Review refund' })).toBeNull();
    expect(api.callsTo('issueRefund')).toHaveLength(0);
  });
});

describe('the Refunds page', () => {
  const show = (extra: Parameters<typeof mockApi>[0] = {}, role: Role = 'ADMIN') => {
    const api = mockApi(extra);
    renderRedesign(<Route path="/refunds" element={<RefundsRoute />} />, { route: '/refunds', principal: role });
    return api;
  };

  it('lists failed refunds with the server’s amounts and reasons, asking only for the Failed state', async () => {
    const rows = fixture<unknown[]>('admin_refund_queue_failed');
    const api = show({ listRefundsAdmin: { data: rows, meta: { next_cursor: null, has_more: false } } });
    const grid = await screen.findByRole('grid', { name: 'Failed refunds' });
    expect(within(grid).getByText('HG-COED-9X')).toBeTruthy();
    expect(within(grid).getAllByText(/19\.15/).length).toBeGreaterThan(0);
    expect(api.callsTo('listRefundsAdmin')[0]!.query['state']).toBe('FAILED');
  });

  it('says a failed load is not an empty list, and an empty list is not a failed load', async () => {
    show({ listRefundsAdmin: { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Down.', request_id: '01JTESTREQUEST0000000000000' } } } });
    expect(await screen.findByText('Failed refunds didn’t load')).toBeTruthy();
    expect(screen.getByText('This doesn’t mean there are none. Nothing was changed.')).toBeTruthy();
    cleanup();
    resetSession();
    show({ listRefundsAdmin: { data: [], meta: { next_cursor: null, has_more: false } } });
    expect(await screen.findByText('No failed refunds')).toBeTruthy();
    expect(screen.queryByText('Failed refunds didn’t load')).toBeNull();
  });

  it('keeps “no order has this code” apart from “the lookup didn’t finish”', async () => {
    const api = show({ listRefundsAdmin: { data: [], meta: { next_cursor: null, has_more: false } }, listOrdersAdmin: { data: [], meta: page([]).meta } });
    fireEvent.change(await screen.findByLabelText('Order code'), { target: { value: 'hg-7q2m4k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(await screen.findByText('No order has the code HG-7Q2M4K')).toBeTruthy();
    expect(api.callsTo('listOrdersAdmin')[0]!.query['code']).toBe('HG-7Q2M4K');

    api.set({ listOrdersAdmin: { status: 503, body: { error: { code: 'INTERNAL_ERROR', message: 'Down.', request_id: '01JTESTREQUEST0000000000000' } } } });
    fireEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(await screen.findByText("The lookup didn't finish.")).toBeTruthy();
    expect(screen.getByText(/This is not the same as “no order”/)).toBeTruthy();
    expect(screen.queryByText(/No order has the code/)).toBeNull();
  });

  it('never searches a code that cannot be one', async () => {
    const api = show({ listRefundsAdmin: { data: [], meta: { next_cursor: null, has_more: false } } });
    fireEvent.change(await screen.findByLabelText('Order code'), { target: { value: 'HG-OOOOOO' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(await screen.findByText(/so it wasn’t searched/)).toBeTruthy();
    expect(api.callsTo('listOrdersAdmin')).toHaveLength(0);
  });

  it('starts a replacement from a failed refund with its scope and reason filled in', async () => {
    const rows = fixture<Array<{ order_id: string }>>('admin_refund_queue_failed');
    const o = { ...orderFixture('order_admin_view_delivered'), id: rows[0]!.order_id };
    show({
      listRefundsAdmin: { data: rows, meta: { next_cursor: null, has_more: false } },
      getOrderAdmin: { data: o },
    });
    const grid = await screen.findByRole('grid', { name: 'Failed refunds' });
    fireEvent.click(within(grid).getAllByRole('button', { name: /Actions for the failed refund/ })[0]!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Issue a new refund' }));
    const panel = await screen.findByRole('region', { name: /Issue a refund/ });
    expect(within(panel).getByText(/It goes as a new refund, so the failed one stays on record/)).toBeTruthy();
    expect(within(panel).getByRole('radio', { name: /Selected items/ }).getAttribute('aria-checked')).toBe('true');
    expect((within(panel).getByLabelText('Reason') as HTMLSelectElement).value).toBe('ITEM_MISSING');
  });
});
