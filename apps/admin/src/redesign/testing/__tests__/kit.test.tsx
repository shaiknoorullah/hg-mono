import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { Route, useParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { getSession, STAFF_ROLE_LABEL, staffRoleOf } from '../../data/session';
import {
  fixture,
  fixtureMeta,
  mockApi,
  NOT_IN_CONTRACT,
  renderRedesign,
  resetSession,
  TEST_ACCESS_TOKEN,
  type MockApi,
} from '..';

type OrderSummary = Schema['OrderSummary'];

const ORDER_ID = '0b9d6c1e-3f2a-4e5b-8c7d-9a1b2c3d4e5f';
const CASE_ID = '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

describe('mockApi', () => {
  let mock: MockApi;
  beforeEach(() => {
    mock = mockApi();
  });

  it('serves the default fixture for an admin GET in the mock server envelope', async () => {
    const { data, response } = await api.GET('/v1/admin/orders');
    expect(response.status).toBe(200);
    expect(data?.data).toEqual(fixture<OrderSummary[]>('order_list_past'));
    expect(data?.meta).toEqual(
      fixtureMeta('order_list_past') ?? { next_cursor: null, has_more: false, total: data?.data.length },
    );
    expect(mock.callsTo('listOrdersAdmin')).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({ operationId: 'listOrdersAdmin', method: 'GET', path: '/v1/admin/orders' });
  });

  it('serves a named scenario and records query and path params', async () => {
    mock.set({ listOrdersAdmin: 'order_list_active' });
    const { data } = await api.GET('/v1/admin/orders', { params: { query: { state: ['PREPARING', 'ARRIVED'] } } });
    expect(data?.data).toEqual(fixture('order_list_active'));
    expect(mock.callsTo('listOrdersAdmin')[0]?.query).toEqual({ state: ['PREPARING', 'ARRIVED'] });

    await api.GET('/v1/admin/orders/{orderId}', { params: { path: { orderId: ORDER_ID } } });
    expect(mock.callsTo('getOrderAdmin')[0]?.params).toEqual({ orderId: ORDER_ID });
  });

  it('serves an inline error reply, an inline data reply and a reply function', async () => {
    mock.set({ listOrdersAdmin: { status: 403, body: fixture('error_forbidden') } });
    const denied = await api.GET('/v1/admin/orders');
    expect(denied.response.status).toBe(403);
    expect(denied.error?.error.code).toBe('FORBIDDEN');

    const rows = fixture<OrderSummary[]>('order_list_active').slice(0, 1);
    mock.set({ listOrdersAdmin: { data: rows } });
    const one = await api.GET('/v1/admin/orders');
    expect(one.data?.data).toHaveLength(1);
    expect(one.data?.meta).toEqual({ next_cursor: null, has_more: false, total: 1 });

    mock.set({ listOrdersAdmin: (req) => (req.query.code ? { data: [] } : undefined) });
    const empty = await api.GET('/v1/admin/orders', { params: { query: { code: 'HG-8F3K2Q' } } });
    expect(empty.data?.data).toEqual([]);
    const fallback = await api.GET('/v1/admin/orders');
    expect(fallback.data?.data).toEqual(fixture('order_list_past'));
  });

  it('serves an error fixture as-is with its own status', async () => {
    mock.set({ getOrderAdmin: 'error_not_found' });
    const { error, response } = await api.GET('/v1/admin/orders/{orderId}', { params: { path: { orderId: ORDER_ID } } });
    expect(response.status).toBe(404);
    expect(error).toEqual(fixture('error_not_found'));
  });

  it('records the body and the Idempotency-Key of a POST', async () => {
    const body: Schema['AdminOrderCancellationInput'] = {
      reason_code: 'CUSTOMER_CANCELLED',
      reason_text: 'Customer called support to cancel.',
      case_id: CASE_ID,
    };
    const { data } = await api.POST('/v1/admin/orders/{orderId}/cancel', {
      params: { path: { orderId: ORDER_ID }, header: { 'Idempotency-Key': 'key-0123456789abcdef' } },
      body,
    });
    expect(data?.data).toEqual(fixture('order_admin_view_completed'));
    const [call] = mock.callsTo('cancelOrderAdmin');
    expect(call?.body).toEqual(body);
    expect(call?.headers['idempotency-key']).toBe('key-0123456789abcdef');
    expect(call?.headers.authorization).toBeUndefined();
  });

  it('answers a path outside the contract with a 404 NOT_FOUND envelope', async () => {
    const res = await fetch('http://localhost:4010/v1/not-a-route');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(mock.calls[0]?.operationId).toBe(NOT_IN_CONTRACT);
  });

  it('holds a request open with pending, and answers late with delay', async () => {
    mock.set({ listOrdersAdmin: { pending: true } });
    const settled = vi.fn();
    void api.GET('/v1/admin/orders').then(settled);
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).not.toHaveBeenCalled();

    mock.set({ listOrdersAdmin: { delay: 10, reply: 'order_list_active' } });
    const { data } = await api.GET('/v1/admin/orders');
    expect(data?.data).toEqual(fixture('order_list_active'));
  });

  it('refuses an unknown scenario or operation up front', () => {
    expect(() => mock.set({ listOrdersAdmin: 'no_such_scenario' })).toThrow(/unknown scenario/);
    expect(() => mock.set({ notAnOperation: 'order_list_active' })).toThrow(/not an operationId/);
  });
});

function WhoAmI() {
  const { orderId } = useParams();
  const role = staffRoleOf(getSession().principal);
  return (
    <p>
      {role ? STAFF_ROLE_LABEL[role] : 'signed out'} {orderId ?? ''}
    </p>
  );
}

describe('renderRedesign', () => {
  beforeEach(() => {
    mockApi();
  });

  it('signs in as ADMIN by default and sends the bearer token', async () => {
    const { principal } = renderRedesign(<WhoAmI />);
    expect(screen.getByText(/Admin/)).toBeTruthy();
    expect(principal?.roles).toEqual([{ role: 'ADMIN', scope_type: 'GLOBAL', scope_id: null }]);
    const mock = mockApi();
    await api.GET('/v1/admin/orders');
    expect(mock.calls[0]?.headers.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
  });

  it('signs in with the requested role at the requested route', () => {
    renderRedesign(<Route path="/orders/:orderId" element={<WhoAmI />} />, {
      route: `/orders/${ORDER_ID}`,
      principal: 'SUPPORT_AGENT',
    });
    expect(screen.getByText(`Support ${ORDER_ID}`)).toBeTruthy();
    expect(staffRoleOf(getSession().principal)).toBe('SUPPORT_AGENT');
  });

  it('renders signed out on request', () => {
    renderRedesign(<WhoAmI />, { signedIn: false });
    expect(screen.getByText(/signed out/)).toBeTruthy();
    expect(getSession().principal).toBeNull();
  });
});
