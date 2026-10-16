/**
 * Payout history, `/payouts/history` (canvas `PY` `Payouts-History*`, `PayoutDetail-*`): the
 * restaurant's weekly payouts newest first, a line for the ones that need attention, and a panel
 * beside the list for one payout. `?payout=<id>` opens that payout; there is no restaurant
 * payout-by-id call, so the page loads further pages until the payout turns up or the list ends.
 *
 * Every state is drawn: loading, empty, error (with the header kept), load more (loading and
 * failed), end of list, and a live row change from `restaurant.payout_updated`. Only the account
 * owner may read payouts (the contract says so), so a manager sees a plain explanation instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { eventOfType, useRealtimeChannel } from '@hg/ui-web/live';
import { Badge, Button, DataTable, DetailPanel, EmptyState, GlyphIcon, Icon, Price, Skeleton, type DataTableColumn } from '../ds';
import { useConsole } from '../data/console';
import { errorStatus, useServerResource } from '../data/useServerResource';
import { useIsDesktop, useIsPhone } from '../shell/viewport';
import { usePagePanelOpen } from '../shell/layout';
import { loadConnect, loadPayoutPage, openStripe } from './api';
import { PayoutDetail, type LiveNotice } from './PayoutDetail';
import { PayoutSupport } from './PayoutSupport';
import { stripeNavigation } from './AccountPage';
import { accountCard, applyPayoutUpdate, needAttention, paidCell, payoutCents, periodLabel, periodShort, restrictedKind, stateView, type PayoutRow } from './model';

interface ListState {
  status: 'loading' | 'ready' | 'error';
  rows: PayoutRow[];
  cursor: string | null;
  hasMore: boolean;
  more: 'idle' | 'loading' | 'error';
  error: unknown;
}

const START: ListState = { status: 'loading', rows: [], cursor: null, hasMore: false, more: 'idle', error: null };

export function HistoryPage() {
  const { core, timezone, profile } = useConsole();
  const desktop = useIsDesktop();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const openId = search.get('payout');
  const supportOpen = search.get('panel') === 'support';
  const [list, setList] = useState<ListState>(START);
  const [live, setLive] = useState<{ id: string; notice: LiveNotice } | null>(null);
  const [finishBusy, setFinishBusy] = useState(false);
  const ticket = useRef(0);
  const connect = useServerResource(loadConnect);
  const restricted = restrictedKind(profile.data?.account_state);

  const loadFirst = useCallback(async (silent: boolean) => {
    const mine = ++ticket.current;
    if (!silent) setList(START);
    try {
      const page = await loadPayoutPage(null);
      if (mine !== ticket.current) return;
      setList({ status: 'ready', rows: page.rows, cursor: page.nextCursor, hasMore: page.hasMore, more: 'idle', error: null });
    } catch (error) {
      if (mine !== ticket.current) return;
      setList((s) => (silent && s.status === 'ready' ? s : { ...START, status: 'error', error }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    const mine = ticket.current;
    setList((s) => ({ ...s, more: 'loading' }));
    try {
      const page = await loadPayoutPage(listRef.current.cursor);
      if (mine !== ticket.current) return;
      setList((s) => ({ ...s, rows: [...s.rows, ...page.rows.filter((r) => !s.rows.some((x) => x.id === r.id))], cursor: page.nextCursor, hasMore: page.hasMore, more: 'idle' }));
    } catch {
      if (mine !== ticket.current) return;
      setList((s) => ({ ...s, more: 'error' }));
    }
  }, []);
  const listRef = useRef(list);
  listRef.current = list;
  const openRef = useRef(openId);
  openRef.current = openId;

  useEffect(() => {
    void loadFirst(false);
    return () => {
      ticket.current += 1;
    };
  }, [loadFirst]);

  const open = openId ? list.rows.find((r) => r.id === openId) ?? null : null;
  // A deep link pages on until the payout turns up or the list runs out.
  useEffect(() => {
    if (openId && !open && list.status === 'ready' && list.hasMore && list.more === 'idle') void loadMore();
  }, [openId, open, list.status, list.hasMore, list.more, loadMore]);

  const restaurantId = core.data?.restaurantId ?? null;
  useRealtimeChannel(restaurantId ? `restaurant:${restaurantId}` : null, (signal) => {
    if (signal.kind === 'refetch') {
      void loadFirst(true);
      return;
    }
    const ev = eventOfType(signal, 'restaurant.payout_updated');
    if (!ev) return;
    const data = ev.data;
    const current = listRef.current.rows.find((r) => r.id === data.payout_id);
    const next = applyPayoutUpdate(listRef.current.rows, data);
    if (!next) {
      void loadFirst(true);
      return;
    }
    setList((s) => ({ ...s, rows: applyPayoutUpdate(s.rows, data) ?? s.rows }));
    if (current && current.state !== data.state && data.payout_id === openRef.current) {
      const was = stateView(current.state).label;
      const now = stateView(data.state).label;
      setLive({ id: data.payout_id, notice: { title: data.state === 'FAILED' ? 'This payout just changed to Failed' : `This payout just changed to ${now}`, body: `It was ${was} when you opened it. The list now shows it too.` } });
    }
  });

  const show = (id: string | null, panel?: 'support') => {
    const q = new URLSearchParams(search);
    if (id) q.set('payout', id);
    else q.delete('payout');
    if (panel) q.set('panel', panel);
    else q.delete('panel');
    setLive(null);
    setSearch(q);
  };

  const finishSetup = async () => {
    setFinishBusy(true);
    const outcome = await openStripe(false, '', stripeNavigation.go);
    setFinishBusy(false);
    if (outcome.problem) navigate('/payouts');
  };

  const forbidden = list.status === 'error' && errorStatus(list.error) === 403;
  const searching = Boolean(openId) && !open && list.status === 'ready' && (list.hasMore && list.more !== 'error');
  const lookupFailed = Boolean(openId) && !open && list.status === 'ready' && list.more === 'error';
  const notFound = Boolean(openId) && !open && list.status === 'ready' && !list.hasMore && list.more === 'idle';
  const panelOpen = Boolean(openId) && list.status === 'ready';
  usePagePanelOpen(panelOpen || supportOpen);

  const narrow = !desktop && (panelOpen || supportOpen);
  const columns = useMemo<DataTableColumn<PayoutRow>[]>(() => {
    const cols: DataTableColumn<PayoutRow>[] = [
      {
        key: 'period',
        header: 'Period',
        cell: (r) => {
          const s = stateView(r.state);
          const label = periodLabel(r.period_start, r.period_end, timezone);
          return (
            <span className="inline-flex items-center gap-2">
              <Button variant="ghost" size="sm" accessibilityLabel={`Open payout for ${label}, ${s.label}`} onPress={() => show(r.id)}>
                {label}
              </Button>
              {r.justChanged ? <Badge label="Just changed" appearance="outline" size="sm" /> : null}
            </span>
          );
        },
        textValue: (r) => periodLabel(r.period_start, r.period_end, timezone),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'end',
        cell: (r) => {
          const c = payoutCents(r.amount_cents);
          return c === null ? <span className="text-fg-secondary">Not given</span> : <Price cents={c} />;
        },
      },
      {
        key: 'state',
        header: 'Status',
        cell: (r) => {
          const s = stateView(r.state);
          return <Badge label={s.label} variant={s.tone} icon={s.icon} size="sm" />;
        },
        textValue: (r) => stateView(r.state).label,
      },
    ];
    if (!narrow) {
      cols.push({
        key: 'paid',
        header: 'Paid into your bank',
        cell: (r) => {
          const p = paidCell(r, timezone);
          return p.muted ? <span className="text-fg-secondary">{p.text}</span> : p.text;
        },
        textValue: (r) => paidCell(r, timezone).text,
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, narrow, search]);

  const attention = list.status === 'ready' ? needAttention(list.rows) : [];
  const card = connect.data !== null && connect.status !== 'loading' && connect.status !== 'error' ? accountCard(connect.data, restricted) : null;
  const held = connect.data ? !connect.data.payouts_enabled && connect.data.stripe_account_id !== null : false;

  if (forbidden) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" data-testid="payouts-history" data-state="forbidden">
        <EmptyState
          title="Payouts are visible to the account owner"
          description="Your role can run the kitchen, but payout history is limited to the restaurant’s owner account. Ask the owner to check this page."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4" data-testid="payouts-history" data-state={list.status}>
      <main className={`flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto pb-6${panelOpen || supportOpen ? ' max-lg:hidden' : ''}`}>
        {card ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line-decorative bg-surface-raised px-4 py-3" data-testid="account-strip">
            <span className="text-body-sm text-fg-secondary">Payout account</span>
            <Badge label={card.badge} variant={card.tone} icon={card.icon} size="sm" />
            <span className="text-body-md">{card.short}</span>
            {held ? (
              <Button variant="primary" size="md" onPress={() => navigate('/payouts')}>
                Finish payout setup in Stripe
              </Button>
            ) : null}
          </div>
        ) : null}

        {attention.length > 0 ? (
          <section aria-labelledby="attn-h" className="flex flex-wrap items-center gap-3 rounded-lg border border-feedback-warning-border bg-feedback-warning-tint px-4 py-3" data-testid="attention">
            <GlyphIcon name="warning" size="md" />
            <h2 id="attn-h" className="m-0 text-label-lg">
              Need your attention:
            </h2>
            {attention.map((r) => (
              <Button key={r.id} variant="ghost" size="md" iconEnd={<Icon name="back" size={20} className="rotate-180" />} onPress={() => show(r.id)}>
                {`${periodShort(r.period_start, r.period_end, timezone)} (${r.state === 'FAILED' ? 'failed' : 'on hold'})`}
              </Button>
            ))}
          </section>
        ) : null}

        <div className={`flex flex-col rounded-lg border border-line-decorative bg-surface-raised${phone ? ' shrink-0' : ' min-h-0'}`}>
          {phone ? (
            <PayoutRows
              rows={list.rows}
              status={list.status}
              timezone={timezone}
              onOpen={show}
              onRetry={() => void loadFirst(false)}
            />
          ) : (
            <DataTable<PayoutRow>
              caption="Payouts, newest first"
              columns={columns}
              rows={list.rows}
              getRowId={(r) => r.id}
              getRowLabel={(r) => `payout for ${periodLabel(r.period_start, r.period_end, timezone)}, ${stateView(r.state).label}`}
              density="comfortable"
              stickyHeader
              loading={list.status === 'loading'}
              error={list.status === 'error' ? { code: 'NETWORK', message: 'Couldn’t load your payouts. Your money isn’t affected.', onRetry: () => void loadFirst(false) } : null}
              className="rounded-none border-0"
              emptyState={
                <EmptyState
                  variant="table"
                  headingLevel={3}
                  title="No payouts yet"
                  description="Each payout is the total of your settled orders for its period. Your first one appears here after your first settled order."
                  testId="payouts-empty"
                />
              }
              testId="payouts-table"
            />
          )}
          {list.status === 'ready' && list.rows.length > 0 ? (
            <div className="flex flex-col items-center gap-2 border-t border-line-decorative px-4 py-4" data-testid="list-foot">
              {list.hasMore ? (
                <>
                  {list.more === 'error' ? (
                    <span role="alert" className="text-body-md text-feedback-danger-text">
                      Couldn’t load more payouts. The ones above are unchanged.
                    </span>
                  ) : null}
                  <Button variant="secondary" size="md" loading={list.more === 'loading'} onPress={() => void loadMore()}>
                    {list.more === 'error' ? 'Try again' : 'Load more'}
                  </Button>
                </>
              ) : (
                <span className="text-body-sm text-fg-secondary">That’s every payout so far.</span>
              )}
            </div>
          ) : null}
        </div>
      </main>

      {supportOpen ? (
        <PayoutSupport payoutId={open?.id} onClose={() => show(null)} onBack={open ? () => show(open.id) : undefined} />
      ) : panelOpen ? (
        <DetailPanel
          title={open ? `Payout for ${periodLabel(open.period_start, open.period_end, timezone)}` : 'Payout'}
          label="Payout"
          closeLabel="Close payout"
          onClose={() => show(null)}
          width="panel"
          fullBelowLg
          busy={searching}
          testId="payout-panel"
        >
          {open ? (
            <PayoutDetail
              payout={open}
              timezone={timezone}
              connect={connect.data}
              live={live && live.id === open.id ? live.notice : null}
              onSupport={() => show(open.id, 'support')}
              onFinishSetup={() => void finishSetup()}
              finishBusy={finishBusy}
            />
          ) : searching ? (
            <div aria-busy="true" className="flex flex-col gap-3" data-testid="payout-searching">
              <span role="status" className="text-body-md text-fg-secondary">
                Finding this payout…
              </span>
              <Skeleton variant="rect" width="100%" height={20} />
              <Skeleton variant="rect" width="100%" height={20} />
              <Skeleton variant="rect" width="100%" height={20} />
            </div>
          ) : lookupFailed ? (
            <div role="alert" className="flex flex-col items-start gap-3" data-testid="payout-load-error">
              <h3 className="m-0 text-heading-sm">Couldn’t load this payout. Your money isn’t affected.</h3>
              <p className="m-0 text-body-md">Check your connection and try again. The payout history beside this panel stays as it was.</p>
              <Button variant="tertiary" size="md" onPress={() => void loadMore()}>
                Try again
              </Button>
            </div>
          ) : notFound ? (
            <div role="alert" className="flex flex-col items-start gap-3" data-testid="payout-not-found">
              <h3 className="m-0 text-heading-sm">We couldn’t find this payout</h3>
              <p className="m-0 text-body-md">The link may be for another restaurant. Your payouts are not affected.</p>
              <div className="flex gap-2">
                <Button variant="primary" size="md" onPress={() => show(null)}>
                  See all payouts
                </Button>
                <Button variant="tertiary" size="md" onPress={() => show(openId, 'support')}>
                  Contact support
                </Button>
              </div>
              <dl className="m-0 flex flex-col gap-1">
                <dt className="text-body-sm text-fg-secondary">Payout reference</dt>
                <dd className="m-0 break-all font-mono text-body-md">{openId}</dd>
              </dl>
            </div>
          ) : null}
        </DetailPanel>
      ) : null}
    </div>
  );
}

/**
 * Below 768 px the history is one stacked row per payout (period, status, amount), each a button
 * that opens the payout: the design board for payouts at phone width draws it so, in place of the table.
 * Every figure is the server's: the amount is `amount_cents` passed to `Price`, nothing is added.
 */
function PayoutRows({
  rows,
  status,
  timezone,
  onOpen,
  onRetry,
}: {
  rows: PayoutRow[];
  status: 'loading' | 'ready' | 'error';
  timezone: string;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  if (status === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-3 p-4" data-testid="payouts-table" data-state="loading">
        <span role="status" className="sr-only">
          Loading your payouts
        </span>
        <Skeleton variant="rect" width="100%" height={20} />
        <Skeleton variant="rect" width="100%" height={20} />
        <Skeleton variant="rect" width="100%" height={20} />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-4" data-testid="payouts-table" data-state="error">
        <strong className="text-label-lg">Couldn’t load your payouts. Your money isn’t affected.</strong>
        <Button variant="tertiary" size="md" onPress={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div data-testid="payouts-table" data-state="empty">
        <EmptyState
          variant="table"
          headingLevel={3}
          title="No payouts yet"
          description="Each payout is the total of your settled orders for its period. Your first one appears here after your first settled order."
          testId="payouts-empty"
        />
      </div>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-label="Payouts, newest first" data-testid="payouts-table" data-state="ready">
      {rows.map((r) => {
        const s = stateView(r.state);
        const label = periodLabel(r.period_start, r.period_end, timezone);
        const c = payoutCents(r.amount_cents);
        return (
          <li key={r.id} className="border-b border-line-decorative last:border-b-0">
            <button
              type="button"
              className="hg-focus flex min-h-16 w-full items-center gap-3 px-4 py-2 text-start text-fg-primary"
              aria-label={`Open payout for ${label}, ${s.label}`}
              onClick={() => onOpen(r.id)}
            >
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="text-label-lg">{label}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge label={s.label} variant={s.tone} icon={s.icon} size="sm" />
                  {r.justChanged ? <Badge label="Just changed" appearance="outline" size="sm" /> : null}
                </span>
              </span>
              {c === null ? <span className="text-fg-secondary">Not given</span> : <Price cents={c} />}
              <Icon name="back" size={20} className="rotate-180" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
