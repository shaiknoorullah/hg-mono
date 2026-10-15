/**
 * Restaurant applications (`RV/Queue*`, `RV/QueueGrid`): the onboarding queue, oldest first.
 *
 * - Fixed server order, no sortable headers. The restaurant name is a real link; opening a row
 *   only INSPECTS the application. Take next is the only way to claim one (`takeNextRestaurantApplication`).
 * - While you hold a claim the page leads with "Continue review" and Take next is secondary.
 * - Support agents get the list read-only: no Take next, no claim column.
 * - Loading, populated, filtered to nothing, nobody applied yet, drained, error, and every
 *   Take next outcome (claiming, nothing free, failed, already holding one) are all drawn.
 * - Time left in grid cells is plain text; only the claim strip is a live countdown.
 *
 * Not drawn here because the contract has no API for it (see the pull request): "Waiting on
 * certifying body", "Release claim…" for super admins, the missing-documents column for support,
 * and the held-still "new items" notice (the queue does not subscribe to new applications).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHref, useNavigate } from 'react-router-dom';

import { api } from '../../data/api';
import { useMutation } from '../../data/mutation';
import { formatTime } from '../../data/format';
import { Badge, Button, Countdown, DataGrid, DateCell, EmptyState, ErrorState, FilterBar, Icon, InlineAlert, Select, Skeleton, Switch, type DataGridColumn } from '../../ds';
import { unwrap } from '../../../lib/load';
import { claimOf, formatLeft } from '../shared/claim';
import { errorCode } from '../shared/errors';
import { useViewer } from '../shared/useViewer';
import {
  attemptLabel,
  claimText,
  DEFAULT_STATE_FILTER,
  heldBy,
  isFiltered,
  slaOf,
  STATE_FILTER_OPTIONS,
  STATE_LABEL,
  stateTone,
  statesFor,
  type StateFilter,
  type Summary,
} from './model';
import { QUEUE } from './copy';

const PAGE_SIZE = 25;

type Load = 'loading' | 'ready' | 'error';
type TakeNotice = 'none-free' | 'failed' | 'held' | null;

interface Page {
  rows: Summary[];
  cursor: string | null;
  hasMore: boolean;
}

async function fetchPage(filter: StateFilter, breachedOnly: boolean, cursor: string | null): Promise<Page> {
  const body = await unwrap(
    api.GET('/v1/admin/restaurant-applications', {
      params: {
        query: {
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
          ...(breachedOnly ? { sla_breached: true } : {}),
          ...(statesFor(filter) ? { state: statesFor(filter)! } : {}),
        },
      },
      // The contract declares `style: form, explode: false`: state=DOCUMENTS_REVIEW,DOCUMENTS_REJECTED.
      querySerializer: { array: { style: 'form', explode: false } },
    }),
  );
  return { rows: body.data, cursor: body.meta.next_cursor, hasMore: body.meta.has_more };
}

export default function RestaurantQueueRoute() {
  const viewer = useViewer();
  const navigate = useNavigate();
  const base = useHref('/restaurants');

  const [filter, setFilter] = useState<StateFilter>(DEFAULT_STATE_FILTER);
  const [breachedOnly, setBreachedOnly] = useState(false);
  const [rows, setRows] = useState<Summary[]>([]);
  const [page, setPage] = useState<Pick<Page, 'cursor' | 'hasMore'>>({ cursor: null, hasMore: false });
  const [load, setLoad] = useState<Load>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [notice, setNotice] = useState<TakeNotice>(null);
  const ticket = useRef(0);

  const run = useCallback(async () => {
    const mine = ++ticket.current;
    setLoad('loading');
    setLoadMoreFailed(false);
    try {
      const first = await fetchPage(filter, breachedOnly, null);
      if (mine !== ticket.current) return;
      setRows(first.rows);
      setPage({ cursor: first.cursor, hasMore: first.hasMore });
      setLoad('ready');
    } catch {
      if (mine !== ticket.current) return;
      setLoad('error');
    }
  }, [filter, breachedOnly]);

  useEffect(() => {
    void run();
  }, [run]);

  const loadMore = useCallback(async () => {
    if (!page.cursor || loadingMore) return;
    const mine = ticket.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await fetchPage(filter, breachedOnly, page.cursor);
      if (mine !== ticket.current) return;
      setRows((current) => [...current, ...next.rows.filter((r) => !current.some((c) => c.restaurant_id === r.restaurant_id))]);
      setPage({ cursor: next.cursor, hasMore: next.hasMore });
    } catch {
      if (mine === ticket.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [page.cursor, loadingMore, filter, breachedOnly]);

  const take = useMutation(async (_args: void, key: string) => {
    const body = await unwrap(api.POST('/v1/admin/restaurant-applications/take-next', { params: { header: { 'Idempotency-Key': key } } }));
    return body.data;
  });

  const held = useMemo(() => heldBy(rows, viewer.accountId), [rows, viewer.accountId]);

  async function onTakeNext() {
    setNotice(null);
    const outcome = await take.send();
    if (outcome.kind === 'done') {
      if (outcome.data === null) {
        setNotice('none-free');
        return;
      }
      if (held && outcome.data.restaurant_id === held.restaurant_id) {
        setNotice('held');
        return;
      }
      navigate(`/restaurants/${outcome.data.restaurant_id}`);
      return;
    }
    // A 409 means the server refused a second claim; anything else, including no answer, is a failure to retry.
    setNotice(outcome.kind === 'refused' && outcome.error.status === 409 && held ? 'held' : 'failed');
  }

  const filtered = isFiltered(filter, breachedOnly);
  const support = !viewer.canDecide;
  const drained = load === 'ready' && rows.length === 0 && !filtered;
  const noRecords = load === 'ready' && rows.length === 0 && filter === 'ALL' && !breachedOnly;
  const takeOff = support || load !== 'ready' || (rows.length === 0 && !held) || take.sending;

  function clearFilters() {
    setFilter(DEFAULT_STATE_FILTER);
    setBreachedOnly(false);
  }

  const columns: DataGridColumn<Summary>[] = [
    {
      key: 'name',
      header: 'Restaurant',
      width: '22%',
      render: (row) => <span className="font-semibold text-fg-primary">{row.display_name}</span>,
    },
    { key: 'city', header: 'City', width: '14%', render: (row) => `${row.city ?? ''}${row.province ? `, ${row.province}` : ''}` },
    {
      key: 'state',
      header: 'State',
      width: '16%',
      render: (row) => (
        <Badge variant={stateTone(row.onboarding_state)} size="sm">
          {STATE_LABEL[row.onboarding_state]}
        </Badge>
      ),
    },
    { key: 'attempt', header: 'Attempt', width: '8%', render: (row) => attemptLabel(row.submission_count) },
    { key: 'submitted', header: 'Submitted', width: '14%', render: (row) => <DateCell value={row.submitted_at} /> },
    {
      key: 'sla',
      header: 'SLA',
      width: '14%',
      render: (row) => {
        const sla = slaOf(row);
        if (sla.kind === 'waiting-on-restaurant') return <span className="text-fg-secondary">{QUEUE.slaWaiting}</span>;
        if (sla.kind === 'not-in-review') return <span className="text-fg-secondary">{QUEUE.slaNotInReview}</span>;
        return sla.breached ? (
          <Badge variant="warning" size="sm" icon="warning">
            {QUEUE.slaBreached}
          </Badge>
        ) : (
          <span className="flex flex-col leading-tight">
            <DateCell value={sla.dueAt} />
            <span className="text-body-sm text-fg-secondary">{formatLeft(sla.dueAt)}</span>
          </span>
        );
      },
    },
    ...(support
      ? []
      : [
          {
            key: 'claim',
            header: 'Claim',
            render: (row: Summary) => {
              const claim = claimOf(row, viewer.accountId);
              const text = claimText(claim);
              return claim.kind === 'unclaimed' ? (
                <span className="text-fg-secondary">{text.primary}</span>
              ) : (
                <span className="flex items-center gap-1">
                  <Icon name="lock" size="sm" />
                  <span className="flex flex-col leading-tight">
                    <span>{text.primary}</span>
                    <span className="text-body-sm text-fg-secondary">
                      Until {formatTime(claim.expiresAt)} · {text.secondary}
                    </span>
                  </span>
                </span>
              );
            },
          } satisfies DataGridColumn<Summary>,
        ]),
  ];

  const countLine =
    load === 'loading' ? 'Loading' : load === 'error' ? '' : rows.length === 0 ? 'Oldest first · showing 0' : `Fixed order, oldest first · showing ${rows.length}`;

  return (
    <section aria-label="Restaurant applications" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {held && !support ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line-strong bg-surface-subtle px-4 py-3" data-testid="ClaimStrip">
          <Icon name="lock" size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-body-md text-fg-primary">
              You’re reviewing {held.display_name} ·{' '}
              <Countdown variant="text" size="sm" expiresAt={held.review_lock_expires_at!} serverNow={new Date().toISOString()} windowSeconds={3600} criticalThreshold={0} label="left" />
            </p>
            <p className="text-body-sm text-fg-secondary">{QUEUE.claimStrip(held.display_name, formatTime(held.review_lock_expires_at))}</p>
          </div>
          <Button variant="primary" iconEnd="chevron-right" href={`${base}/${held.restaurant_id}`}>
            {QUEUE.continueReview}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar label="Queue filters" active={filtered} onClear={clearFilters} end={<span className="text-body-sm text-fg-secondary">{countLine}</span>}>
          <Select
            label="Onboarding state"
            value={filter}
            options={STATE_FILTER_OPTIONS.map((o) => ({ ...o }))}
            onValueChange={(v) => setFilter(v as StateFilter)}
            style={{ width: 280 }}
          />
          <Switch label={QUEUE.slaOnly} stateLabel={{ on: 'On', off: 'Off' }} checked={breachedOnly} onCheckedChange={setBreachedOnly} />
        </FilterBar>
        {support ? null : (
          <Button
            variant={held ? 'secondary' : 'primary'}
            iconEnd="chevron-right"
            disabled={takeOff}
            loading={take.sending}
            onPress={() => void onTakeNext()}
          >
            {QUEUE.takeNext}
          </Button>
        )}
      </div>

      {notice === 'none-free' ? (
        <InlineAlert tone="neutral" title={QUEUE.takeNull.title}>
          {QUEUE.takeNull.body}
        </InlineAlert>
      ) : null}
      {notice === 'failed' ? (
        <InlineAlert
          tone="warning"
          blocking
          title={QUEUE.takeFailed.title}
          action={
            <Button variant="tertiary" iconStart="refresh" onPress={() => void onTakeNext()}>
              {QUEUE.tryAgain}
            </Button>
          }
        >
          {QUEUE.takeFailed.body}
        </InlineAlert>
      ) : null}
      {notice === 'held' && held ? (
        <InlineAlert tone="neutral" blocking title={QUEUE.takeHeld.title(held.display_name)}>
          {QUEUE.takeHeld.body(held.display_name, formatTime(held.review_lock_expires_at))}
        </InlineAlert>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line-decorative bg-surface-raised">
        <DataGrid<Summary>
          label={support ? QUEUE.captionSupport : QUEUE.caption}
          columns={columns}
          rows={rows}
          getRowId={(row) => row.restaurant_id}
          rowLabel={(row) => `${row.display_name}, ${STATE_LABEL[row.onboarding_state]}`}
          rowHref={(row) => `${base}/${row.restaurant_id}`}
          onOpenRow={(row) => navigate(`/restaurants/${row.restaurant_id}`)}
          loading={load === 'loading'}
          loadingSlot={<Skeleton variant="rows" count={8} label={QUEUE.loading} />}
          errorSlot={
            load === 'error' ? (
              <ErrorState title={QUEUE.error.title} description={QUEUE.error.body} onRetry={() => void run()} />
            ) : undefined
          }
          emptySlot={
            noRecords ? (
              <EmptyState icon="orders" title={QUEUE.noRecords.title} description={QUEUE.noRecords.body} />
            ) : filtered ? (
              <EmptyState
                icon="search"
                variant="filtered"
                title={QUEUE.filtered.title}
                description={QUEUE.filtered.body}
                action={
                  <Button variant="tertiary" iconStart="close" onPress={clearFilters}>
                    {QUEUE.clearFilters}
                  </Button>
                }
              />
            ) : drained ? (
              <EmptyState icon="check" title={QUEUE.drained.title} description={QUEUE.drained.body} />
            ) : undefined
          }
          hasMore={page.hasMore}
          loadingMore={loadingMore}
          loadMoreFailed={loadMoreFailed}
          onLoadMore={() => void loadMore()}
        />
      </div>
    </section>
  );
}
