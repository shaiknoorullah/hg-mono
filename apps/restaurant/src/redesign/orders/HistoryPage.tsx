/**
 * Past orders, `/orders/history` (boards `History`, `History-loading`, `-empty`, `-error`,
 * `-filter-loading`, `-filtered-empty`, `-loading-more`, `-load-more-failed`, and the panel
 * boards `History-delivered`, `History-detail-*-sheet`, `History-halal-*`): the orders the
 * restaurant finished, declined or that were cancelled, newest first, a chip per status, and a
 * panel beside the list for one order (`?order={id}`). The chip is `?status=` and is sent to the
 * server as the `state` filter every time it changes.
 *
 * - #601: the server ignores `state` and the cursor on `listRestaurantOrders`. The request always
 *   carries both AND the rows are guarded on the client (`guardHistoryRows`); a page that adds
 *   nothing new ends the list instead of asking again.
 * - Every state is drawn: loading, empty, filtered empty, error (with the header and chips kept),
 *   load more (loading and failed), end of list, and a refetch signal from the live channel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useRealtimeChannel } from '@hg/ui-web/live';
import { Badge, Button, DataTable, EmptyState, FilterChip, GlyphIcon, Price, type DataTableColumn } from '../ds';
import { useConsole } from '../data/console';
import { serverNow } from '../data/serverClock';
import { useServerResource } from '../data/useServerResource';
import { usePagePanelOpen } from '../shell/layout';
import { HistoryDetail } from './HistoryDetail';
import { loadHistoryPage, loadPastOrder } from './historyApi';
import {
  HISTORY_CHIPS,
  emptyCopy,
  historyCaption,
  historyStatus,
  isHistoryFilter,
  netCell,
  placedLabel,
  prepMeter,
  prepText,
  type HistoryFilter,
} from './history';
import type { Order } from './model';

interface ListState {
  status: 'loading' | 'ready' | 'error';
  rows: Order[];
  cursor: string | null;
  hasMore: boolean;
  more: 'idle' | 'loading' | 'error';
}

const START: ListState = { status: 'loading', rows: [], cursor: null, hasMore: false, more: 'idle' };

/** Below this list width the Items and Prep columns drop (the board's mid layout). */
const MID_WIDTH = 1060;

function useListWidth(): [React.RefObject<HTMLElement | null>, number] {
  const ref = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function Dash({ visible, spoken }: { visible?: string; spoken: string }) {
  return (
    <span className="inline-flex gap-1.5 text-fg-secondary">
      <span aria-hidden="true">—</span>
      {visible ? <span>{visible}</span> : <span className="sr-only">{spoken}</span>}
    </span>
  );
}

export function HistoryPage() {
  const { core, timezone } = useConsole();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const filter: HistoryFilter = isHistoryFilter(raw) ? raw : 'ALL';
  const openId = params.get('order');
  const [list, setList] = useState<ListState>(START);
  const ticket = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;
  const [sectionRef, listWidth] = useListWidth();
  usePagePanelOpen(Boolean(openId));

  const loadFirst = useCallback(
    async (silent: boolean) => {
      const mine = ++ticket.current;
      if (!silent) setList(START);
      try {
        const page = await loadHistoryPage(filter, null);
        if (mine !== ticket.current) return;
        setList({ status: 'ready', rows: page.rows, cursor: page.nextCursor, hasMore: page.hasMore, more: 'idle' });
      } catch {
        if (mine !== ticket.current) return;
        setList((s) => (silent && s.status === 'ready' ? s : { ...START, status: 'error' }));
      }
    },
    [filter],
  );

  const loadMore = useCallback(async () => {
    const mine = ticket.current;
    setList((s) => ({ ...s, more: 'loading' }));
    try {
      const page = await loadHistoryPage(filter, listRef.current.cursor);
      if (mine !== ticket.current) return;
      setList((s) => {
        const fresh = page.rows.filter((r) => !s.rows.some((x) => x.id === r.id));
        // A server that ignores the cursor (#601) sends the same page again: that is the end.
        return { ...s, rows: [...s.rows, ...fresh], cursor: page.nextCursor, hasMore: page.hasMore && fresh.length > 0 && page.nextCursor !== null, more: 'idle' };
      });
    } catch {
      if (mine !== ticket.current) return;
      setList((s) => ({ ...s, more: 'error' }));
    }
  }, [filter]);

  useEffect(() => {
    void loadFirst(false);
    return () => {
      ticket.current += 1;
    };
  }, [loadFirst]);

  const restaurantId = core.data?.restaurantId ?? null;
  useRealtimeChannel(restaurantId ? `restaurant:${restaurantId}` : null, (signal) => {
    if (signal.kind === 'refetch') void loadFirst(true);
  });

  const choose = (next: HistoryFilter) => {
    const q = new URLSearchParams(params);
    if (next === 'ALL') q.delete('status');
    else q.set('status', next);
    setParams(q);
  };
  const openOrder = (id: string) => {
    const q = new URLSearchParams(params);
    q.set('order', id);
    setParams(q);
  };
  const closePanel = () => {
    const id = openId;
    const q = new URLSearchParams(params);
    q.delete('order');
    setParams(q);
    // Focus back to the source row (only a row on screen: `?order=` is user-editable text).
    if (id && listRef.current.rows.some((o) => o.id === id)) {
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-order-open]`)?.focus(), 0);
    }
  };

  const now = serverNow();
  const mid = listWidth !== 0 && listWidth < MID_WIDTH;
  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const cols: DataTableColumn<Order>[] = [
      {
        key: 'order',
        header: 'Order',
        width: '120px',
        textValue: (o) => o.code,
        cell: (o) => (
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-order-open=""
              onClick={() => openOrder(o.id)}
              className="hg-focus min-h-11 rounded font-mono text-[17px] font-semibold underline-offset-2 hover:underline"
            >
              {o.code}
            </button>
            {openId === o.id ? <Badge size="sm" variant="brand" label="Open" /> : null}
          </span>
        ),
      },
      { key: 'placed', header: 'Placed', width: '110px', contentClass: 'numeric', align: 'start', cell: (o) => placedLabel(o.placed_at, now, timezone) },
      { key: 'customer', header: 'Customer', cell: (o) => o.customer.display_name },
    ];
    if (!mid) {
      cols.push(
        { key: 'items', header: 'Items', width: '64px', align: 'end', contentClass: 'numeric', cell: (o) => o.lines.reduce((n, l) => n + l.quantity, 0) },
        {
          key: 'prep',
          header: 'Prep',
          width: '210px',
          cell: (o) => {
            const m = prepMeter(o);
            if (!m) return <Dash spoken="Not prepared" />;
            return (
              <span className="inline-flex items-center gap-2 tabular-nums">
                {m.promised ? (
                  <span aria-hidden="true" className="inline-block h-2 w-16 overflow-hidden rounded-full bg-surface-sunken shadow-[inset_0_0_0_1px_var(--hg-border-decorative)]">
                    <span className={`block h-full ${m.late ? 'bg-feedback-warning-border' : 'bg-line-interactive'}`} style={{ width: `${m.percent}%` }} />
                  </span>
                ) : null}
                <span>{prepText(m)}</span>
                {m.late ? <Badge size="sm" variant="warning" label="Late" /> : null}
              </span>
            );
          },
        },
      );
    }
    cols.push(
      {
        key: 'status',
        header: 'Status',
        width: '170px',
        textValue: (o) => historyStatus(o.state).label,
        cell: (o) => {
          const s = historyStatus(o.state);
          return <Badge size="md" variant={s.variant} label={s.label} />;
        },
      },
      {
        key: 'net',
        header: 'Order net',
        width: '180px',
        align: 'end',
        contentClass: 'numeric',
        cell: (o) => {
          const n = netCell(o);
          if (n.kind === 'not-charged') return <Dash visible="Not charged" spoken="" />;
          return (
            <span className="inline-flex items-baseline gap-1.5">
              <Price cents={n.cents} />
              {n.payoutOpen ? <span className="text-[13px] text-fg-secondary">Payout open</span> : null}
            </span>
          );
        },
      },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mid, openId, now, timezone, params]);

  const copy = emptyCopy(filter);
  const filtered = filter !== 'ALL';
  return (
    <div className="flex min-h-0 flex-1 gap-3" data-testid="past-orders" data-state={list.status} data-filter={filter}>
      <section
        ref={sectionRef as React.RefObject<HTMLElement>}
        aria-labelledby="hist-title"
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised${openId ? ' max-lg:hidden' : ''}`}
      >
        <header className="flex flex-col gap-2 border-b border-line-decorative px-4 py-3">
          <h2 id="hist-title" className="m-0 text-[20px] font-semibold">
            Past orders
          </h2>
          <div role="group" aria-label="Filter past orders" className="flex flex-wrap items-center gap-2">
            {HISTORY_CHIPS.map((c) => (
              <span key={c.value} className="contents">
                {c.group ? <span className="ms-2 text-[13px] font-bold text-fg-secondary">{c.group}</span> : null}
                <FilterChip
                  label={c.label}
                  pressed={filter === c.value}
                  loading={list.status === 'loading' && filter === c.value}
                  onPressedChange={(on) => choose(on ? c.value : 'ALL')}
                  testId={`chip-${c.value}`}
                />
              </span>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DataTable<Order>
            caption={historyCaption(filter)}
            columns={columns}
            rows={list.rows}
            getRowId={(o) => o.id}
            getRowLabel={(o) => `order ${o.code}`}
            onRowActivate={(o) => openOrder(o.id)}
            density="compact"
            stickyHeader
            loading={list.status === 'loading'}
            loadingMore={list.more === 'loading'}
            error={list.status === 'error' ? { code: 'NETWORK', message: 'We couldn’t load past orders. Your records are safe on the server.', onRetry: () => void loadFirst(false) } : null}
            filtersActive={filtered}
            className="rounded-none border-0"
            emptyState={
              <EmptyState
                variant="table"
                headingLevel={3}
                title={copy.title}
                description={copy.description}
                testId="past-orders-empty"
                {...(filtered ? { primaryAction: { label: 'Show all past orders', onPress: () => choose('ALL') } } : {})}
              />
            }
            testId="past-orders-table"
          />
          {list.status === 'ready' && list.more === 'error' ? (
            <div role="alert" className="mx-3 my-2 flex items-center gap-2.5 rounded-md border border-feedback-danger-border bg-feedback-danger-tint px-3 py-2.5" data-testid="load-more-failed">
              <GlyphIcon name="error" size="md" className="shrink-0 text-feedback-danger-icon" />
              <span className="flex-1 text-[15px]">We couldn’t load older orders. The ones above are up to date.</span>
              <Button variant="tertiary" size="md" iconStart={<GlyphIcon name="refresh" size="md" />} onPress={() => void loadMore()}>
                Try again
              </Button>
            </div>
          ) : null}
          {list.status === 'ready' && list.rows.length > 0 && list.more !== 'error' ? (
            <div className="flex flex-col items-center gap-2 border-t border-line-decorative px-4 py-4" data-testid="list-foot">
              {list.hasMore ? (
                <Button variant="secondary" size="md" loading={list.more === 'loading'} onPress={() => void loadMore()}>
                  Load more
                </Button>
              ) : (
                <span className="text-[13px] text-fg-secondary">That’s every past order so far.</span>
              )}
            </div>
          ) : null}
        </div>
      </section>
      {openId ? <PanelHost key={openId} orderId={openId} onClose={closePanel} /> : null}
    </div>
  );
}

function PanelHost({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const resource = useServerResource(() => loadPastOrder(orderId), [orderId]);
  return <HistoryDetail orderId={orderId} resource={resource} onClose={onClose} />;
}
