/**
 * Orders and Disputes (`ORD/OrdersGrid`, `ORD/Orders*`, `ORD/Disputes*`): the same grid, two lists.
 *
 * Orders is every restaurant, newest first (the server gives no other sort), 25 at a time as the
 * end of the list scrolls into view. Disputes follows every cursor to the end FIRST and only then
 * sorts by `deadline_at`: an old dispute can be the most urgent, so until the last page is here the
 * page makes no sort claim, and if a page fails it says the list is not in deadline order.
 *
 * Filters live in the address (`?view=running&state=&code=&restaurant_id=&account_id=&placed_from=
 * &placed_to=`), so a filtered list can be shared and survives a reload. A typed code is checked
 * before it is sent; an invalid one is never searched, because the server's "no order" would be a
 * different claim. A lookup error is never drawn as "nothing found".
 *
 * Not drawn, for want of an API (see the pull request): server sort by deadline, why an order is
 * disputed and which round it is on, how long an order has been in its state, a restaurant picker
 * by name, search by customer phone or email.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHref, useNavigate, useSearchParams } from 'react-router-dom';
import { unwrap } from '../../lib/load';
import { api } from '../data/api';
import { formatFullDateTime, formatShortDateTime, formatTime } from '../data/format';
import { useOnline } from '../auth/online';
import { usePageBar } from '../app/pageTitle';
import {
  Badge,
  Banner,
  Button,
  DataGrid,
  DateInput,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  MultiSelect,
  Price,
  SegmentedControl,
  Skeleton,
  type DataGridColumn,
} from '../ds';
import { DeadlineCell, HalalCell, StateBadge } from './cells';
import { DISPUTES, ORDERS } from './copy';
import { ORDER_STATE, type OrderState } from './labels';
import {
  asContract,
  checkOrderCode,
  hasFilters,
  isRunningPreset,
  isUuid,
  itemsText,
  NO_FILTERS,
  ordersQuery,
  RUNNING_STATES,
  sortByDeadline,
  type OrderFilters,
  type OrderSummary,
} from './model';

const PAGE_SIZE = 25;
const STATE_KEYS = Object.keys(ORDER_STATE) as OrderState[];

interface Page {
  readonly rows: OrderSummary[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly total: number | null;
}

async function fetchPage(filters: OrderFilters, cursor: string | null): Promise<Page> {
  const body = await unwrap(
    api.GET('/v1/admin/orders', {
      params: { query: ordersQuery(filters, cursor, PAGE_SIZE) },
      // The contract declares `style: form, explode: false`: state=PREPARING,DELIVERED.
      querySerializer: { array: { style: 'form', explode: false } },
    }),
  );
  const meta = body.meta as { next_cursor: string | null; has_more: boolean; total?: number | null };
  return { rows: asContract<OrderSummary[]>(body.data), cursor: meta.next_cursor, hasMore: meta.has_more, total: meta.total ?? null };
}

/** The filters the address carries. */
export function filtersFromParams(params: URLSearchParams): OrderFilters {
  const raw = (params.get('state') ?? '').split(',').filter((s): s is OrderState => (STATE_KEYS as string[]).includes(s));
  const states = params.get('view') === 'running' ? [...RUNNING_STATES] : raw;
  const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  return {
    code: params.get('code') ?? '',
    states,
    restaurantId: params.get('restaurant_id') ?? '',
    accountId: params.get('account_id') ?? '',
    placedFrom: date(params.get('placed_from')),
    placedTo: date(params.get('placed_to')),
  };
}

export function paramsFromFilters(f: OrderFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (isRunningPreset(f.states)) p.set('view', 'running');
  else if (f.states.length > 0) p.set('state', f.states.join(','));
  if (f.code) p.set('code', f.code);
  if (f.restaurantId) p.set('restaurant_id', f.restaurantId);
  if (f.accountId) p.set('account_id', f.accountId);
  if (f.placedFrom) p.set('placed_from', f.placedFrom);
  if (f.placedTo) p.set('placed_to', f.placedTo);
  return p;
}

type Load = 'loading' | 'ready' | 'error';

/** An order whose state moved between two reads of the list: what it was, and when that read was. */
interface Change {
  readonly from: OrderState;
  readonly at: Date;
}

export function OrderListPage({ mode }: { mode: 'orders' | 'disputes' }) {
  const disputes = mode === 'disputes';
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const base = useHref('/orders');
  const online = useOnline();
  usePageBar(mode === 'disputes' ? ORDERS.disputesSubtitle : ORDERS.subtitle);

  // Disputes ignore every filter but the code: the state is fixed to Disputed.
  const filters = useMemo(() => {
    const f = filtersFromParams(params);
    return disputes ? { ...NO_FILTERS, code: f.code, states: ['DISPUTED' as const] } : f;
  }, [params, disputes]);

  const setFilters = useCallback(
    (next: OrderFilters) => setParams(paramsFromFilters(disputes ? { ...next, states: [] } : next), { replace: true }),
    [setParams, disputes],
  );

  const [codeDraft, setCodeDraft] = useState(filters.code);
  const codeCheck = checkOrderCode(codeDraft);
  const [moreOpen, setMoreOpen] = useState(() => filters.restaurantId !== '' || filters.accountId !== '' || filters.placedFrom !== null || filters.placedTo !== null);

  const [rows, setRows] = useState<OrderSummary[]>([]);
  const [page, setPage] = useState<Pick<Page, 'cursor' | 'hasMore' | 'total'>>({ cursor: null, hasMore: false, total: null });
  const [load, setLoad] = useState<Load>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // When the list was last read, and which orders changed state since the read before it (Refresh).
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [changes, setChanges] = useState<ReadonlyMap<string, Change>>(() => new Map());
  const [refreshing, setRefreshing] = useState(false);
  const rowsRef = useRef<OrderSummary[]>([]);
  rowsRef.current = rows;
  const loadedAtRef = useRef<Date | null>(null);
  loadedAtRef.current = loadedAt;
  const ticket = useRef(0);
  const filterKey = JSON.stringify(filters);

  const run = useCallback(async () => {
    const mine = ++ticket.current;
    setLoad('loading');
    setLoadMoreFailed(false);
    setLoadingMore(false);
    setRefreshing(false);
    try {
      const first = await fetchPage(filters, null);
      if (mine !== ticket.current) return;
      setRows(first.rows);
      setPage({ cursor: first.cursor, hasMore: first.hasMore, total: first.total });
      setChanges(new Map());
      setLoadedAt(new Date());
      setLoad('ready');
    } catch {
      if (mine !== ticket.current) return;
      setLoad('error');
    }
    // `filterKey` stands for `filters`: the memo above already keeps it stable between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    void run();
  }, [run]);

  /**
   * Refresh, once the list is on screen: read the first page again WITHOUT blanking the list, and mark
   * each order whose state differs from the read before ("Updated", "Was Preparing at 6:52 pm").
   * Before the first read, or after a failed one, it is a plain reload.
   */
  const refresh = useCallback(async () => {
    if (load !== 'ready') {
      void run();
      return;
    }
    const mine = ++ticket.current;
    const previousAt = loadedAtRef.current ?? new Date();
    setRefreshing(true);
    setLoadingMore(false);
    setLoadMoreFailed(false);
    try {
      const first = await fetchPage(filters, null);
      if (mine !== ticket.current) return;
      const before = new Map(rowsRef.current.map((r) => [r.id, r.state]));
      const moved = new Map<string, Change>();
      for (const r of first.rows) {
        const was = before.get(r.id);
        if (was !== undefined && was !== r.state) moved.set(r.id, { from: was, at: previousAt });
      }
      setRows(first.rows);
      setPage({ cursor: first.cursor, hasMore: first.hasMore, total: first.total });
      setChanges(moved);
      setLoadedAt(new Date());
    } catch {
      if (mine === ticket.current) setLoad('error');
    } finally {
      if (mine === ticket.current) setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, run, filterKey]);

  const loadMore = useCallback(async () => {
    if (!page.cursor || loadingMore) return;
    const mine = ticket.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await fetchPage(filters, page.cursor);
      if (mine !== ticket.current) return;
      setRows((cur) => [...cur, ...next.rows.filter((r) => !cur.some((c) => c.id === r.id))]);
      setPage({ cursor: next.cursor, hasMore: next.hasMore, total: next.total ?? page.total });
    } catch {
      if (mine === ticket.current) setLoadMoreFailed(true);
    } finally {
      if (mine === ticket.current) setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.cursor, page.total, loadingMore, filterKey]);

  // Disputes: keep following the cursor until the end, then sort. Orders waits for scrolling.
  const everyPageLoaded = !page.hasMore && load === 'ready';
  useEffect(() => {
    if (!disputes || load !== 'ready' || !page.hasMore || loadingMore || loadMoreFailed) return;
    void loadMore();
  }, [disputes, load, page.hasMore, loadingMore, loadMoreFailed, loadMore]);

  const shown = useMemo(() => (disputes && everyPageLoaded ? sortByDeadline(rows) : rows), [disputes, everyPageLoaded, rows]);

  const running = isRunningPreset(filters.states);
  const from = disputes ? 'disputes' : running ? 'running' : 'all';
  const filtered = hasFilters(disputes ? { ...filters, states: [] } : filters);
  const restaurantBad = filters.restaurantId !== '' && !isUuid(filters.restaurantId);
  const accountBad = filters.accountId !== '' && !isUuid(filters.accountId);

  function clearAll() {
    setCodeDraft('');
    setFilters(NO_FILTERS);
  }

  const columns: DataGridColumn<OrderSummary>[] = [
    { key: 'code', header: 'Order', width: disputes ? 120 : 116, mono: true, render: (r) => r.code },
    ...(disputes
      ? []
      : [
          {
            key: 'state',
            header: 'State',
            width: 190,
            render: (r: OrderSummary) => {
              const moved = changes.get(r.id);
              return moved ? (
                <span className="flex flex-col items-start gap-1">
                  <span className="inline-flex items-center gap-2">
                    <StateBadge state={r.state} />
                    <Badge variant="info" size="sm">
                      {ORDERS.updated}
                    </Badge>
                  </span>
                  <span className="whitespace-normal text-body-sm text-fg-secondary">{ORDERS.wasState(ORDER_STATE[moved.from].label, formatTime(moved.at))}</span>
                </span>
              ) : (
                <StateBadge state={r.state} />
              );
            },
          } satisfies DataGridColumn<OrderSummary>,
        ]),
    {
      key: 'deadline',
      header: 'Next deadline',
      width: disputes ? 300 : 170,
      render: (r) => <DeadlineCell state={r.state} deadlineAt={r.deadline_at} />,
    },
    { key: 'restaurant', header: 'Restaurant', width: 150, render: (r) => <span className="whitespace-normal leading-snug">{r.restaurant.name}</span> },
    { key: 'halal', header: 'Restaurant halal status now', width: 170, render: (r) => <HalalCell halal={r.restaurant.halal} /> },
    { key: 'total', header: 'Total', width: 92, align: 'end', render: (r) => <Price cents={r.total_cents} size="sm" /> },
    {
      key: 'placed',
      header: 'Placed',
      width: 120,
      render: (r) => (
        <time dateTime={r.placed_at} title={formatFullDateTime(r.placed_at)} className="tabular-nums">
          {formatShortDateTime(r.placed_at)}
        </time>
      ),
    },
    ...(disputes
      ? []
      : [
          {
            key: 'items',
            header: 'Items',
            render: (r: OrderSummary) => <span className="line-clamp-2 whitespace-normal text-body-sm text-fg-secondary">{itemsText(r)}</span>,
          } satisfies DataGridColumn<OrderSummary>,
        ]),
  ];

  const codeSearched = filters.code !== '';
  const emptySlot = codeSearched ? (
    <EmptyState
      icon="search"
      variant="filtered"
      {...(disputes ? { title: DISPUTES.noCode(filters.code).title, description: DISPUTES.noCode(filters.code).body } : { title: ORDERS.noCode(filters.code).title, description: ORDERS.noCode(filters.code).body })}
      action={
        <Button variant="tertiary" iconStart="close" onPress={clearAll}>
          {ORDERS.clear}
        </Button>
      }
    />
  ) : filtered ? (
    <EmptyState
      icon="search"
      variant="filtered"
      title={ORDERS.filtered.title}
      description={ORDERS.filtered.body}
      action={
        <Button variant="tertiary" iconStart="close" onPress={clearAll}>
          {ORDERS.clear}
        </Button>
      }
    />
  ) : disputes ? (
    <EmptyState icon="check" title={DISPUTES.empty.title} description={DISPUTES.empty.body} />
  ) : (
    <EmptyState icon="orders" title={ORDERS.empty.title} description={ORDERS.empty.body} />
  );

  const total = page.total;
  let countText = '';
  let footerSlot: React.ReactNode;
  if (load === 'ready' && shown.length > 0) {
    if (disputes) {
      if (loadMoreFailed) countText = DISPUTES.failedCount(rows.length, total);
      else if (!everyPageLoaded) countText = DISPUTES.progress(rows.length, total);
      else countText = DISPUTES.sorted(rows.length, rows.length);
      if (loadMoreFailed) {
        footerSlot = (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-body-sm text-fg-secondary">
            <span>{DISPUTES.failedMore(total === null ? null : total - rows.length, rows.length)}</span>
            <Button variant="tertiary" size="sm" iconStart="refresh" onPress={() => void loadMore()}>
              {ORDERS.tryAgain}
            </Button>
          </div>
        );
      } else if (!everyPageLoaded) {
        footerSlot = <div className="px-3 py-2 text-body-sm text-fg-secondary">{DISPUTES.loadingAll(total)}</div>;
      } else {
        footerSlot = <div className="px-3 py-2 text-body-sm text-fg-secondary">{DISPUTES.endOfList(rows.length)}</div>;
      }
    } else if (!page.hasMore) {
      countText = `Showing all ${rows.length}, newest first`;
      footerSlot = <div className="px-3 py-2 text-body-sm text-fg-secondary">{ORDERS.endOfList}</div>;
    } else {
      countText = `${running ? `${rows.length} still running` : `Showing ${rows.length}`}, newest first. More load as you scroll.`;
      if (loadMoreFailed) {
        footerSlot = (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-body-sm text-fg-secondary">
            <span>{ORDERS.moreFailed(rows.length)}</span>
            <Button variant="tertiary" size="sm" iconStart="refresh" onPress={() => void loadMore()}>
              {ORDERS.tryAgain}
            </Button>
          </div>
        );
      }
    }
  }

  const noun = disputes ? 'disputes' : 'orders';
  const retry = () => void run();
  const asOf = loadedAt && load === 'ready' ? (changes.size > 0 ? ORDERS.asOfChanged(formatTime(loadedAt), changes.size) : ORDERS.asOf(formatTime(loadedAt))) : '';

  return (
    <section aria-label={disputes ? 'Disputes page' : 'Orders page'} className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
      {!online ? <Banner tone="warning" title={ORDERS.offlineTitle} description={ORDERS.offline(noun)} announce="status" /> : null}

      {/* As `ORD/OrdersGrid` draws it: one outlined card holding the filters in a row, "More filters"
          opening a second row inside it; below it the table's header row (caption, count, the
          All orders / Still running switch, when the list was read, Refresh). */}
      <div className="rounded-lg border border-line-decorative bg-surface-raised px-4 py-3">
        <div role="group" aria-label={disputes ? 'Dispute filters' : 'Order filters'} data-testid="FilterBar" className="flex flex-col gap-2">
          <div className="flex items-start gap-3">
            <Input
              label={ORDERS.codeLabel}
              variant="search"
              value={codeDraft}
              placeholder="HG-8F3K2Q"
              helperText={ORDERS.codeHelp}
              errorText={codeCheck.kind === 'invalid' ? codeCheck.message : null}
              onValueChange={(v) => {
                setCodeDraft(v);
                const check = checkOrderCode(v);
                if (check.kind === 'valid') setFilters({ ...filters, code: check.code });
                else if (check.kind === 'empty') setFilters({ ...filters, code: '' });
              }}
              style={{ width: 240 }}
            />
            {disputes ? (
              <Input label="State" value="Disputed" readOnly helperText="Fixed for this view" style={{ width: 180 }} />
            ) : (
              <MultiSelect
                label="State"
                placeholder="All 14 states"
                helperText="One or more states"
                value={[...filters.states]}
                options={STATE_KEYS.map((s) => ({ value: s, label: ORDER_STATE[s].label }))}
                formatSummary={(sel) => (running ? `${RUNNING_STATES.length} states selected` : sel.length === 0 ? 'All 14 states' : sel.length === 1 ? sel[0]!.label : `${sel.length} states selected`)}
                onValueChange={(v) => setFilters({ ...filters, states: v as OrderState[] })}
                className="w-[210px]"
              />
            )}
            <DateInput label="Placed from" value={filters.placedFrom} helperText="Like 2026-09-28" onValueChange={(v) => setFilters({ ...filters, placedFrom: v })} className="w-40" />
            <DateInput label="Placed to" value={filters.placedTo} helperText="Includes the whole day" onValueChange={(v) => setFilters({ ...filters, placedTo: v })} className="w-40" />
            {disputes ? null : (
              <div className="pt-6">
                <Button
                  variant="tertiary"
                  iconEnd={moreOpen ? 'minus' : 'chevron-down'}
                  aria-expanded={moreOpen}
                  aria-controls="orders-more-filters"
                  onPress={() => setMoreOpen((o) => !o)}
                >
                  {moreOpen ? ORDERS.fewerFilters : ORDERS.moreFilters}
                </Button>
              </div>
            )}
            {filtered ? (
              <div className="pt-6">
                <Button variant="ghost" size="md" onPress={() => clearAll()}>
                  Clear filters
                </Button>
              </div>
            ) : null}
          </div>
          {!disputes && moreOpen ? (
            <div id="orders-more-filters" role="group" aria-label="More filters" className="flex items-start gap-3 border-t border-line-decorative pt-2">
              <Input
                label={ORDERS.restaurantLabel}
                value={filters.restaurantId}
                helperText={ORDERS.restaurantHelp}
                errorText={restaurantBad ? ORDERS.notAnId : null}
                onValueChange={(v) => setFilters({ ...filters, restaurantId: v.trim() })}
                style={{ width: 300 }}
              />
              <Input
                label={ORDERS.accountLabel}
                value={filters.accountId}
                helperText={ORDERS.accountHelp}
                errorText={accountBad ? ORDERS.notAnId : null}
                onValueChange={(v) => setFilters({ ...filters, accountId: v.trim() })}
                style={{ width: 320 }}
              />
              <p className="flex max-w-[280px] items-start gap-1 pt-6 text-body-sm text-fg-secondary">
                <Icon name="info" size="sm" />
                {ORDERS.searchNote}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-heading-sm font-semibold text-fg-primary">{disputes ? ORDERS.captionDisputes : running ? ORDERS.captionRunning : ORDERS.caption}</h2>
        {disputes ? null : (
          <SegmentedControl
            label="Show"
            size="md"
            value={running ? 'running' : 'all'}
            options={[
              { value: 'all', label: 'All orders' },
              { value: 'running', label: 'Still running' },
            ]}
            onValueChange={(v) => setFilters({ ...filters, states: v === 'running' ? [...RUNNING_STATES] : [] })}
          />
        )}
        <span aria-live="polite" className="ms-auto text-body-sm text-fg-secondary">
          {countText}
          {asOf ? ` · ${asOf}` : ''}
        </span>
        <Button variant="ghost" size="md" iconStart="refresh" disabled={!online || load === 'loading' || refreshing} onPress={() => void refresh()}>
          {ORDERS.refresh}
        </Button>
      </div>
      {running && !disputes ? <p className="text-body-sm text-fg-secondary">{ORDERS.runningNote}</p> : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line-decorative bg-surface-raised">
        <DataGrid<OrderSummary>
          label={disputes ? ORDERS.captionDisputes : running ? ORDERS.captionRunning : ORDERS.caption}
          columns={columns}
          rows={shown}
          getRowId={(r) => r.id}
          rowLabel={(r) => `Order ${r.code}, ${r.restaurant.name}, ${ORDER_STATE[r.state].label}`}
          rowHref={(r) => `${base}/${r.id}?from=${from}`}
          onOpenRow={(r) => navigate(`/orders/${r.id}?from=${from}`)}
          loading={load === 'loading'}
          loadingSlot={<Skeleton variant="rows" count={8} label={disputes ? ORDERS.loadingDisputes : ORDERS.loading} />}
          errorSlot={
            load === 'error' ? (
              <ErrorState
                title={disputes ? DISPUTES.error.title : ORDERS.error.title}
                description={disputes ? DISPUTES.error.body : ORDERS.error.body}
                onRetry={retry}
              />
            ) : undefined
          }
          emptySlot={emptySlot}
          hasMore={!disputes && page.hasMore}
          loadingMore={loadingMore && !disputes}
          loadMoreFailed={!disputes && loadMoreFailed}
          onLoadMore={() => void loadMore()}
          {...(footerSlot ? { footerSlot } : {})}
        />
      </div>
    </section>
  );
}

