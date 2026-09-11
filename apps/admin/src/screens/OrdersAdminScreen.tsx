/**
 * A-38 / P-07 — cross-tenant order lookup. `GET /v1/admin/orders` (`operationId:
 * listOrdersAdmin`). Every privileged cross-tenant read is server-audited before it
 * returns; nothing here masks or unmasks — that only happens on the detail screen's
 * justified reveal.
 *
 * LyteNyte keyset grid, same cursor-stack pattern as the onboarding queues. A code search
 * and a state filter both reset the cursor stack (`pagination.reset()`) because a keyset
 * cursor encodes the sort/filter tuple and cannot be reused across a re-query.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OrderState, Schema } from '@hg/api-client';
import { HgApiError, isApiError } from '@hg/api-client';
import { Chip, Icon, Input, useCursorPagination, type PageMeta } from '@hg/ui-web';

import { api } from '../lib/api.js';
import { formatTimestamp, formatMoney } from '../lib/format.js';
import { KeysetGrid, type GridColumn } from '../components/KeysetGrid.js';

type OrderRow = Schema['OrderSummary'];

interface QueueState {
  status: 'loading' | 'ready' | 'error';
  rows: readonly OrderRow[];
  meta: PageMeta | null;
  error: { code: string; message: string } | null;
}

const TERMINAL: ReadonlySet<OrderState> = new Set(['COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED']);

function stateChip(state: OrderState) {
  return <Chip label={state} tone={TERMINAL.has(state) ? 'neutral' : 'warning'} />;
}

export function OrdersAdminScreen() {
  const navigate = useNavigate();
  const pagination = useCursorPagination();
  const [code, setCode] = useState('');
  const [state, setState] = useState<QueueState>({ status: 'loading', rows: [], meta: null, error: null });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const { data, error, response } = await api.GET('/v1/admin/orders', {
        params: {
          query: {
            limit: pagination.limit,
            cursor: pagination.cursor ?? undefined,
            code: code.trim() || undefined,
          },
        },
      });
      if (error || !data) throw new HgApiError(response.status, error as never);
      setState({ status: 'ready', rows: data.data as OrderRow[], meta: data.meta, error: null });
    } catch (err) {
      const message = isApiError(err) ? err.message : 'Could not reach the admin API.';
      const errCode = isApiError(err) ? String(err.code) : 'TRANSPORT_ERROR';
      setState({ status: 'error', rows: [], meta: null, error: { code: errCode, message } });
    }
  }, [pagination.limit, pagination.cursor, code]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: readonly GridColumn<OrderRow>[] = [
    { id: 'code', name: 'Order', width: 130, render: (row) => row.code },
    { id: 'restaurant', name: 'Restaurant', width: 200, render: (row) => row.restaurant.name },
    { id: 'state', name: 'State', width: 160, render: (row) => stateChip(row.state) },
    { id: 'total_cents', name: 'Total', width: 110, render: (row) => formatMoney(row.total_cents) },
    { id: 'placed_at', name: 'Placed', width: 180, render: (row) => formatTimestamp(row.placed_at) },
  ];

  return (
    <section aria-labelledby="orders-heading" className="adm-stack">
      <h1 id="orders-heading" className="text-title-md text-fg-primary mb-1">
        Orders
      </h1>
      <p className="text-body-md text-fg-secondary mb-4">
        Cross-tenant order lookup. Every read here is audited. Click a row to open the full
        support view.
      </p>

      <div className="adm-grid-toolbar">
        <Input
          label="Order code"
          placeholder="HG-8F3K2Q"
          value={code}
          onChange={(value) => setCode(value)}
        />
        <button
          type="button"
          className="adm-nav-link"
          onClick={() => {
            pagination.reset();
            void load();
          }}
        >
          <Icon name="search" size={16} />
          Search
        </button>
      </div>

      <KeysetGrid<OrderRow>
        columns={columns}
        rows={state.rows}
        meta={state.meta}
        pagination={pagination}
        loading={state.status === 'loading'}
        error={state.status === 'error' ? state.error : null}
        onRetry={() => void load()}
        getRowId={(row) => row.id}
        onRowActivate={(row) => navigate(`/orders/${row.id}`)}
        unit="orders"
        emptyTitle="No orders found"
        emptyDescription="No orders match this search. Clear the code filter to see the full queue."
      />
    </section>
  );
}
