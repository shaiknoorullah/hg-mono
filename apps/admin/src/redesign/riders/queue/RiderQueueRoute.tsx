/**
 * Rider applications (rider-onboarding `Main` and every `Queue*` board): the onboarding queue,
 * oldest first.
 *
 * - Fixed server order, no sortable headers. A row is a real link; opening it only READS the
 *   application. Take next is the only way to claim one (`takeNextRiderApplication`).
 * - While you hold a claim the page leads with "Continue review" and Take next is secondary.
 * - The route is closed to support agents (owner question: support has no rider queue at launch),
 *   so there is no read-only variant here even though the contract lets support list riders.
 * - Loading, populated, drained, filtered to nothing, forbidden, error and every Take next outcome
 *   (claiming, nothing free, all claimed, failed, already holding one) are all drawn.
 * - Time left in grid cells is plain text; only the claim strip is a live countdown.
 *
 * Not drawn, with the reason: "Missed review target only" and a name or phone search (the list
 * operation has no such parameters), and the nav count (the list response carries no total).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHref, useNavigate } from 'react-router-dom';
import { isApiError } from '@hg/api-client';

import { api } from '../../data/api';
import { useMutation } from '../../data/mutation';
import { formatShortDate, formatTime } from '../../data/format';
import { useOnline } from '../../auth/online';
import { Badge, Banner, Button, Countdown, DataGrid, EmptyState, ErrorState, FilterBar, Icon, InlineAlert, MultiSelect, Skeleton, type DataGridColumn } from '../../ds';
import { unwrap } from '../../../lib/load';
import { claimOf, formatLeft } from '../../verification/shared/claim';
import { useViewer } from '../../verification/shared/useViewer';
import { QUEUE } from './copy';
import {
  ALL_STATES,
  claimText,
  DEFAULT_STATES,
  filterText,
  firstClaimEnd,
  formatOver,
  formatUntil,
  heldBy,
  isFiltered,
  isSubmitted,
  reviewTargetOf,
  STATE_LABEL,
  stateIcon,
  stateTone,
  vehicleLabel,
  type OnboardingState,
  type Summary,
} from './model';

const PAGE_SIZE = 25;

type Load = 'loading' | 'ready' | 'error' | 'forbidden';
type TakeNotice = 'none-free' | 'failed' | 'held' | null;

interface Page {
  rows: Summary[];
  cursor: string | null;
  hasMore: boolean;
}

async function fetchPage(states: readonly OnboardingState[], cursor: string | null): Promise<Page> {
  const body = await unwrap(
    api.GET('/v1/admin/rider-applications', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}), ...(states.length > 0 ? { state: [...states] } : {}) } },
      // The contract declares `style: form, explode: false`: state=DOCUMENTS_REVIEW,DOCUMENTS_REJECTED.
      querySerializer: { array: { style: 'form', explode: false } },
    }),
  );
  return { rows: body.data, cursor: body.meta.next_cursor, hasMore: body.meta.has_more };
}

export default function RiderQueueRoute() {
  const viewer = useViewer();
  const navigate = useNavigate();
  const base = useHref('/riders');
  const online = useOnline();

  const [states, setStates] = useState<OnboardingState[]>([...DEFAULT_STATES]);
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
      const first = await fetchPage(states, null);
      if (mine !== ticket.current) return;
      setRows(first.rows);
      setPage({ cursor: first.cursor, hasMore: first.hasMore });
      setLoad('ready');
    } catch (err) {
      if (mine !== ticket.current) return;
      setLoad(isApiError(err) && err.status === 403 ? 'forbidden' : 'error');
    }
  }, [states]);

  useEffect(() => {
    void run();
  }, [run]);

  const loadMore = useCallback(async () => {
    if (!page.cursor || loadingMore) return;
    const mine = ticket.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await fetchPage(states, page.cursor);
      if (mine !== ticket.current) return;
      setRows((current) => [...current, ...next.rows.filter((r) => !current.some((c) => c.rider_account_id === r.rider_account_id))]);
      setPage({ cursor: next.cursor, hasMore: next.hasMore });
    } catch {
      if (mine === ticket.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [page.cursor, loadingMore, states]);

  const take = useMutation(async (_args: void, key: string) => {
    const body = await unwrap(api.POST('/v1/admin/rider-applications/take-next', { params: { header: { 'Idempotency-Key': key } } }));
    return body.data;
  });

  const held = useMemo(() => heldBy(rows, viewer.accountId), [rows, viewer.accountId]);
  const ended = useMemo(() => rows.find((r) => claimOf(r, viewer.accountId).kind === 'ended') ?? null, [rows, viewer.accountId]);

  async function onTakeNext() {
    setNotice(null);
    const outcome = await take.send();
    if (outcome.kind === 'done') {
      if (outcome.data === null) {
        setNotice('none-free');
        return;
      }
      if (held && outcome.data.rider_account_id === held.rider_account_id) {
        setNotice('held');
        return;
      }
      navigate(`/riders/${outcome.data.rider_account_id}`);
      return;
    }
    // A 409 means the server refused a second claim; anything else, including no answer, is a failure to retry.
    setNotice(outcome.kind === 'refused' && outcome.error.status === 409 && held ? 'held' : 'failed');
  }

  const filtered = isFiltered(states);
  const ready = load === 'ready';
  const waiting = rows.filter((r) => r.onboarding_state === 'DOCUMENTS_REVIEW');
  const everyWaitingClaimed =
    ready &&
    !filtered &&
    rows.length > 0 &&
    rows.every((r) => {
      const claim = claimOf(r, viewer.accountId);
      return claim.kind === 'other';
    });
  const takeOff = !online || (ready && !filtered && rows.length === 0 && !held) || take.sending;
  const takeHelp = !online
    ? QUEUE.takeHelpOffline
    : take.sending
      ? QUEUE.takeHelpTaking
      : ready && !filtered && rows.length === 0 && !held
        ? QUEUE.takeHelpNothing
        : load === 'error' || load === 'forbidden'
          ? QUEUE.takeHelpListDown
          : load === 'loading'
            ? QUEUE.takeHelpLoading
            : QUEUE.takeHelp;

  const columns: DataGridColumn<Summary>[] = [
    {
      key: 'name',
      header: 'Applicant',
      width: '20%',
      render: (row) => (
        <span className="flex flex-col leading-tight">
          <span className="font-semibold text-fg-primary">{row.display_name}</span>
          <span className="font-mono text-body-sm text-fg-secondary">{shortId(row.rider_account_id)}</span>
        </span>
      ),
    },
    { key: 'vehicle', header: 'Vehicle', width: '10%', render: (row) => vehicleLabel(row.vehicle_type) },
    {
      key: 'state',
      header: 'State',
      width: '16%',
      render: (row) => (
        <Badge variant={stateTone(row.onboarding_state)} size="md" icon={stateIcon(row.onboarding_state)}>
          {STATE_LABEL[row.onboarding_state]}
        </Badge>
      ),
    },
    { key: 'attempt', header: 'Attempt', width: '8%', align: 'end', render: (row) => String(row.attempt_number ?? 1) },
    {
      key: 'submitted',
      header: 'Submitted',
      width: '14%',
      render: (row) =>
        isSubmitted(row.onboarding_state) ? (
          <span className="flex flex-col leading-tight">
            <span>{`${formatShortDate(row.submitted_at)}, ${formatTime(row.submitted_at)}`}</span>
            <span className="text-body-sm text-fg-secondary">{ago(row.submitted_at)}</span>
          </span>
        ) : (
          <span className="text-body-sm text-fg-secondary">{QUEUE.notSubmitted}</span>
        ),
    },
    {
      key: 'target',
      header: 'Review target',
      width: '16%',
      render: (row) => {
        const target = reviewTargetOf(row);
        if (target.kind === 'not-in-review') return <span className="text-body-sm text-fg-secondary">{QUEUE.notInReview}</span>;
        if (target.kind === 'decided') return <span className="text-body-sm text-fg-secondary">{QUEUE.decided}</span>;
        if (target.kind === 'missed') {
          return (
            <span className="flex flex-col gap-0.5 leading-tight">
              <Badge variant="warning" size="md" icon="warning">
                {QUEUE.targetMissed}
              </Badge>
              <span className="font-mono text-body-sm text-fg-secondary">{`Was due ${formatShortDate(target.dueAt)}, ${formatTime(target.dueAt)} · ${formatOver(target.overMs)}`}</span>
            </span>
          );
        }
        return (
          <span className="flex flex-col leading-tight">
            <span>{`Due ${formatShortDate(target.dueAt)}, ${formatTime(target.dueAt)}`}</span>
            <span className="font-mono text-body-sm text-fg-secondary">{formatUntil(target.dueAt)}</span>
          </span>
        );
      },
    },
    {
      key: 'claim',
      header: 'Claim',
      render: (row) => {
        const claim = claimOf(row, viewer.accountId);
        const text = claimText(row, claim);
        return (
          <span className="flex items-start gap-1.5">
            {claim.kind === 'mine' || claim.kind === 'other' ? <Icon name="lock" size="sm" /> : null}
            <span className="flex flex-col leading-tight">
              <span className={claim.kind === 'unclaimed' || claim.kind === 'ended' ? 'text-fg-secondary' : undefined}>{text.primary}</span>
              {text.secondary ? <span className="font-mono text-body-sm text-fg-secondary">{text.secondary}</span> : null}
            </span>
          </span>
        );
      },
    },
  ];

  const countLine =
    load === 'loading'
      ? 'Loading…'
      : !ready
        ? ''
        : !online
          ? 'Offline · this list may be out of date'
          : rows.length === 0
            ? filtered
              ? `0 in ${filterText(states)}`
              : '0 waiting'
            : page.hasMore
              ? `Showing ${rows.length} · more below · oldest first`
              : filtered
                ? `Showing ${rows.length} · oldest first`
                : `${waiting.length} waiting · oldest first`;

  const emptyLabel = filterText(states);

  return (
    <section aria-label="Rider applications" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {!online ? <Banner tone="warning" title={QUEUE.offline.title} description={QUEUE.offline.body} announce="status" /> : null}

      {held ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line-strong bg-surface-subtle px-4 py-3" data-testid="ClaimStrip">
          <Icon name="lock" size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-body-md text-fg-primary">
              You have {held.display_name} claimed,{' '}
              <Countdown variant="text" size="sm" expiresAt={held.review_lock_expires_at!} serverNow={new Date().toISOString()} windowSeconds={3600} criticalThreshold={0} label="left" />
            </p>
            <p className="text-body-sm text-fg-secondary">{QUEUE.holding(held.display_name, formatLeft(held.review_lock_expires_at!)).body(formatTime(held.review_lock_expires_at))}</p>
          </div>
          <Button variant="primary" iconEnd="chevron-right" href={`${base}/${held.rider_account_id}`}>
            {QUEUE.continueReview}
          </Button>
        </div>
      ) : null}

      {ended && !held ? (
        <InlineAlert tone="warning" blocking title={QUEUE.claimEnded(ended.display_name, formatTime(ended.review_lock_expires_at)).title}>
          {QUEUE.claimEnded(ended.display_name, formatTime(ended.review_lock_expires_at)).body}
        </InlineAlert>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar label="Queue filters" active={filtered} onClear={() => setStates([...DEFAULT_STATES])} clearLabel={QUEUE.reset} end={<span className="text-body-sm text-fg-secondary">{countLine}</span>}>
          <MultiSelect
            label="Onboarding state"
            options={ALL_STATES.map((s) => ({ value: s, label: STATE_LABEL[s] }))}
            value={states}
            onValueChange={(next) => setStates(next as OnboardingState[])}
            formatSummary={(selected) => (selected.length === ALL_STATES.length ? filterText(ALL_STATES) : filterText(selected.map((s) => s.value as OnboardingState)))}
          />
        </FilterBar>
        <div className="flex items-center gap-3">
          <span id="take-reason" className="max-w-[340px] text-end text-body-sm text-fg-secondary">
            {takeHelp}
          </span>
          <Button
            variant={held ? 'secondary' : 'primary'}
            iconEnd="chevron-right"
            disabled={takeOff}
            loading={take.sending}
            aria-describedby="take-reason"
            onPress={() => void onTakeNext()}
          >
            {QUEUE.takeNext}
          </Button>
        </div>
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
        <InlineAlert tone="neutral" blocking title={QUEUE.takeHeld(held.display_name, formatTime(held.review_lock_expires_at)).title}>
          {QUEUE.takeHeld(held.display_name, formatTime(held.review_lock_expires_at)).body}
        </InlineAlert>
      ) : null}
      {everyWaitingClaimed && !held && notice === null ? (
        <InlineAlert tone="neutral" title={QUEUE.allClaimed(rows.length).title}>
          {QUEUE.allClaimed(rows.length).body(firstClaimEnd(rows) ? formatTime(firstClaimEnd(rows)) : null)}
        </InlineAlert>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line-decorative bg-surface-raised">
        <DataGrid<Summary>
          label={QUEUE.caption(filterText(states))}
          columns={columns}
          rows={rows}
          getRowId={(row) => row.rider_account_id}
          rowLabel={(row) => `rider application ${row.display_name}`}
          rowHref={(row) => `${base}/${row.rider_account_id}`}
          onOpenRow={(row) => navigate(`/riders/${row.rider_account_id}`)}
          loading={load === 'loading'}
          loadingSlot={<Skeleton variant="rows" count={8} label={QUEUE.loading} />}
          errorSlot={
            load === 'error' ? (
              <ErrorState title={QUEUE.error.title} description={QUEUE.error.body} onRetry={() => void run()} />
            ) : load === 'forbidden' ? (
              <EmptyState icon="lock" title={QUEUE.forbidden.title} description={QUEUE.forbidden.body} />
            ) : undefined
          }
          emptySlot={
            filtered ? (
              <EmptyState icon="search" variant="filtered" title={QUEUE.filtered(emptyLabel).title} description={QUEUE.filtered(emptyLabel).body} />
            ) : (
              <EmptyState
                icon="check"
                title={QUEUE.empty.title}
                description={QUEUE.empty.body}
                action={
                  <Button variant="tertiary" onPress={() => setStates([...ALL_STATES])}>
                    {QUEUE.showAll}
                  </Button>
                }
              />
            )
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

/** "0192f3…9c1a": enough of the account id to tell two applicants apart. */
function shortId(id: string): string {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** "2 days ago", "yesterday", "today", "1 h ago": a plain age under a date cell. */
function ago(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
