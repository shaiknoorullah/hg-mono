import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession, type MockApi } from '../../testing';
import OrderRoute from '../workspace/OrderRoute';
import { freezeClock, order, type Order } from './support';

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

const isDisabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled === true;
const CASE_ID = '0192a4c1-5e7b-7a10-b3c2-9d4e8f117d20';
const err = (code: string, message = 'Refused.', details?: unknown) => ({ error: { code, message, request_id: '01JTESTREQUEST0000000000000', ...(details ? { details } : {}) } });

function open(o: Order, role: 'ADMIN' | 'SUPPORT_AGENT' = 'ADMIN', extra: Parameters<typeof mockApi>[0] = {}): MockApi {
  const api = mockApi({ getOrderAdmin: { data: o }, ...extra });
  renderRedesign(<Route path="/orders/:orderId" element={<OrderRoute />} />, { route: `/orders/${o.id}?from=all`, principal: role });
  return api;
}

async function openCancel() {
  fireEvent.click(await screen.findByRole('button', { name: /More actions/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /Cancel order/ }));
  return screen.findByRole('region', { name: /Cancel order/ });
}

function fillCancel(panel: HTMLElement, text = 'Customer called, ordered to the wrong address.') {
  fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'CUSTOMER_CANCELLED' } });
  fireEvent.change(within(panel).getByLabelText(/What happened/), { target: { value: text } });
  fireEvent.change(within(panel).getByLabelText('Case id'), { target: { value: CASE_ID } });
}

describe('the address', () => {
  it('draws no destination at all while masked, even when the body carries one', async () => {
    // The preparing fixture is not revealed yet still carries a full street address.
    const o = order('order_admin_view_preparing');
    expect(o.pii_revealed).toBe(false);
    open(o);
    await screen.findByRole('heading', { name: o.code });
    expect(screen.queryByText(/Harbour Street/)).toBeNull();
    expect(screen.getByText(/Masked. Revealing needs a reason/)).toBeTruthy();
  });

  it('refuses a short reason without asking, then reveals with the reason sent to the server', async () => {
    const masked = order('order_admin_view_preparing');
    const revealed = order('order_admin_view_pii_revealed', { id: masked.id, code: masked.code, state: masked.state });
    const api = open(masked, 'SUPPORT_AGENT', { getOrderAdmin: (req) => ({ data: req.query['reveal_pii'] === 'true' ? revealed : masked }) });
    fireEvent.click(await screen.findByRole('button', { name: /Reveal address/ }));
    const panel = await screen.findByRole('region', { name: /Reveal the delivery address/ });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reveal address' }));
    expect(await within(panel).findByText(/Write at least 10 characters about why you need it. Nothing was revealed./)).toBeTruthy();
    expect(api.callsTo('getOrderAdmin').some((c) => c.query['reveal_pii'])).toBe(false);

    fireEvent.change(within(panel).getByLabelText(/Why do you need it/), { target: { value: 'Rider cannot find the building.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reveal address' }));
    expect(await screen.findByText(/Harbour Street/)).toBeTruthy();
    const call = api.callsTo('getOrderAdmin').find((c) => c.query['reveal_pii'])!;
    expect(call.query).toMatchObject({ reveal_pii: 'true', justification: 'Rider cannot find the building.' });
  });
});

describe('money, as the server sent it', () => {
  it('raises the ledger residual as an incident, and says nothing when the ledger balances', async () => {
    open(order('order_admin_view_ledger_residual'));
    expect(await screen.findByText('Incident: this order’s ledger doesn’t balance')).toBeTruthy();
    cleanup();
    open(order('order_admin_view_completed'));
    await screen.findByRole('heading', { name: order('order_admin_view_completed').code });
    expect(screen.queryByText(/ledger doesn’t balance/)).toBeNull();
  });

  it('shows a failed refund as failed with no money moved, and settlement held', async () => {
    // The fixture is Completed; a delivered order is the one a failed refund holds (it re-arms its deadline).
    const deadline = new Date(Date.now() + 70_000).toISOString();
    open(order('order_admin_view_refund_failed_settlement_held', { state: 'DELIVERED', deadline_at: deadline }));
    expect(await screen.findByText('A refund failed. No money moved.')).toBeTruthy();
    expect(screen.getByText(/Held while a refund has failed/)).toBeTruthy();
    expect(screen.getByText('Failed, no money moved')).toBeTruthy();
  });

  it('renders a card chargeback from the order, and leaves the state as it is', async () => {
    const o = order('order_admin_view_chargeback');
    expect(o.chargebacks.length).toBeGreaterThan(0);
    open(o);
    expect(await screen.findByText('Card chargeback on this order')).toBeTruthy();
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });
});

describe('cancelling', () => {
  it('sends the reason, the notes, the case and one Idempotency-Key, and shows the order the server returned', async () => {
    const before = order('order_admin_view_authorized');
    const after = order('order_admin_view_cancelled', { id: before.id, code: before.code });
    const api = open(before, 'ADMIN', { cancelOrderAdmin: { data: after } });
    const panel = await openCancel();
    fillCancel(panel);
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel order' }));
    expect(await screen.findByText('Cancelled. Authorisation voided.')).toBeTruthy();
    const [call] = api.callsTo('cancelOrderAdmin');
    expect(call!.body).toEqual({ reason_code: 'CUSTOMER_CANCELLED', reason_text: 'Customer called, ordered to the wrong address.', case_id: CASE_ID });
    expect(call!.headers['idempotency-key']).toMatch(/\S{8,}/);
    // The money is the server's call: the request names no amount and no refund type.
    expect(JSON.stringify(call!.body)).not.toMatch(/cents|refund/);
  });

  it('does not send until the reason, the notes and a real case id are there', async () => {
    const api = open(order('order_admin_view_authorized'));
    const panel = await openCancel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel order' }));
    expect(await within(panel).findByText('Choose why you are cancelling.')).toBeTruthy();
    expect(within(panel).getByText(/Write at least 10 characters/)).toBeTruthy();
    expect(within(panel).getByText('Enter the case id: it is required to cancel.')).toBeTruthy();
    expect(api.callsTo('cancelOrderAdmin')).toHaveLength(0);
  });

  it('after a timeout the outcome is unknown, and trying again sends the SAME key', async () => {
    let n = 0;
    const before = order('order_admin_view_authorized');
    const api = open(before, 'ADMIN', {
      cancelOrderAdmin: () => (n++ === 0 ? { status: 504, body: err('UPSTREAM_TIMEOUT', 'timeout') } : { data: order('order_admin_view_cancelled', { id: before.id, code: before.code }) }),
    });
    const panel = await openCancel();
    fillCancel(panel);
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel order' }));
    expect(await within(panel).findByText('We can’t tell yet whether the order was cancelled')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await screen.findByText('Cancelled. Authorisation voided.');
    const keys = api.callsTo('cancelOrderAdmin').map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('a 409 says nothing changed, keeps the notes, and offers to reload', async () => {
    open(order('order_admin_view_authorized'), 'ADMIN', { cancelOrderAdmin: { status: 409, body: err('ILLEGAL_TRANSITION') } });
    const panel = await openCancel();
    fillCancel(panel, 'Kitchen confirmed by phone it cannot finish.');
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel order' }));
    expect(await within(panel).findByText('The order moved while you were cancelling')).toBeTruthy();
    expect((within(panel).getByLabelText(/What happened/) as HTMLTextAreaElement).value).toBe('Kitchen confirmed by phone it cannot finish.');
    expect(within(panel).getByRole('button', { name: /Reload the order/ })).toBeTruthy();
  });

  it('tells a support agent to ask an admin after acceptance, and offers no way to send', async () => {
    const api = open(order('order_admin_view_preparing'), 'SUPPORT_AGENT');
    const panel = await openCancel();
    expect(within(panel).getByText('Only an admin can cancel after the restaurant accepts')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Cancel order' })).toBeNull();
    expect(api.callsTo('cancelOrderAdmin')).toHaveLength(0);
  });

  it('offers no Cancel once the rider has the order (the admin view\'s can_cancel is the customer\'s, not staff\'s)', async () => {
    const picked = order('order_admin_view_picked_up');
    open(picked);
    fireEvent.click(await screen.findByRole('button', { name: /More actions/ }));
    const item = await screen.findByRole('menuitem', { name: /Cancel order/ });
    expect(isDisabled(item)).toBe(true);
    // ...while an accepted, preparing order IS cancellable by an admin although can_cancel is false.
    cleanup();
    const preparing = order('order_admin_view_preparing');
    expect(preparing.can_cancel).toBe(false);
    open(preparing);
    fireEvent.click(await screen.findByRole('button', { name: /More actions/ }));
    const ok = await screen.findByRole('menuitem', { name: /Cancel order/ });
    expect(isDisabled(ok)).toBe(false);
  });
});

describe('the list pane', () => {
  it('folds to a strip from its own header and comes back from the strip, so the order can take the width', async () => {
    const o = order('order_admin_view_preparing');
    open(o, 'ADMIN', { listOrdersAdmin: 'order_admin_list_every_state' });
    await screen.findByRole('heading', { name: o.code });
    const list = document.getElementById('orders-list')!;
    // The header names the list, and the control that folds it says which list it folds.
    expect(within(list).getByRole('heading', { name: 'Orders' })).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Collapse the orders list' }));
    expect(list.getAttribute('data-collapsed')).toBe('true');
    expect(within(list).queryByRole('grid')).toBeNull();
    // The order is still there, and so is the way back.
    expect(screen.getByRole('heading', { name: o.code })).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Show the orders list' }));
    expect(list.getAttribute('data-collapsed')).toBeNull();
    expect(await within(list).findByRole('grid')).toBeTruthy();
  });
});

describe('the other states of the page', () => {
  it('says no order has this id on a 404, and shows an error with Try again on a failure', async () => {
    mockApi({ getOrderAdmin: { status: 404, body: err('NOT_FOUND') } });
    renderRedesign(<Route path="/orders/:orderId" element={<OrderRoute />} />, { route: '/orders/0192a4c1-5e7b-7a10-b3c2-9d4e8f117d99' });
    expect(await screen.findByText('No order has this id')).toBeTruthy();
    cleanup();
    let n = 0;
    mockApi({ getOrderAdmin: () => (n++ === 0 ? { status: 500, body: err('INTERNAL_ERROR') } : { data: fixture<Order>('order_admin_view_created') }) });
    renderRedesign(<Route path="/orders/:orderId" element={<OrderRoute />} />, { route: '/orders/0192a4c1-5e7b-7a10-b3c2-9d4e8f117d98' });
    expect(await screen.findByText('This order didn’t load')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: fixture<Order>('order_admin_view_created').code })).toBeTruthy());
  });
});
