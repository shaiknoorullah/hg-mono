/**
 * Earnings & payouts — three tabs over the rider's server ledger.
 *
 * D-26/D-27/D-28. Every number here comes from the server: bucketed totals
 * (`getRiderEarningsSummary`), the immutable append-only entry ledger
 * (`listRiderEarningEntries`), and payout history (`listRiderPayouts`). The client never sums a
 * column itself — `sum(entries) == period total == sum(buckets)` is asserted server-side (CI),
 * not re-derived here. Money renders only through `Price`.
 *
 * Each tab keeps its own loading/error/empty/ready state — switching tabs never blanks a tab
 * that already loaded.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Divider,
  Price,
  Select,
  Tabs,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { BadgeVariant, TabSpec } from '@hg/ui-native';
import type { Schema } from '@hg/api-client';
import { cents, isApiError, unwrap } from '@hg/api-client';

import { api } from '../api';
import type { EarningsSummary, EarningEntry, Payout } from '../apiTypes';
import { Screen, LoadingView, ErrorView, EmptyView } from './Screen';
import { useNav } from '../nav';

type EarningsPeriod = Schema['EarningsPeriod'];

const TABS: TabSpec[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'entries', label: 'Activity' },
  { key: 'payouts', label: 'Payouts' },
];

export function EarningsScreen({
  initialTab = 'summary',
}: {
  initialTab?: 'summary' | 'entries' | 'payouts';
}): React.ReactElement {
  const [tab, setTab] = React.useState<string>(initialTab);

  return (
    <Screen title="Earnings" subtitle="Server ledger — 100% of tips">
      <Tabs tabs={TABS} value={tab} onChange={setTab} accessibilityLabel="Earnings sections" />
      {tab === 'summary' ? <SummaryTab /> : null}
      {tab === 'entries' ? <EntriesTab /> : null}
      {tab === 'payouts' ? <PayoutsTab /> : null}
    </Screen>
  );
}

/* ----------------------------------------------------------------------------------- SUMMARY */

const PERIODS: { value: EarningsPeriod; label: string }[] = [
  { value: 'DAY', label: 'Today' },
  { value: 'WEEK', label: 'This week' },
  { value: 'MONTH', label: 'This month' },
];

type SummaryLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; summary: EarningsSummary };

function SummaryTab(): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  const [period, setPeriod] = React.useState<EarningsPeriod>('WEEK');
  const [state, setState] = React.useState<SummaryLoad>({ status: 'loading' });

  const load = React.useCallback(async (p: EarningsPeriod) => {
    setState({ status: 'loading' });
    try {
      const data = await unwrap(
        api.GET('/v1/riders/me/earnings/summary', { params: { query: { period: p } } }),
      );
      setState({ status: 'ready', summary: data.data });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load earnings.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, []);

  React.useEffect(() => {
    void load(period);
  }, [period, load]);

  return (
    <View style={{ gap: theme.density.gutter }}>
      <Card variant="filled">
        <Select label="Period" value={period} onChange={(v) => setPeriod(v as EarningsPeriod)} options={PERIODS} />
      </Card>

      {state.status === 'loading' ? <LoadingView label="Totalling your earnings…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={() => void load(period)} />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <Card>
            <View style={{ gap: theme.density.gutter }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ ...caption, color: theme.color.text.secondary }}>TOTAL</Text>
                <Price cents={cents(Number(state.summary.total.gross_cents))} size="xl" />
              </View>
              <Divider />
              <Row label="Deliveries" value={state.summary.total.delivery_cents} />
              <Row label="Tips (100% pass-through)" value={state.summary.total.tip_cents} />
              <Row label="Bonuses" value={state.summary.total.bonus_cents} />
              <Row label="Adjustments" value={state.summary.total.adjustment_cents} sign="always" />
              <Divider />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.color.text.secondary }}>Trips</Text>
                <Text style={{ color: theme.color.text.primary }}>{state.summary.total.trips}</Text>
              </View>
            </View>
          </Card>

          <Card variant="outlined">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.color.text.secondary }}>Unpaid balance</Text>
              <Price cents={cents(Number(state.summary.unpaid_balance_cents))} size="lg" />
            </View>
            {state.summary.next_payout_at ? (
              <Text style={{ ...caption, color: theme.color.text.tertiary, marginTop: 4 }}>
                Next payout {new Date(state.summary.next_payout_at).toLocaleDateString()} — weekly, Monday, automatic, no minimum.
              </Text>
            ) : null}
          </Card>

          {state.summary.buckets.length === 0 ? (
            <EmptyView title="No activity in this period" description="Zeroed buckets, not an empty chart — nothing was earned yet." />
          ) : (
            <Card>
              <View style={{ gap: theme.target.spacing }}>
                <Text style={{ ...caption, color: theme.color.text.secondary }}>BY PERIOD</Text>
                {state.summary.buckets.map((b) => (
                  <View
                    key={b.bucket_start}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Text style={{ color: theme.color.text.secondary }}>
                      {new Date(b.bucket_start).toLocaleDateString()} · {b.trips} trip{b.trips === 1 ? '' : 's'}
                    </Text>
                    <Price cents={cents(Number(b.gross_cents))} size="sm" />
                  </View>
                ))}
              </View>
            </Card>
          )}
        </>
      ) : null}
    </View>
  );
}

function Row({
  label,
  value,
  sign = 'auto',
}: {
  label: string;
  value: unknown;
  sign?: 'auto' | 'always' | 'never';
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.color.text.secondary }}>{label}</Text>
      <Price cents={cents(Number(value ?? 0))} size="sm" sign={sign} />
    </View>
  );
}

/* ------------------------------------------------------------------------------------ ENTRIES */

const ENTRY_TYPE_LABEL: Record<string, string> = {
  DELIVERY: 'Delivery',
  TIP: 'Tip',
  CANCELLATION_COMPENSATION: 'Cancellation pay',
  BONUS: 'Bonus',
  ADJUSTMENT: 'Adjustment',
  CLAWBACK: 'Clawback',
};

const ENTRY_STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: 'Pending', variant: 'neutral' },
  AVAILABLE: { label: 'Available', variant: 'info' },
  PAID: { label: 'Paid', variant: 'brand' },
  REVERSED: { label: 'Reversed', variant: 'warning' },
};

type EntriesLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'empty' }
  | { status: 'ready'; entries: EarningEntry[]; nextCursor: string | null };

function EntriesTab(): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  const [state, setState] = React.useState<EntriesLoad>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = React.useState(false);

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await unwrap(api.GET('/v1/riders/me/earnings/entries', { params: { query: { limit: 20 } } }));
      if (data.data.length === 0) {
        setState({ status: 'empty' });
        return;
      }
      setState({ status: 'ready', entries: data.data, nextCursor: data.meta.next_cursor });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load your ledger.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadMore = React.useCallback(async () => {
    if (state.status !== 'ready' || !state.nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await unwrap(
        api.GET('/v1/riders/me/earnings/entries', {
          params: { query: { limit: 20, cursor: state.nextCursor } },
        }),
      );
      setState({
        status: 'ready',
        entries: [...state.entries, ...data.data],
        nextCursor: data.meta.next_cursor,
      });
    } finally {
      setLoadingMore(false);
    }
  }, [state]);

  return (
    <View style={{ gap: theme.density.gutter }}>
      {state.status === 'loading' ? <LoadingView label="Loading your ledger…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={load} />
      ) : null}
      {state.status === 'empty' ? (
        <EmptyView title="No earnings yet" description="Every delivery you complete lands here, itemised." />
      ) : null}
      {state.status === 'ready' ? (
        <>
          {state.entries.map((entry) => (
            <Card key={entry.id}>
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.color.text.primary, fontWeight: '600' }}>
                    {ENTRY_TYPE_LABEL[entry.type] ?? entry.type}
                  </Text>
                  <Price cents={cents(Number(entry.gross_cents))} size="md" sign="always" />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.target.spacing }}>
                  <Badge
                    label={ENTRY_STATUS_META[entry.status]?.label ?? entry.status}
                    variant={ENTRY_STATUS_META[entry.status]?.variant ?? 'neutral'}
                    size="sm"
                  />
                  {entry.order_code ? (
                    <Text style={{ ...caption, color: theme.color.text.tertiary }}>#{entry.order_code}</Text>
                  ) : null}
                </View>
                <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                  {new Date(entry.earned_at).toLocaleString()}
                </Text>
              </View>
            </Card>
          ))}
          {state.nextCursor ? (
            <Button variant="secondary" size="md" fullWidth loading={loadingMore} onPress={() => void loadMore()}>
              Load more
            </Button>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------------------ PAYOUTS */

const PAYOUT_STATE_META: Record<string, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  READY: { label: 'Ready', variant: 'info' },
  TRANSFERRING: { label: 'Transferring', variant: 'info' },
  TRANSFERRED: { label: 'Transferred', variant: 'brand' },
  PAID: { label: 'Paid', variant: 'brand' },
  FAILED: { label: 'Failed', variant: 'warning' },
  HELD: { label: 'Held', variant: 'warning' },
};

type PayoutsLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'empty' }
  | { status: 'ready'; payouts: Payout[] };

function PayoutsTab(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const caption = useTypeStyle('caption');
  const [state, setState] = React.useState<PayoutsLoad>({ status: 'loading' });

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await unwrap(api.GET('/v1/riders/me/payouts', { params: { query: { limit: 20 } } }));
      if (data.data.length === 0) {
        setState({ status: 'empty' });
        return;
      }
      setState({ status: 'ready', payouts: data.data });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load payouts.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ gap: theme.density.gutter }}>
      {state.status === 'loading' ? <LoadingView label="Loading payouts…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={load} />
      ) : null}
      {state.status === 'empty' ? (
        <EmptyView title="No payouts yet" description="Payouts run weekly, every Monday, automatically — no minimum." />
      ) : null}
      {state.status === 'ready'
        ? state.payouts.map((p) => (
            <Card
              key={p.id}
              testID={`payout-${p.id}`}
              onPress={() => nav.push('payoutDetail', { payoutId: p.id })}
              accessibilityLabel={`Payout ${new Date(p.period_start).toLocaleDateString()}`}
            >
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.color.text.primary, fontWeight: '600' }}>
                    {new Date(p.period_start).toLocaleDateString()} – {new Date(p.period_end).toLocaleDateString()}
                  </Text>
                  <Price cents={cents(Number(p.amount_cents))} size="md" />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.target.spacing }}>
                  <Badge
                    label={PAYOUT_STATE_META[p.state]?.label ?? p.state}
                    variant={PAYOUT_STATE_META[p.state]?.variant ?? 'neutral'}
                    size="sm"
                  />
                  {typeof p.entry_count === 'number' ? (
                    <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                      {p.entry_count} entr{p.entry_count === 1 ? 'y' : 'ies'}
                    </Text>
                  ) : null}
                </View>
                {p.hold_reason ? (
                  <Text style={{ ...caption, color: theme.color.text.secondary }}>{p.hold_reason}</Text>
                ) : null}
                {p.failure_message ? (
                  <Text style={{ ...caption, color: theme.color.text.secondary }}>{p.failure_message}</Text>
                ) : null}
              </View>
            </Card>
          ))
        : null}
    </View>
  );
}
