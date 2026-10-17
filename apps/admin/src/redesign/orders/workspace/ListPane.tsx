/**
 * The order page's left pane: the list the order was opened from (`?from=all|running|disputes`),
 * kept beside it so staff can work down a queue. Folds to a strip (SplitPanes owns that).
 */
import { useEffect, useRef, useState } from 'react';
import { useHref, useNavigate } from 'react-router-dom';

import { unwrap } from '../../../lib/load';
import { api } from '../../data/api';
import { DataGrid, ErrorState, IconButton, Skeleton, type DataGridColumn } from '../../ds';
import { StateBadge } from '../cells';
import { ORDER_STATE } from '../labels';
import { asContract, NO_FILTERS, ordersQuery, RUNNING_STATES, type OrderSummary } from '../model';

export type ListSource = 'all' | 'running' | 'disputes';

export function listSourceOf(raw: string | null): ListSource {
  return raw === 'running' || raw === 'disputes' ? raw : 'all';
}

const TITLE: Record<ListSource, string> = { all: 'Orders', running: 'Orders still running', disputes: 'Disputed orders' };

/** The pane's heading (`ORD/OrderDetail`'s list header): short, because the pane is narrow. */
const HEADING: Record<ListSource, string> = { all: 'Orders', running: 'Still running', disputes: 'Open disputes' };

/** The names of the two controls that fold the pane to its strip and bring it back. */
export const listFoldLabels = (from: ListSource) => ({
  collapse: `Collapse the ${HEADING[from].toLowerCase()} list`,
  show: `Show the ${HEADING[from].toLowerCase()} list`,
});

export function ListPane({ from, selectedId, onCollapse }: { from: ListSource; selectedId: string; onCollapse: () => void }) {
  const navigate = useNavigate();
  const base = useHref('/orders');
  const [rows, setRows] = useState<OrderSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const ticket = useRef(0);

  const run = () => {
    const mine = ++ticket.current;
    setStatus('loading');
    const states = from === 'running' ? [...RUNNING_STATES] : from === 'disputes' ? (['DISPUTED'] as const) : [];
    unwrap(
      api.GET('/v1/admin/orders', {
        params: { query: ordersQuery({ ...NO_FILTERS, states }, null, 25) },
        querySerializer: { array: { style: 'form', explode: false } },
      }),
    )
      .then((body) => {
        if (mine !== ticket.current) return;
        setRows(asContract<OrderSummary[]>(body.data));
        setStatus('ready');
      })
      .catch(() => {
        if (mine === ticket.current) setStatus('error');
      });
  };

  useEffect(run, [from]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: DataGridColumn<OrderSummary>[] = [
    {
      key: 'order',
      header: 'Order',
      render: (r) => (
        <span className="flex flex-col items-start gap-1">
          <span className="font-mono">{r.code}</span>
          <StateBadge state={r.state} size="sm" />
          <span className="whitespace-normal text-body-sm text-fg-secondary">{r.restaurant.name}</span>
        </span>
      ),
    },
  ];

  const count = rows.length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line-decorative px-3 py-2">
        <h2 className="m-0 flex-1 text-heading-sm text-fg-primary">{HEADING[from]}</h2>
        {status === 'ready' ? (
          <span className="text-body-sm text-fg-secondary" aria-label={`${count} ${count === 1 ? 'order' : 'orders'} in this list`}>
            {count}
          </span>
        ) : null}
        <IconButton icon="back" accessibilityLabel={listFoldLabels(from).collapse} onPress={onCollapse} />
      </div>
      {status === 'error' ? (
        <ErrorState title="The list didn’t load" description="The order is unaffected. Nothing was changed." onRetry={run} />
      ) : (
        <DataGrid<OrderSummary>
          label={TITLE[from]}
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          rowLabel={(r) => `Order ${r.code}, ${r.restaurant.name}, ${ORDER_STATE[r.state].label}`}
          rowHref={(r) => `${base}/${r.id}?from=${from}`}
          onOpenRow={(r) => navigate(`/orders/${r.id}?from=${from}`)}
          selectedId={selectedId}
          loading={status === 'loading'}
          loadingSlot={<Skeleton variant="rows" count={6} label="Loading the list" />}
          emptySlot={<p className="p-3 text-body-sm text-fg-secondary">Nothing in this list.</p>}
          footerSlot={<span />}
        />
      )}
    </div>
  );
}
