/**
 * R35 Earnings (tab root, EA/Main `Earnings-*`) and R38 Payouts (EA/Payouts `Payouts-*`).
 *
 * Both screens show the same payout banners (payout problem first, then payout account, then
 * offline; one Fix button on the screen) and the same two "right now" numbers: the next payout
 * (the top payout row's own `amount_cents`, dated by the summary's `next_payout_at`) and the
 * unpaid balance (`unpaid_balance_cents`). Nothing is added up on the phone: every amount is a
 * `*_cents` field through `Price`, and the period figures are the summary's own `total` and
 * `buckets`.
 *
 * Built to the current contract only. Not built (Alternative / Needs API): cause-sorted banners
 * (`*-cause`, `*-mapped`, `failed-transient`, `failed-twice`, `held-review`), and the paused
 * screens that still show figures (`paused-readable`, `paused-on-delivery`): while paused the
 * API answers 403 ACCOUNT_NOT_ACTIVE, so these screens show the paused state instead.
 */
import * as React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import type { Cents } from '@hg/api-client';

import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Price, Skeleton, Tabs, space, typeStyle, useTheme } from '../ds';
import { useOnline } from '../data/connectivity';
import { toRiderError, type RiderError } from '../data/errors';
import { useApiQuery, type QueryResult } from '../data/query';
import { useNav } from '../nav/Navigator';
import { payoutAlerts, nextPayout, type NextPayout, type PayoutAlert } from './alerts';
import {
  fetchConnectStatus,
  fetchEntries,
  fetchPayoutLink,
  fetchPayouts,
  fetchSummary,
  isPaused,
  isRateLimited,
  useCooldown,
  usePagedList,
  type EarningEntry,
  type EarningsBucket,
  type EarningsSummary,
  type Payout,
} from './api';
import { NEXT, PAUSED, PAYOUTS, RATE_LIMITED_WAIT, SUMMARY, BANNERS, type StateCopy } from './copy';
import {
  MONTH_NAMES,
  dayLabel,
  hoursLabel,
  isoDate,
  kmLabel,
  loadingPeriodLine,
  payoutPeriod,
  payoutRowSub,
  periodRange,
  periodStart,
  periodTitle,
  savedAtLabel,
  tripsWord,
  unitWord,
  weekRange,
  zeroLine,
  PAYOUT_STATE_WORD,
  type EarningsPeriod,
} from './format';

/* =========================================================================== R35 Earnings */

interface Selection {
  period: EarningsPeriod;
  /** Steps back from the current period (0 = this day / week / month). */
  offset: number;
  /** Set when a By-day row opened a day: where "Back to …" returns. */
  back: { period: EarningsPeriod; offset: number; label: string } | null;
}

const PERIOD_TABS = [
  { key: 'DAY', label: 'Day', testID: 'earnings-period-day' },
  { key: 'WEEK', label: 'Week', testID: 'earnings-period-week' },
  { key: 'MONTH', label: 'Month', testID: 'earnings-period-month' },
] as const;

function daysBetween(a: Date, b: Date): number {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(a) - day(b)) / 86_400_000);
}

/** The offset (from now) of the `period` that contains `date`. */
function offsetContaining(period: EarningsPeriod, date: Date, now: Date = new Date()): number {
  if (period === 'DAY') return daysBetween(date, now);
  if (period === 'MONTH') return (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
  return Math.round(daysBetween(periodStart('WEEK', 0, date), periodStart('WEEK', 0, now)) / 7);
}

function periodCrumb(period: EarningsPeriod, offset: number): string {
  const start = periodStart(period, offset);
  return period === 'MONTH' ? MONTH_NAMES[start.getMonth()] : period === 'WEEK' ? weekRange(start) : dayLabel(start);
}

export function EarningsScreen(): React.ReactElement {
  const nav = useNav();
  const online = useOnline();
  const [sel, setSel] = React.useState<Selection>({ period: 'WEEK', offset: 0, back: null });
  const from = isoDate(periodStart(sel.period, sel.offset));
  const summary = useApiQuery(`earnings-summary-${sel.period}-${from}`, () => fetchSummary(sel.period, from));
  const payouts = useApiQuery('earnings-payouts-first', () => fetchPayouts());
  const connect = useApiQuery('earnings-connect-status', fetchConnectStatus);

  // "Right now" does not change with the period: keep the latest summary that answered.
  const [rightNow, setRightNow] = React.useState<EarningsSummary | undefined>(undefined);
  React.useEffect(() => {
    if (summary.data) setRightNow(summary.data);
  }, [summary.data]);

  const isZero = !!summary.data && Number(summary.data.total.gross_cents) === 0 && summary.data.total.trips === 0;
  // First run: nothing earned ever. Asked only when the period is empty (one extra call).
  const firstRun = useApiQuery('earnings-first-run', () => fetchEntries({ limit: 1 }), { enabled: isZero });
  const negative = !!rightNow && Number(rightNow.unpaid_balance_cents) < 0;
  const clawback = useApiQuery('earnings-newest-clawback', () => fetchEntries({ type: ['CLAWBACK'], limit: 1 }), { enabled: negative });

  // Back online: re-fetch everything once; the saved numbers stay until the new ones arrive.
  const [reconnecting, setReconnecting] = React.useState(false);
  const wasOnline = React.useRef(online);
  React.useEffect(() => {
    if (!wasOnline.current && online) {
      setReconnecting(true);
      void Promise.all([summary.refetch(), payouts.refetch(), connect.refetch()]).finally(() => setReconnecting(false));
    }
    wasOnline.current = online;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const goAccount = () => nav.switchTab('account');
  const goHome = () => nav.switchTab('home');

  if (summary.status === 'error' && isPaused(summary.error)) {
    return (
      <Frame title="Earnings" testID="earnings">
        <PausedBlock copy={PAUSED.summary} onAccount={goAccount} testID="earnings-paused" />
      </Frame>
    );
  }

  if (summary.status === 'loading' && !rightNow) {
    return (
      <Frame title="Earnings" testID="earnings">
        <LiveStatus text={SUMMARY.loading} />
        <SectionTitle>Right now</SectionTitle>
        {/* ds-request(native): Skeleton raised-surface variant — EA Earnings-loading (skeleton is invisible on surface-raised in dark) */}
        <Skeleton variant="rect" height={48} testID="earnings-skeleton-next" />
        <Skeleton variant="rect" height={48} />
        <PayoutsRow onPress={() => nav.push('earningsPayouts')} />
        <Skeleton variant="text" lines={3} />
      </Frame>
    );
  }

  if (firstRun.data && firstRun.data.data.length === 0) {
    return (
      <Frame title="Earnings" testID="earnings">
        {/* ds-request(native): EmptyState rider variant (action pinned in the bottom third) — EA Earnings-first-run */}
        <EmptyState
          title={SUMMARY.firstRun.title}
          description={`${SUMMARY.firstRun.body}\n\n${SUMMARY.firstRun.more}`}
          primaryAction={{ label: SUMMARY.firstRun.action, onPress: goHome }}
          testID="earnings-first-run"
        />
      </Frame>
    );
  }

  const alerts = payoutAlerts(payouts.data?.data, connect.data, rightNow);
  const next = nextPayout(payouts.data?.data, connect.data, rightNow);
  const slotFailed = payouts.status === 'error' || connect.status === 'error';
  const retrySlot = () => {
    void payouts.refetch();
    void connect.refetch();
  };

  const choosePeriod = (key: string) => {
    const period = key as EarningsPeriod;
    if (sel.back && period !== 'DAY') {
      // From a picked day, Week / Month open the period that contains that day.
      setSel({ period, offset: offsetContaining(period, periodStart('DAY', sel.offset)), back: null });
    } else setSel({ period, offset: 0, back: null });
  };
  const pickDay = (bucket: EarningsBucket) => {
    const day = new Date(bucket.bucket_start);
    setSel({ period: 'DAY', offset: offsetContaining('DAY', day), back: { period: sel.period, offset: sel.offset, label: periodCrumb(sel.period, sel.offset) } });
  };

  return (
    <Frame title="Earnings" testID="earnings">
      <AlertStack alerts={alerts} loading={payouts.status === 'loading' || connect.status === 'loading'} slotFailed={slotFailed} onSeePayout={(payoutId) => nav.push('earningsPayout', { payoutId, from: 'earnings' })} />
      {!online && summary.data ? <SavedCopyBanner copy={SUMMARY.offline(savedAtLabel(summary.updatedAt))} testID="earnings-offline" /> : null}
      {online && reconnecting ? (
        // ds-request(native): InlineAlert (info, persistent) — EA Earnings-back-online
        <Banner variant="info" title={SUMMARY.backOnline.title} description={SUMMARY.backOnline.body} testID="earnings-back-online" />
      ) : null}

      {summary.status === 'error' ? (
        <>
          <SummaryError error={summary.error} busy={summary.refreshing} onRetry={() => void summary.refetch()} />
          <Card variant="outlined" testID="earnings-payouts-card">
            <PayoutsRow onPress={() => nav.push('earningsPayouts')} />
          </Card>
          <HistoryCard onActivity={() => nav.push('earningsActivity', undefined)} onDeliveries={() => nav.push('deliveries')} />
        </>
      ) : (
        <>
          <SectionTitle>Right now</SectionTitle>
          <Card variant="outlined" testID="earnings-right-now">
            <View style={{ gap: space['4'] }}>
              <NextPayoutBlock
                next={next}
                status={payouts.status}
                // Connect status failed but payouts loaded: keep the amount, and still offer the
                // one Try again the banner slot points at ("Try again under Next payout").
                connectFailed={connect.status === 'error'}
                onRetry={retrySlot}
                negativeCause={clawback.data?.data[0] ?? null}
                onSeeCorrection={(entry) => nav.push('earningsLine', { entry, from: 'earnings' })}
                unpaid={rightNow ? rightNow.unpaid_balance_cents : null}
                variant="earnings"
              />
              <PayoutsRow onPress={() => nav.push('earningsPayouts')} />
            </View>
          </Card>

          {/* ds-request(native): SegmentedControl (56px field size) — EA Earnings-* period control; Tabs pill stands in */}
          <Tabs tabs={PERIOD_TABS} value={sel.period} onChange={choosePeriod} variant="pill" accessibilityLabel="Earnings period" testID="earnings-period" />
          {sel.back ? (
            <Button variant="tertiary" size="xl" fullWidth onPress={() => setSel({ period: sel.back!.period, offset: sel.back!.offset, back: null })} testID="earnings-back-to-period">
              {`Back to ${sel.back.label}`}
            </Button>
          ) : null}
          <PeriodHeading sel={sel} onPrev={() => setSel({ ...sel, offset: sel.offset - 1 })} onNext={() => setSel({ ...sel, offset: Math.min(0, sel.offset + 1) })} />

          {summary.status === 'loading' || !summary.data ? (
            <View style={{ gap: space['3'] }} testID="earnings-period-loading">
              <LiveStatus text={loadingPeriodLine(sel.period, sel.offset)} />
              <Skeleton variant="rect" height={48} />
              <Skeleton variant="text" lines={3} />
            </View>
          ) : (
            <PeriodFigures summary={summary.data} sel={sel} onHome={goHome} />
          )}

          <HistoryCard onActivity={() => nav.push('earningsActivity', undefined)} onDeliveries={() => nav.push('deliveries')} />

          {summary.data ? <MadeOf bucket={summary.data.total} /> : null}
          {summary.data && sel.period !== 'DAY' ? <ByDay key={`${sel.period}-${sel.offset}`} summary={summary.data} period={sel.period} current={sel.offset === 0} onPick={pickDay} /> : null}
        </>
      )}
    </Frame>
  );
}

function SummaryError({ error, busy, onRetry }: { error: RiderError | null; busy: boolean; onRetry: () => void }): React.ReactElement {
  const limited = isRateLimited(error);
  const waiting = useCooldown(error);
  const copy = limited ? SUMMARY.rateLimited : SUMMARY.error;
  return (
    <View style={{ gap: space['3'] }} testID={limited ? 'earnings-rate-limited' : 'earnings-error'}>
      {/* ds-request(native): ErrorState rider variant (copy keyed on error.code, action in the bottom third) — EA Earnings-error / Earnings-rate-limited */}
      <ErrorState variant="inline" title={copy.title} description={copy.body} />
      {limited ? <Body>{RATE_LIMITED_WAIT}</Body> : null}
      <Button variant="primary" size="xl" fullWidth disabled={waiting} loading={busy} onPress={onRetry} testID="earnings-retry">
        {copy.action}
      </Button>
    </View>
  );
}

function PeriodHeading({ sel, onPrev, onNext }: { sel: Selection; onPrev: () => void; onNext: () => void }): React.ReactElement {
  const theme = useTheme();
  const unit = unitWord(sel.period);
  const current = sel.offset === 0;
  const range = sel.back ? '' : periodRange(sel.period, sel.offset);
  return (
    <View style={{ gap: space['3'] }}>
      <View style={{ gap: space['1'] }}>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[typeStyle(theme, 'heading.xl'), { color: theme.color.text.primary }]} testID="earnings-period-title">
          {sel.back ? dayLabel(periodStart('DAY', sel.offset)) : periodTitle(sel.period, sel.offset)}
        </Text>
        {range ? <Text style={[typeStyle(theme, 'body.lg'), { color: theme.color.text.secondary }]}>{range}</Text> : null}
      </View>
      {/* ds-request(native): Icon chevron-right / IconButton field size 56 — EA Earnings-focus-stepper; labelled Buttons stand in */}
      <View style={{ flexDirection: 'row', gap: space['3'] }}>
        <View style={{ flex: 1 }}>
          <Button variant="tertiary" size="xl" fullWidth onPress={onPrev} testID="earnings-prev">
            {`Previous ${unit}`}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            variant="tertiary"
            size="xl"
            fullWidth
            disabled={current}
            onPress={onNext}
            accessibilityLabel={current ? `Next ${unit}, not available: this is the current ${unit}` : `Next ${unit}`}
            testID="earnings-next"
          >
            {`Next ${unit}`}
          </Button>
        </View>
      </View>
    </View>
  );
}

function PeriodFigures({ summary, sel, onHome }: { summary: EarningsSummary; sel: Selection; onHome: () => void }): React.ReactElement {
  const theme = useTheme();
  const t = summary.total;
  const zero = Number(t.gross_cents) === 0 && t.trips === 0;
  const perHour = t.effective_cents_per_hour;
  return (
    <View style={{ gap: space['4'] }} testID="earnings-period-figures">
      {/* ds-request(native): Price display-lg (36) — EA Earnings-* gross; xl stands in */}
      <Price cents={t.gross_cents} size="xl" testID="earnings-gross" />
      {/* ds-request(native): StatCard — EA Earnings-* trips · online · distance (owner-approved, #195) */}
      <View style={{ flexDirection: 'row', gap: space['3'] }}>
        <Stat value={`${t.trips}`} label={t.trips === 1 ? 'trip' : 'trips'} />
        <Stat value={hoursLabel(Number(t.online_seconds ?? 0))} label="online" />
        <Stat value={kmLabel(Number(t.distance_m ?? 0))} label="distance" />
      </View>
      {perHour != null && !zero ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[typeStyle(theme, 'body.lg'), { color: theme.color.text.primary }]}>Per online hour</Text>
          <Price cents={perHour} size="md" testID="earnings-per-hour" />
        </View>
      ) : null}
      {zero ? (
        <View style={{ gap: space['3'] }} testID="earnings-zero">
          <Body>{zeroLine(sel.period, sel.offset)}</Body>
          {sel.offset === 0 && !sel.back ? (
            <Button variant="tertiary" size="xl" fullWidth onPress={onHome}>
              Go to Home
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Card variant="outlined">
        <Text style={[typeStyle(theme, 'heading.md'), { color: theme.color.text.primary }]}>{value}</Text>
        <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{label}</Text>
      </Card>
    </View>
  );
}

function HistoryCard({ onActivity, onDeliveries }: { onActivity: () => void; onDeliveries: () => void }): React.ReactElement {
  return (
    <View style={{ gap: space['3'] }}>
      <SectionTitle>History</SectionTitle>
      {/* ds-request(native): ListRow 72 (whole row one control) — EA Earnings-* History; Card + Text stands in */}
      <LinkRow title="Earnings activity" sub="Every line, newest first" onPress={onActivity} testID="earnings-open-activity" />
      <LinkRow title="Deliveries" sub="Find a past job, newest first" onPress={onDeliveries} testID="earnings-open-deliveries" />
    </View>
  );
}

function MadeOf({ bucket }: { bucket: EarningsBucket }): React.ReactElement {
  const theme = useTheme();
  // One row per field the response has; a returned 0 shows $0.00, an absent field shows nothing.
  const rows: { label: string; cents: Cents | undefined; sub?: string; sign?: 'always' }[] = [
    { label: 'Deliveries', cents: bucket.delivery_cents },
    { label: 'Tips', cents: bucket.tip_cents },
    { label: 'Bonuses', cents: bucket.bonus_cents },
    { label: 'Adjustments and corrections', cents: bucket.adjustment_cents, sub: 'Added and taken off, together', sign: 'always' },
  ];
  return (
    <View style={{ gap: space['3'] }} testID="earnings-made-of">
      <SectionTitle>What it's made of</SectionTitle>
      {/* ds-request(native): KeyValueList — EA Earnings-* "What it's made of" (owner-approved, #195) */}
      <Card variant="outlined">
        <View style={{ gap: space['3'] }}>
          {rows.map((r) =>
            r.cents == null ? null : (
              <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space['3'] }}>
                <View style={{ flex: 1 }}>
                  <Text style={[typeStyle(theme, 'body.lg'), { color: theme.color.text.primary }]}>{r.label}</Text>
                  {r.sub ? <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{r.sub}</Text> : null}
                </View>
                <Price cents={r.cents} size="md" sign={r.sign ?? 'auto'} testID={`earnings-made-of-${r.label}`} />
              </View>
            ),
          )}
        </View>
      </Card>
      <Body secondary>{SUMMARY.footnote}</Body>
    </View>
  );
}

function ByDay({
  summary,
  period,
  current,
  onPick,
}: {
  summary: EarningsSummary;
  period: EarningsPeriod;
  current: boolean;
  onPick: (b: EarningsBucket) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const allZero = summary.buckets.every((b) => Number(b.gross_cents) === 0 && b.trips === 0);
  const collapsed = allZero && summary.buckets.length > 1 && !expanded;
  return (
    <View style={{ gap: space['3'] }} testID="earnings-by-day">
      <SectionTitle>By day</SectionTitle>
      {collapsed ? (
        <>
          <Body>{`No earnings on any day ${current ? 'this' : 'that'} ${unitWord(period)}.`}</Body>
          <Button variant="tertiary" size="xl" fullWidth onPress={() => setExpanded(true)} testID="earnings-show-days">
            Show each day
          </Button>
        </>
      ) : (
        summary.buckets.map((b, i) => (
          <MoneyRow
            key={`${b.bucket_start}-${i}`}
            title={dayLabel(b.bucket_start)}
            sub={tripsWord(b.trips)}
            cents={b.gross_cents}
            onPress={() => onPick(b)}
            testID={`earnings-day-${i}`}
          />
        ))
      )}
    </View>
  );
}

/* =========================================================================== R38 Payouts */

export function PayoutsScreen(): React.ReactElement {
  const nav = useNav();
  const online = useOnline();
  const list = usePagedList<Payout>('earnings-payouts-list', React.useCallback((cursor?: string) => fetchPayouts(cursor ? { cursor } : {}), []));
  const summary = useApiQuery('earnings-payouts-summary', () => fetchSummary('WEEK'));
  const connect = useApiQuery('earnings-connect-status', fetchConnectStatus);
  const negative = !!summary.data && Number(summary.data.unpaid_balance_cents) < 0;
  const clawback = useApiQuery('earnings-newest-clawback', () => fetchEntries({ type: ['CLAWBACK'], limit: 1 }), { enabled: negative });
  const back = { onPress: () => nav.pop(), previousTitle: 'Earnings' };
  const first = list.first;

  if (first.status === 'loading') {
    return (
      <Frame title="Payouts" back={back} testID="payouts">
        <LiveStatus text={PAYOUTS.loading} />
        <Skeleton variant="rect" height={96} testID="payouts-skeleton" />
        <Skeleton variant="text" lines={4} />
      </Frame>
    );
  }

  if (first.status === 'error') {
    const e = first.error;
    if (isPaused(e)) {
      return (
        <Frame title="Payouts" back={back} testID="payouts">
          <PausedBlock copy={PAUSED.payouts} onAccount={() => nav.switchTab('account')} testID="payouts-paused" />
        </Frame>
      );
    }
    const copy = isRateLimited(e) ? PAYOUTS.rateLimited : e?.kind === 'offline' ? PAYOUTS.offline : PAYOUTS.error;
    return (
      <Frame title="Payouts" back={back} testID="payouts">
        <ScreenError copy={copy} error={e} busy={first.refreshing} onRetry={() => void first.refetch()} testID="payouts-error" />
      </Frame>
    );
  }

  const rows = list.rows;
  if (rows.length === 0 && summary.status === 'loading') {
    // Which empty state applies depends on the unpaid balance: wait for it rather than flash
    // "nothing earned" and then swap to "first payout".
    return (
      <Frame title="Payouts" back={back} testID="payouts">
        <LiveStatus text={PAYOUTS.loading} />
        <Skeleton variant="rect" height={96} testID="payouts-skeleton" />
      </Frame>
    );
  }
  if (rows.length === 0) {
    const unpaid = summary.data ? Number(summary.data.unpaid_balance_cents) : 0;
    if (summary.data && unpaid > 0) {
      const date = summary.data.next_payout_at ? dayLabel(summary.data.next_payout_at) : null;
      // The rider has earned: the summary card stays (unpaid balance, when the first payout goes).
      const first: NextPayout = { ...nextPayout([], connect.data, summary.data), noNext: PAYOUTS.firstPayout.noNext(date), pendingLine: true };
      return (
        <Frame title="Payouts" back={back} testID="payouts">
          <Card variant="outlined" testID="payouts-summary">
            <NextPayoutBlock
              next={first}
              status="success"
              onRetry={() => void summary.refetch()}
              negativeCause={null}
              onSeeCorrection={() => undefined}
              unpaid={summary.data.unpaid_balance_cents}
              variant="payouts"
            />
          </Card>
          <EmptyState
            title={PAYOUTS.firstPayout.title}
            description={`${PAYOUTS.firstPayout.body(date)}\n\n${PAYOUTS.firstPayout.more}`}
            primaryAction={{ label: PAYOUTS.firstPayout.action, onPress: () => nav.push('earningsActivity', { backTitle: 'Payouts' }) }}
            testID="payouts-first-payout"
          />
        </Frame>
      );
    }
    return (
      <Frame title="Payouts" back={back} testID="payouts">
        <EmptyState
          title={PAYOUTS.empty.title}
          description={`${PAYOUTS.empty.body}\n\n${PAYOUTS.empty.more}`}
          primaryAction={{ label: PAYOUTS.empty.action, onPress: () => nav.switchTab('home') }}
          testID="payouts-empty"
        />
      </Frame>
    );
  }

  const firstPage = first.data?.data;
  const alerts = payoutAlerts(firstPage, connect.data, summary.data);
  const next = nextPayout(firstPage, connect.data, summary.data);

  return (
    <Frame title="Payouts" back={back} testID="payouts">
      <AlertStack alerts={alerts} loading={connect.status === 'loading'} slotFailed={connect.status === 'error'} onSeePayout={(payoutId) => nav.push('earningsPayout', { payoutId, from: 'payouts' })} />
      {!online ? <SavedCopyBanner copy={PAYOUTS.savedOffline(savedAtLabel(first.updatedAt))} testID="payouts-offline" /> : null}
      {summary.data ? (
        <Card variant="outlined" testID="payouts-summary">
          <NextPayoutBlock
            next={next}
            status="success"
            onRetry={() => void first.refetch()}
            negativeCause={clawback.data?.data[0] ?? null}
            onSeeCorrection={(entry) => nav.push('earningsLine', { entry, from: 'payouts' })}
            unpaid={summary.data.unpaid_balance_cents}
            variant="payouts"
          />
        </Card>
      ) : null}

      <SectionTitle>{PAYOUTS.heading}</SectionTitle>
      {/* ds-request(native): ListRow (link, money + status) and StatusLabel (Icon + 17px word) — EA Payouts-*; Card + Text stand in */}
      {rows.map((p) => (
        <MoneyRow
          key={p.id}
          title={payoutPeriod(p)}
          sub={payoutRowSub(p)}
          cents={p.amount_cents}
          status={PAYOUT_STATE_WORD[p.state]}
          warn={p.state === 'FAILED' || p.state === 'HELD'}
          onPress={() => nav.push('earningsPayout', { payoutId: p.id, from: 'payouts' })}
          testID={`payouts-row-${p.state}`}
        />
      ))}
      <PagingFooter
        hasMore={list.hasMore}
        online={online}
        loading={list.loadingMore}
        error={list.moreError}
        onMore={() => void list.loadMore()}
        copy={{ more: PAYOUTS.more, loading: PAYOUTS.loadingMore, offline: PAYOUTS.moreOffline, error: PAYOUTS.moreError, end: PAYOUTS.end }}
        testID="payouts"
      />
    </Frame>
  );
}

/* =========================================================================== shared helpers */

function NextPayoutBlock({
  next,
  status,
  connectFailed = false,
  onRetry,
  negativeCause,
  onSeeCorrection,
  unpaid,
  variant,
}: {
  next: NextPayout;
  status: QueryResult<unknown>['status'];
  connectFailed?: boolean;
  onRetry: () => void;
  negativeCause: EarningEntry | null;
  onSeeCorrection: (e: EarningEntry) => void;
  unpaid: Cents | null;
  variant: 'earnings' | 'payouts';
}): React.ReactElement {
  const theme = useTheme();
  const label = (s: string) => <Text style={[typeStyle(theme, 'label.lg'), { color: theme.color.text.secondary }]}>{s}</Text>;
  let nextBlock: React.ReactNode;
  if (status === 'loading') {
    nextBlock = <Skeleton variant="rect" height={48} testID="earnings-next-loading" />;
  } else if (status === 'error') {
    nextBlock = (
      <View style={{ gap: space['2'] }} testID="earnings-next-failed">
        {label('Next payout')}
        {next.date ? <Body>{next.date}</Body> : null}
        <Body>{SUMMARY.nextFailed}</Body>
        <Button variant="primary" size="xl" fullWidth onPress={onRetry}>
          Try again
        </Button>
      </View>
    );
  } else if (next.amount != null) {
    nextBlock = (
      <View style={{ gap: space['1'] }} testID="earnings-next">
        {variant === 'payouts' ? label(next.date ? `Next payout, ${next.date}` : 'Next payout') : label('Next payout')}
        {variant === 'earnings' && next.date ? <Body>{next.date}</Body> : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space['2'] }}>
          <Price cents={next.amount} size="lg" testID="earnings-next-amount" />
          {next.soFar ? <Body secondary>{NEXT.soFar}</Body> : null}
        </View>
        {next.note ? <Body>{next.note}</Body> : null}
        {connectFailed ? (
          <Button variant="primary" size="xl" fullWidth onPress={onRetry} testID="earnings-next-retry">
            Try again
          </Button>
        ) : null}
      </View>
    );
  } else {
    nextBlock = (
      <View style={{ gap: space['1'] }} testID="earnings-no-next">
        {variant === 'earnings' ? label('Next payout') : null}
        <Body>{next.noNext}</Body>
        {connectFailed ? (
          <Button variant="primary" size="xl" fullWidth onPress={onRetry} testID="earnings-next-retry">
            Try again
          </Button>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ gap: space['4'] }}>
      {nextBlock}
      {unpaid != null ? (
        <View style={{ gap: space['1'] }} testID="earnings-unpaid">
          {label('Unpaid balance')}
          <Price cents={unpaid} size="lg" testID="earnings-unpaid-amount" />
          {next.pendingLine ? <Body secondary>{variant === 'payouts' ? PAYOUTS.pendingLine : SUMMARY.pendingLine}</Body> : null}
        </View>
      ) : null}
      {next.held ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space['2'] }} testID="earnings-held-extra">
          <Price cents={next.held.amount} size="md" />
          <Body>{next.held.text}</Body>
        </View>
      ) : null}
      {next.negative ? (
        <View style={{ gap: space['2'] }} testID="earnings-negative">
          {negativeCause ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space['2'] }}>
              <Body>A</Body>
              <Price cents={negativeCause.gross_cents} size="md" />
              <Body>{NEXT.negativeCause(dayLabel(negativeCause.earned_at))}</Body>
            </View>
          ) : null}
          <Body>{NEXT.neverBank}</Body>
          {negativeCause ? (
            <Button variant="primary" size="xl" fullWidth onPress={() => onSeeCorrection(negativeCause)} testID="earnings-see-correction">
              {NEXT.seeCorrection}
            </Button>
          ) : null}
        </View>
      ) : null}
      {variant === 'payouts' ? <Body secondary>{PAYOUTS.schedule}</Body> : null}
    </View>
  );
}

function PayoutsRow({ onPress }: { onPress: () => void }): React.ReactElement {
  return <LinkRow title="Payouts" sub={SUMMARY.schedule} onPress={onPress} testID="earnings-open-payouts" />;
}

function AlertStack({
  alerts,
  loading,
  slotFailed,
  onSeePayout,
}: {
  alerts: PayoutAlert[];
  loading: boolean;
  slotFailed: boolean;
  onSeePayout: (payoutId: string) => void;
}): React.ReactElement | null {
  const [fixError, setFixError] = React.useState<RiderError | null>(null);
  const [opening, setOpening] = React.useState(false);
  // Two taps in one frame must not mint two Stripe links and open two browsers.
  const openingRef = React.useRef(false);
  const fix = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setFixError(null);
    setOpening(true);
    try {
      await Linking.openURL(await fetchPayoutLink());
    } catch (e) {
      setFixError(toRiderError(e));
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  if (loading) return <Skeleton variant="rect" height={72} testID="earnings-banner-loading" />;
  if (slotFailed && alerts.length === 0) {
    return <Banner variant="info" title={SUMMARY.slotError.title} description={SUMMARY.slotError.body} testID="earnings-banner-slot-error" />;
  }
  if (alerts.length === 0) return null;
  return (
    <View style={{ gap: space['4'] }}>
      {alerts.map((a) => (
        <View key={a.key} style={{ gap: space['2'] }} testID={`earnings-banner-${a.key}`}>
          {/* ds-request(native): InlineAlert (warning / info, persistent, field-size actions) — EA Earnings-payout-held / -failed / -account-* */}
          <Banner
            variant={a.tone}
            title={a.title}
            description={[...a.lines, ...(a.details ? [`${a.detailsLabel ?? BANNERS.reasonLabel} ${a.details}`] : [])].join('\n')}
          />
          {a.fix ? (
            <Button variant="primary" size="xl" fullWidth loading={opening} onPress={() => void fix()} testID="earnings-fix">
              {BANNERS.fix}
            </Button>
          ) : null}
          {a.payoutId ? (
            <Button variant="tertiary" size="xl" fullWidth onPress={() => onSeePayout(a.payoutId!)} testID="earnings-see-payout">
              {BANNERS.seePayout}
            </Button>
          ) : null}
        </View>
      ))}
      {fixError ? <Banner variant="neutral" title={fixError.title} description={fixError.message} testID="earnings-fix-error" /> : null}
    </View>
  );
}

function SavedCopyBanner({ copy, testID }: { copy: { title: string; body: string }; testID: string }): React.ReactElement {
  // ds-request(native): InlineAlert (info, persistent) — EA Earnings-offline / Payouts-offline-saved
  return <Banner variant="info" title={copy.title} description={copy.body} testID={testID} />;
}

function PausedBlock({ copy, onAccount, testID }: { copy: StateCopy; onAccount: () => void; testID: string }): React.ReactElement {
  return (
    <View style={{ gap: space['4'] }} testID={testID}>
      {/* ds-request(native): ErrorState rider variant (lock icon, action in the bottom third) — EA Earnings-not-active / Payouts-not-active */}
      <ErrorState variant="inline" title={copy.title} description={copy.body} />
      <Button variant="primary" size="xl" fullWidth onPress={onAccount} testID="earnings-go-account">
        {copy.action ?? 'Go to Account'}
      </Button>
    </View>
  );
}

function ScreenError({
  copy,
  error,
  busy,
  onRetry,
  testID,
}: {
  copy: StateCopy;
  error: RiderError | null;
  busy: boolean;
  onRetry: () => void;
  testID: string;
}): React.ReactElement {
  const rateLimited = isRateLimited(error);
  const waiting = useCooldown(error);
  return (
    <View style={{ gap: space['4'] }} testID={testID}>
      <ErrorState variant="inline" title={copy.title} description={copy.body} />
      {rateLimited ? <Body>{RATE_LIMITED_WAIT}</Body> : null}
      <Button variant="primary" size="xl" fullWidth disabled={waiting} loading={busy} onPress={onRetry} testID={`${testID}-retry`}>
        {copy.action ?? 'Try again'}
      </Button>
    </View>
  );
}

function PagingFooter({
  hasMore,
  online,
  loading,
  error,
  onMore,
  copy,
  testID,
}: {
  hasMore: boolean;
  online: boolean;
  loading: boolean;
  error: RiderError | null;
  onMore: () => void;
  copy: { more: string; loading: string; offline: string; error: StateCopy; end: string };
  testID: string;
}): React.ReactElement {
  if (!hasMore) return <Body secondary>{copy.end}</Body>;
  if (!online) return <Body secondary>{copy.offline}</Body>;
  return (
    <View style={{ gap: space['3'] }}>
      {error ? (
        <>
          <Banner variant="neutral" title={copy.error.title} description={copy.error.body} testID={`${testID}-more-error`} />
          <Button variant="tertiary" size="xl" fullWidth onPress={onMore} testID={`${testID}-more-retry`}>
            {copy.error.action ?? 'Try again'}
          </Button>
        </>
      ) : (
        <Button variant="tertiary" size="xl" fullWidth loading={loading} onPress={onMore} accessibilityLabel={loading ? copy.loading : copy.more} testID={`${testID}-more`}>
          {copy.more}
        </Button>
      )}
      {loading ? <Skeleton variant="text" lines={2} /> : null}
    </View>
  );
}

function LinkRow({ title, sub, onPress, testID }: { title: string; sub: string; onPress: () => void; testID: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <Card variant="interactive" onPress={onPress} accessibilityLabel={`${title}. ${sub}`} style={{ minHeight: 72 }} testID={testID}>
      <Text style={[typeStyle(theme, 'heading.sm'), { color: theme.color.text.primary }]}>{title}</Text>
      <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{sub}</Text>
    </Card>
  );
}

function MoneyRow({
  title,
  sub,
  cents,
  status,
  warn = false,
  onPress,
  testID,
}: {
  title: string;
  sub: string;
  cents: Cents;
  status?: string;
  warn?: boolean;
  onPress: () => void;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <Card variant="interactive" onPress={onPress} accessibilityLabel={[title, sub, status].filter(Boolean).join('. ')} style={{ minHeight: 72 }} testID={testID}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space['3'] }}>
        <View style={{ flex: 1 }}>
          <Text style={[typeStyle(theme, 'heading.sm'), { color: theme.color.text.primary }]}>{title}</Text>
          <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{sub}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Price cents={cents} size="md" />
          {status ? (
            <Text style={[typeStyle(theme, 'label.lg'), { color: warn ? theme.color.text.primary : theme.color.text.secondary }]}>{status}</Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

function Frame({
  title,
  back,
  testID,
  children,
}: {
  title: string;
  back?: { onPress: () => void; previousTitle: string };
  testID: string;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID={testID}>
      {/* ds-request(native): AppBar tone="field" (56px back target) — EA boards */}
      <AppBar title={title} back={back} />
      <ScrollView contentContainerStyle={{ padding: space['5'], gap: space['5'] }}>{children}</ScrollView>
    </View>
  );
}

function SectionTitle({ children }: { children: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={[typeStyle(theme, 'heading.md'), { color: theme.color.text.primary }]}>
      {children}
    </Text>
  );
}

function Body({ children, secondary = false }: { children: React.ReactNode; secondary?: boolean }): React.ReactElement {
  const theme = useTheme();
  return <Text style={[typeStyle(theme, 'body.lg'), { color: secondary ? theme.color.text.secondary : theme.color.text.primary }]}>{children}</Text>;
}

/** A polite status line for screen readers ("Loading your earnings"); not drawn on the boards. */
function LiveStatus({ text }: { text: string }): React.ReactElement {
  return (
    <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', opacity: 0 }}>
      {text}
    </Text>
  );
}

