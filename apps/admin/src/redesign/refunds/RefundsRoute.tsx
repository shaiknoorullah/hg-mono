/**
 * Refunds (`REF/Refunds*`): failed refunds first, then a lookup of one order by its code.
 *
 * - A refund is always issued against one order. Lookup finds the order by code; "the lookup didn't
 *   finish" is never worded as "no order".
 * - The failed-refunds list is the server's (`listRefundsAdmin`, state Failed), newest first as it
 *   sends them. A row stays after a replacement is issued. "Issue a new refund" opens the same panel
 *   the order workspace has, filled in with the failed refund's scope and reason.
 * - Everything money on this page is the server's figure, as sent. Nothing is added up or taken away.
 *
 * Not on this page, with the reason in the pull request: the approvals queue (a placeholder board
 * and an open owner question), a list of every refund (the contract lists only by state), search by
 * phone, email or name (no API), and the on-call line (its names are placeholders until the owner
 * gives them).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHref, useNavigate } from 'react-router-dom';
import { isApiError, type Schema } from '@hg/api-client';
import { useSyncExternalStore } from 'react';

import { unwrap } from '../../lib/load';
import { useOnline } from '../auth/online';
import { api } from '../data/api';
import { formatShortDateTime } from '../data/format';
import { getSession, staffRoleOf, subscribeSession } from '../data/session';
import { Banner, Button, DataGrid, EmptyState, ErrorState, InlineAlert, Input, Menu, Price, Skeleton, SplitPanes, type DataGridColumn } from '../ds';
import { asContract, checkOrderCode } from '../orders/model';
import { OrderHeader, PaymentBlock, RefundRows } from '../orders/workspace/Sections';
import { PAGE, REFUND_COPY } from './copy';
import { OFFERED_REASONS, nothingKey, refundability, type OfferedReason, type RefundDraft } from './model';
import { RefundPanel } from './RefundPanel';

type Order = Schema['OrderAdminView'];
type AdminRefund = Schema['AdminRefund'];

const PAGE_SIZE = 25;

type Lookup =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'searching'; code: string }
  | { kind: 'not-found'; code: string }
  | { kind: 'error' }
  | { kind: 'ready'; order: Order };

type Queue = 'loading' | 'ready' | 'error';

interface Opened {
  order: Order;
  prefill: { draft: Partial<RefundDraft>; notice: string; key: string } | null;
}

function reasonLabel(code: string): string {
  return code in OFFERED_REASONS ? OFFERED_REASONS[code as OfferedReason].label : code.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** A failed refund's scope and reason, as a starting point for its replacement. */
function prefillFrom(r: AdminRefund): NonNullable<Opened['prefill']> {
  const short = `${r.id.slice(0, 8)}…${r.id.slice(-4)}`;
  const goodwill = r.kind === 'GOODWILL' || r.reason_code === 'GOODWILL';
  const text = `Replacing failed refund ${short}.`;
  const reason = !goodwill && r.reason_code in OFFERED_REASONS ? { reason: r.reason_code as OfferedReason } : {};
  const draft: Partial<RefundDraft> = goodwill
    ? { scope: 'GOODWILL', reason: 'GOODWILL', goodwillCents: r.amount_cents, text }
    : { scope: r.scope === 'FULL' ? 'FULL' : 'PARTIAL_ITEMS', text, ...reason };
  const detail = goodwill
    ? 'The amount, scope and reason are filled in.'
    : r.scope === 'FULL'
      ? 'The scope and reason are filled in.'
      : 'The scope and reason are filled in; choose the items again, because a refund does not say which it covered.';
  return {
    draft,
    notice: `Filled in from failed refund ${short}. ${detail} It goes as a new refund, so the failed one stays on record. After you issue it, tell the customer the first one didn’t go through.`,
    key: r.id,
  };
}

async function fetchFailed(cursor: string | null) {
  const body = await unwrap(
    api.GET('/v1/admin/refunds', {
      params: { query: { state: ['FAILED'], limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      querySerializer: { array: { style: 'form', explode: false } },
    }),
  );
  return { rows: asContract<AdminRefund[]>(body.data), cursor: body.meta.next_cursor, hasMore: body.meta.has_more };
}

async function fetchOrder(orderId: string): Promise<Order> {
  const body = await unwrap(api.GET('/v1/admin/orders/{orderId}', { params: { path: { orderId } } }));
  return asContract<Order>(body.data);
}

export default function RefundsRoute() {
  const online = useOnline();
  const navigate = useNavigate();
  const ordersBase = useHref('/orders');
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const role = staffRoleOf(session.principal);

  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' });
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const [queue, setQueue] = useState<Queue>('loading');
  const [rows, setRows] = useState<AdminRefund[]>([]);
  const [page, setPage] = useState<{ cursor: string | null; hasMore: boolean }>({ cursor: null, hasMore: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const ticket = useRef(0);

  const loadQueue = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    if (!quiet) setQueue('loading');
    setLoadMoreFailed(false);
    try {
      const first = await fetchFailed(null);
      if (mine !== ticket.current) return;
      setRows(first.rows);
      setPage({ cursor: first.cursor, hasMore: first.hasMore });
      setQueue('ready');
    } catch {
      if (mine !== ticket.current) return;
      // A quiet refresh that fails keeps the good list on screen.
      if (!quiet) setQueue('error');
    }
  }, []);

  useEffect(() => {
    void loadQueue(false);
  }, [loadQueue]);

  const loadMore = useCallback(async () => {
    if (!page.cursor || loadingMore) return;
    const mine = ticket.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await fetchFailed(page.cursor);
      if (mine !== ticket.current) return;
      setRows((cur) => [...cur, ...next.rows.filter((r) => !cur.some((c) => c.id === r.id))]);
      setPage({ cursor: next.cursor, hasMore: next.hasMore });
    } catch {
      if (mine === ticket.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [page.cursor, loadingMore]);

  async function find() {
    const checked = checkOrderCode(code);
    if (checked.kind === 'empty') return;
    if (checked.kind === 'invalid') {
      setLookup({ kind: 'invalid', message: checked.message });
      return;
    }
    setOpened(null);
    setOpenError(null);
    setLookup({ kind: 'searching', code: checked.code });
    try {
      const list = await unwrap(api.GET('/v1/admin/orders', { params: { query: { code: checked.code, limit: 1 } } }));
      const hit = list.data[0];
      if (!hit) {
        setLookup({ kind: 'not-found', code: checked.code });
        return;
      }
      setLookup({ kind: 'ready', order: await fetchOrder(hit.id) });
    } catch (err) {
      setLookup(isApiError(err) && err.status === 404 ? { kind: 'not-found', code: checked.code } : { kind: 'error' });
    }
  }

  async function openFor(row: AdminRefund) {
    setOpenError(null);
    try {
      setOpened({ order: await fetchOrder(row.order_id), prefill: prefillFrom(row) });
    } catch {
      setOpenError(`Order ${row.order_code} didn’t load, so no refund was started. Nothing was changed. Try again.`);
    }
  }

  async function reloadOpened() {
    if (!opened) return;
    try {
      const fresh = await fetchOrder(opened.order.id);
      setOpened({ ...opened, order: fresh });
      setLookup((l) => (l.kind === 'ready' && l.order.id === fresh.id ? { kind: 'ready', order: fresh } : l));
    } catch {
      /* the old view stays; the panel's own message already told the person what happened */
    }
  }

  const columns: DataGridColumn<AdminRefund>[] = [
    { key: 'order', header: 'Order', width: '9rem', mono: true, render: (r) => r.order_code },
    { key: 'amount', header: 'Amount', width: '7rem', align: 'end', render: (r) => <Price cents={r.amount_cents} size="sm" /> },
    { key: 'reason', header: 'Reason', width: '12rem', render: (r) => `${reasonLabel(r.reason_code)} · ${r.kind === 'GOODWILL' ? 'Goodwill amount' : r.scope === 'FULL' ? 'Whole order' : r.scope === 'PARTIAL_ITEMS' ? 'Selected items' : 'Amount'}` },
    { key: 'requested', header: 'Requested', width: '10rem', render: (r) => formatShortDateTime(r.requested_at) },
    {
      key: 'why',
      header: 'Why it failed',
      render: (r) => r.failure_message ?? 'The provider didn’t say.',
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '8rem',
      render: (r) => (
        <Menu
          label={`Actions for the failed refund on ${r.order_code}`}
          triggerText="Actions"
          disabled={!online}
          items={[
            { key: 'new', label: 'Issue a new refund', onSelect: () => void openFor(r) },
            { key: 'open', label: 'Open order', onSelect: () => navigate(`/orders/${r.order_id}`) },
          ]}
        />
      ),
    },
  ];

  const main = (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-auto p-4">
      {!online ? <Banner tone="warning" title="You’re offline." description={PAGE.offline} announce="status" /> : null}

      <section aria-labelledby="find-heading" className="flex flex-col gap-3">
        <h2 id="find-heading" className="text-heading-sm text-fg-primary">
          {PAGE.findHeading}
        </h2>
        <p className="text-body-md text-fg-secondary">{PAGE.findIntro}</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <Input
            label="Order code"
            value={code}
            placeholder="HG-8F3K2Q"
            helperText={PAGE.findHelp}
            errorText={lookup.kind === 'invalid' ? lookup.message : null}
            onValueChange={(v: string) => {
              setCode(v);
              if (lookup.kind === 'invalid') setLookup({ kind: 'idle' });
            }}
          />
          <Button type="submit" variant="primary" disabled={!online || lookup.kind === 'searching'} loading={lookup.kind === 'searching'}>
            Find order
          </Button>
        </form>

        {lookup.kind === 'idle' || lookup.kind === 'invalid' ? (
          <EmptyState icon="search" headingLevel={3} title={PAGE.lookupIdle} description={PAGE.lookupIdleBody} />
        ) : null}
        {lookup.kind === 'searching' ? <Skeleton variant="lines" count={4} label={`Looking up ${lookup.code}`} /> : null}
        {lookup.kind === 'not-found' ? (
          <EmptyState icon="search" headingLevel={3} title={PAGE.notFound(lookup.code)} description={PAGE.notFoundBody} />
        ) : null}
        {lookup.kind === 'error' ? (
          <InlineAlert
            tone="warning"
            blocking
            title={PAGE.lookupErrorTitle}
            action={
              <Button variant="tertiary" iconStart="refresh" onPress={() => void find()}>
                Try again
              </Button>
            }
          >
            {PAGE.lookupErrorBody}
          </InlineAlert>
        ) : null}
        {lookup.kind === 'ready' ? (
          <FoundOrder
            order={lookup.order}
            online={online}
            ordersBase={ordersBase}
            onIssue={() => setOpened({ order: lookup.order, prefill: null })}
          />
        ) : null}
      </section>

      <section aria-labelledby="failed-heading" className="flex min-h-0 flex-col gap-3">
        <h2 id="failed-heading" className="text-heading-sm text-fg-primary">
          {PAGE.failedHeading}
        </h2>
        <p className="text-body-md text-fg-secondary">{PAGE.failedIntro}</p>
        {openError ? (
          <InlineAlert tone="warning" blocking title="The refund wasn’t started">
            {openError}
          </InlineAlert>
        ) : null}
        <DataGrid
          label="Failed refunds"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          rowLabel={(r) => `Failed refund on ${r.order_code}, ${reasonLabel(r.reason_code)}`}
          rowHref={(r) => `${ordersBase}/${r.order_id}`}
          loading={queue === 'loading'}
          loadingSlot={<Skeleton variant="lines" count={5} label="Loading failed refunds" />}
          errorSlot={queue === 'error' ? <ErrorState headingLevel={3} title={PAGE.failedErrorTitle} description={PAGE.failedErrorBody} onRetry={() => void loadQueue(false)} /> : undefined}
          emptySlot={<EmptyState icon="check" headingLevel={3} title={PAGE.failedEmptyTitle} description={PAGE.failedEmptyBody} />}
          hasMore={page.hasMore}
          loadingMore={loadingMore}
          loadMoreFailed={loadMoreFailed}
          onLoadMore={() => void loadMore()}
        />
      </section>
    </div>
  );

  const side = opened ? (
    <RefundPanel
      key={`${opened.order.id}:${opened.prefill?.key ?? ''}`}
      order={opened.order}
      role={role}
      prefill={opened.prefill}
      onClose={() => setOpened(null)}
      onReload={() => void reloadOpened()}
      onAnswered={() => {
        void reloadOpened();
        void loadQueue(true);
      }}
    />
  ) : (
    <p className="p-4 text-body-sm text-fg-secondary">Find an order, or pick a failed refund, to start a refund here.</p>
  );

  return (
    <section aria-label="Refunds" className="flex min-h-0 flex-1 flex-col">
      <SplitPanes
        panes={[
          { id: 'refunds-main', label: 'Refunds', fill: true, content: main },
          { id: 'refund-panel', label: 'Refund', collapsible: true, defaultSize: 440, minSize: 320, content: <div className="h-full overflow-auto">{side}</div> },
        ]}
      />
    </section>
  );
}

function FoundOrder({ order, online, ordersBase, onIssue }: { order: Order; online: boolean; ordersBase: string; onIssue: () => void }) {
  const can = refundability(order);
  return (
    <div className="flex flex-col gap-4 rounded-md border border-line-decorative p-4">
      <OrderHeader order={order} />
      <PaymentBlock order={order} />
      <RefundRows order={order} />
      {can.kind === 'ok' ? null : (
        <InlineAlert tone="neutral" title={REFUND_COPY.nothing[nothingKey(can)].title}>
          {REFUND_COPY.nothing[nothingKey(can)].body}
        </InlineAlert>
      )}
      <div className="flex flex-wrap gap-2">
        {can.kind === 'ok' ? (
          <Button variant="primary" disabled={!online} onPress={onIssue}>
            Issue refund
          </Button>
        ) : null}
        <Button variant="tertiary" href={`${ordersBase}/${order.id}`} iconEnd="chevron-right">
          Open order
        </Button>
      </div>
    </div>
  );
}

