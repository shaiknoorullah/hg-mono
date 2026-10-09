/**
 * R36 Earnings activity (EA/Activity), R37 Earnings line (EA/EntryDetail) and R39 Payout
 * (EA/PayoutDetail, wording from EA/PayoutStates).
 *
 * The ledger is append-only and every amount is a stored `*_cents` field: rows show
 * `gross_cents`, a line shows its own `tip_cents` and `gross_cents`, a payout shows its own
 * `amount_cents` ("exactly these lines, added up by HalalGoes"). The phone adds nothing up.
 *
 * Not built (Needs API): the Delivery fee row (`delivery_fee_cents`, #147/gap 46), the links
 * between a correction and the line it corrects (#147), "Question about this line?" (support
 * ticket), GET one entry for push deep links (`Entry-deeplink-*`), and the payout Alternatives
 * (`Payout-failed-cause`, `-failed-transient`, `-failed-twice`, `-held-cause`, `-held-review`).
 */
import * as React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import type { Cents } from '@hg/api-client';

import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Price, Skeleton, space, typeStyle, useTheme } from '../ds';
import { useOnline } from '../data/connectivity';
import { toRiderError, type RiderError } from '../data/errors';
import { useApiQuery } from '../data/query';
import { formatTime } from '../format/time';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import {
  fetchConnectStatus,
  fetchEntries,
  fetchPayout,
  fetchPayoutLink,
  isPaused,
  isRateLimited,
  needsFix,
  useCooldown,
  usePagedList,
  type EarningEntry,
  type PayoutDetail,
} from './api';
import { ACTIVITY, LINE, PAUSED, PAYOUT, RATE_LIMITED_WAIT, type StateCopy } from './copy';
import {
  ENTRY_TITLE,
  ENTRY_TYPE_WORD,
  PAYOUT_STATE_WORD,
  dayLabel,
  dayTimeLabel,
  entryStatusWord,
  groupByDay,
  longDayLabel,
  payoutPeriod,
  payoutPeriodLong,
  savedAtLabel,
} from './format';
import type { LineFrom } from './routes';

/* =========================================================================== R36 Activity */

export function ActivityScreen(): React.ReactElement {
  const nav = useNav();
  const online = useOnline();
  const list = usePagedList<EarningEntry>(
    'earnings-activity',
    React.useCallback((cursor?: string) => fetchEntries(cursor ? { cursor } : {}), []),
  );
  const first = list.first;
  const back = { onPress: () => nav.pop(), previousTitle: 'Earnings' };

  if (first.status === 'loading') {
    return (
      <Frame title="Earnings activity" back={back} testID="activity">
        <LiveStatus text={ACTIVITY.loading} />
        {/* ds-request(native): Skeleton ListRow 72 — EA Activity-loading */}
        <Skeleton variant="text" lines={6} testID="activity-skeleton" />
      </Frame>
    );
  }
  if (first.status === 'error') {
    const e = first.error;
    if (isPaused(e)) {
      return (
        <Frame title="Earnings activity" back={back} testID="activity">
          <PausedBlock copy={PAUSED.activity} onAccount={() => nav.switchTab('account')} testID="activity-paused" />
        </Frame>
      );
    }
    return (
      <Frame title="Earnings activity" back={back} testID="activity">
        <ScreenError copy={isRateLimited(e) ? ACTIVITY.rateLimited : ACTIVITY.error} rateLimited={isRateLimited(e)} onRetry={() => void first.refetch()} testID="activity-error" />
      </Frame>
    );
  }
  if (list.rows.length === 0) {
    return (
      <Frame title="Earnings activity" back={back} testID="activity">
        {/* ds-request(native): EmptyState rider variant (action in the bottom third) — EA Activity-empty */}
        <EmptyState
          title={ACTIVITY.empty.title}
          description={ACTIVITY.empty.body}
          primaryAction={{ label: ACTIVITY.empty.action, onPress: () => nav.switchTab('home') }}
          testID="activity-empty"
        />
      </Frame>
    );
  }

  const groups = groupByDay(list.rows);
  const firstPendingGroup = groups.findIndex((g) => g.rows.some((r) => r.status === 'PENDING'));
  return (
    <Frame title="Earnings activity" back={back} testID="activity">
      {!online ? (
        // ds-request(native): InlineAlert (info, persistent) — EA Activity-offline
        <Banner variant="info" title={ACTIVITY.offline(savedAtLabel(first.updatedAt)).title} description={ACTIVITY.offline(savedAtLabel(first.updatedAt)).body} testID="activity-offline" />
      ) : null}
      {groups.map((g, gi) => (
        <View key={`${g.day}-${gi}`} style={{ gap: space['3'] }}>
          {gi === firstPendingGroup ? (
            // ds-request(native): InlineAlert (neutral) — EA Activity pending explainer
            <Banner variant="neutral" title={ACTIVITY.pending} testID="activity-pending-explainer" />
          ) : null}
          <SectionTitle>{g.day}</SectionTitle>
          {g.rows.map((r) => (
            <EntryRow key={r.id} entry={r} onPress={() => nav.push('earningsLine', { entry: r, from: 'activity' })} />
          ))}
        </View>
      ))}
      <PagingFooter
        hasMore={list.hasMore}
        online={online}
        loading={list.loadingMore}
        error={list.moreError}
        onMore={() => void list.loadMore()}
        copy={{ more: ACTIVITY.more, loading: ACTIVITY.loadingMore, error: ACTIVITY.moreError, end: ACTIVITY.end }}
        testID="activity"
      />
    </Frame>
  );
}

function EntryRow({ entry, onPress, when = 'time' }: { entry: EarningEntry; onPress: () => void; when?: 'time' | 'day' }): React.ReactElement {
  const theme = useTheme();
  const at = when === 'time' ? formatTime(entry.earned_at) : dayTimeLabel(entry.earned_at);
  const sub = entry.order_code ? `${entry.order_code} · ${at}` : `Not tied to an order · ${at}`;
  const status = entryStatusWord(entry);
  const type = ENTRY_TYPE_WORD[entry.type];
  return (
    // ds-request(native): ListRow 72 + StatusLabel (Icon + 17px word) — EA Activity rows / Payout lines; Card + Text stand in
    <Card variant="interactive" onPress={onPress} accessibilityLabel={`${type}. ${sub}. ${status.word}`} style={{ minHeight: 72 }} testID={`entry-row-${entry.id}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space['3'] }}>
        <View style={{ flex: 1 }}>
          <Text style={[typeStyle(theme, 'heading.sm'), { color: theme.color.text.primary }]}>{type}</Text>
          <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{sub}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Price cents={entry.gross_cents} size="md" sign="always" />
          {when === 'time' ? <Text style={[typeStyle(theme, 'label.lg'), { color: theme.color.text.secondary }]}>{status.word}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

/* =========================================================================== R37 Line */

const LINE_BACK: Record<LineFrom, string> = {
  activity: 'Earnings activity',
  payout: 'Payout',
  earnings: 'Earnings',
  payouts: 'Payouts',
};

function explainLines(e: EarningEntry): string[] {
  const claw = ['This corrects an earlier line. Lines are never edited: a correction is always added as a new line.', 'HalalGoes never takes money from your bank account.'];
  if (e.type === 'CLAWBACK') return claw;
  if (e.status === 'REVERSED') {
    return e.type === 'TIP'
      ? ['This tip was reversed before it was paid, so it isn’t paid out.', 'A correction line offsets it: together they come to $0.00.']
      : ['This line was reversed before it was paid, so it isn’t paid out.', 'A correction line offsets it: together they come to $0.00.'];
  }
  if (e.type === 'TIP') {
    if (e.status === 'PENDING') return ['The customer added this tip after the delivery, so it is a line of its own. The delivery line does not change.', LINE.tipsInFull, LINE.pending];
    if (e.status === 'PAID') return ['The customer added this tip after the delivery. It has been paid out.', LINE.tipsInFull];
    return ['The customer added this tip after the delivery.', LINE.tipsInFull];
  }
  if (e.type === 'BONUS') return ['HalalGoes added this bonus to your earnings.'];
  if (e.type === 'ADJUSTMENT') return ['HalalGoes added this to your earnings.', 'Lines are never edited: an adjustment is always added as a new line.'];
  if (e.status === 'PENDING') return [LINE.pending];
  if (e.type === 'DELIVERY' && e.distance_source === 'FALLBACK') {
    return ['The route service was unavailable during this job, so HalalGoes estimated the distance from a straight line, adjusted for roads.'];
  }
  if (e.status === 'PAID') return ['This line has been paid out.'];
  return ['Available: this line goes into the next Monday payout.'];
}

function noPayoutText(e: EarningEntry): string {
  if (e.type === 'CLAWBACK') return LINE.clawNotYet;
  if (e.status === 'REVERSED') return LINE.reversedNo;
  return LINE.notYet;
}

export function LineScreen({ params }: ScreenProps<'earningsLine'>): React.ReactElement {
  const nav = useNav();
  const theme = useTheme();
  const e = params.entry;
  const status = entryStatusWord(e);
  const verb = e.type === 'DELIVERY' ? 'Earned' : 'Added';
  const signed = e.type === 'ADJUSTMENT' || e.type === 'CLAWBACK' || Number(e.gross_cents) < 0;

  // How it was worked out: pass-through pay (decision R-02). A delivery line shows only Tip and
  // the total until `delivery_fee_cents` exists; never a fee worked out on the phone.
  const lead: { label: string; cents: Cents; sub?: string; sign?: 'always' }[] = [];
  const trail: { label: string; cents: Cents }[] = [];
  if (e.type === 'DELIVERY') {
    if (e.tip_cents != null) {
      if (Number(e.tip_cents) === 0) trail.push({ label: 'Tip', cents: e.tip_cents });
      else lead.push({ label: 'Tip', cents: e.tip_cents, sub: 'Tips reach you in full' });
    }
  } else {
    lead.push({
      label: ENTRY_TYPE_WORD[e.type],
      cents: e.gross_cents,
      ...(e.status === 'REVERSED' ? { sub: 'Reversed' } : {}),
      ...(signed ? { sign: 'always' as const } : {}),
    });
  }

  return (
    <Frame title={ENTRY_TITLE[e.type]} back={{ onPress: () => nav.pop(), previousTitle: LINE_BACK[params.from] }} testID="line">
      <View style={{ gap: space['2'] }}>
        {/* ds-request(native): Price display-lg — EA Entry-* amount */}
        <Price cents={e.gross_cents} size="xl" sign="always" testID="line-amount" />
        <Text style={[typeStyle(theme, 'label.lg'), { color: theme.color.text.secondary }]} testID="line-status">
          {status.word}
        </Text>
        <Body>{`${verb} ${longDayLabel(e.earned_at)} at ${formatTime(e.earned_at)}`}</Body>
      </View>

      {/* ds-request(native): KeyValueList — EA Entry-* Order row */}
      <Card variant="outlined">
        {e.order_code ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body>Order</Body>
            <Text style={[typeStyle(theme, 'mono.md'), { color: theme.color.text.primary }]}>{e.order_code}</Text>
          </View>
        ) : (
          <Body>Not tied to one delivery</Body>
        )}
      </Card>

      {/* ds-request(native): InlineAlert (neutral) — EA Entry-* explainer */}
      <Explainer lines={explainLines(e)} testID="line-explain" />

      <View style={{ gap: space['3'] }}>
        <SectionTitle>How it was worked out</SectionTitle>
        <Card variant="outlined" testID="line-breakdown">
          <View style={{ gap: space['3'] }}>
            {lead.map((p) => (
              <KeyMoney key={p.label} label={p.label} sub={p.sub} cents={p.cents} sign={p.sign} />
            ))}
            <KeyMoney label="Total for this line" cents={e.gross_cents} sign="always" strong testID="line-total" />
            {trail.map((p) => (
              <KeyMoney key={p.label} label={p.label} cents={p.cents} quiet />
            ))}
          </View>
        </Card>
        {e.type === 'DELIVERY' ? <Body secondary>{LINE.footnote}</Body> : null}
        <Body secondary>{LINE.formula(e.formula_version)}</Body>
      </View>

      <View style={{ gap: space['3'] }}>
        <SectionTitle>Payout</SectionTitle>
        {e.payout_id ? (
          <LinePayout payoutId={e.payout_id} onOpen={(payoutId) => nav.push('earningsPayout', { payoutId, from: 'line', backTitle: ENTRY_TITLE[e.type] })} onPayouts={() => nav.push('earningsPayouts')} />
        ) : (
          <Body testID="line-no-payout">{noPayoutText(e)}</Body>
        )}
      </View>
    </Frame>
  );
}

function LinePayout({ payoutId, onOpen, onPayouts }: { payoutId: string; onOpen: (id: string) => void; onPayouts: () => void }): React.ReactElement {
  const payout = useApiQuery(`earnings-payout-${payoutId}`, () => fetchPayout(payoutId));
  if (payout.status === 'loading') {
    return (
      <View testID="line-payout-loading">
        <LiveStatus text={LINE.payoutLoading} />
        <Skeleton variant="rect" height={72} />
      </View>
    );
  }
  if (payout.status === 'error' || !payout.data) {
    const missing = payout.error?.status === 404;
    const copy = missing ? LINE.payoutMissing : LINE.payoutError;
    return (
      <View style={{ gap: space['3'] }} testID={missing ? 'line-payout-missing' : 'line-payout-error'}>
        <Banner variant="neutral" title={copy.title} description={copy.body} />
        <Button variant="tertiary" size="xl" fullWidth onPress={missing ? onPayouts : () => void payout.refetch()}>
          {copy.action}
        </Button>
      </View>
    );
  }
  const p = payout.data;
  const sub =
    p.state === 'DRAFT'
      ? 'Being prepared · goes out on the next Monday payout'
      : p.state === 'PAID' && p.paid_at
        ? `Paid out ${dayLabel(p.paid_at)}`
        : PAYOUT_STATE_WORD[p.state];
  return <LinkRow title={`In payout ${payoutPeriod(p)}`} sub={sub} onPress={() => onOpen(p.id)} testID="line-payout" />;
}

/* =========================================================================== R39 Payout */

const CALM_NOTES: Record<'DRAFT' | 'READY' | 'TRANSFERRING' | 'TRANSFERRED', string[]> = {
  DRAFT: [
    'This payout is being prepared from the lines that are available now.',
    PAYOUT.noDate,
    'Lines still pending are added once they are available. Any still pending on Monday go into a later payout.',
  ],
  READY: ['Scheduled. The period has closed, so no more lines join this payout.', PAYOUT.noDate],
  TRANSFERRING: ['HalalGoes is sending this payout to your Stripe account now.'],
  TRANSFERRED: ['Sent to your Stripe account. Stripe sends it to your bank on its own schedule.'],
};

const SHOWN_LINES = 4;

export function PayoutScreen({ params }: ScreenProps<'earningsPayout'>): React.ReactElement {
  const nav = useNav();
  const theme = useTheme();
  const payout = useApiQuery(`earnings-payout-${params.payoutId}`, () => fetchPayout(params.payoutId));
  const connect = useApiQuery('earnings-connect-status', fetchConnectStatus);
  const [expanded, setExpanded] = React.useState(false);
  const [fixError, setFixError] = React.useState<RiderError | null>(null);
  const [opening, setOpening] = React.useState(false);
  const previousTitle = params.from === 'payouts' ? 'Payouts' : params.from === 'earnings' ? 'Earnings' : (params.backTitle ?? 'Earnings line');
  const back = { onPress: () => nav.pop(), previousTitle };
  const goPayouts = () => (params.from === 'payouts' ? nav.pop() : nav.replace('earningsPayouts'));

  if (payout.status === 'loading') {
    return (
      <Frame title="Payout" back={back} testID="payout">
        <LiveStatus text={PAYOUT.loading} />
        <Skeleton variant="rect" height={96} testID="payout-skeleton" />
        <Skeleton variant="text" lines={4} />
      </Frame>
    );
  }
  if (payout.status === 'error' || !payout.data) {
    const e = payout.error;
    if (isPaused(e)) {
      return (
        <Frame title="Payout" back={back} testID="payout">
          <PausedBlock copy={PAUSED.payout} onAccount={() => nav.switchTab('account')} testID="payout-paused" />
        </Frame>
      );
    }
    if (e?.status === 404) {
      return (
        <Frame title="Payout" back={back} testID="payout">
          <View style={{ gap: space['4'] }} testID="payout-not-found">
            <ErrorState variant="inline" title={PAYOUT.notFound.title} description={PAYOUT.notFound.body} />
            <Button variant="tertiary" size="xl" fullWidth onPress={goPayouts}>
              {PAYOUT.notFound.action}
            </Button>
          </View>
        </Frame>
      );
    }
    const copy = isRateLimited(e) ? PAYOUT.rateLimited : e?.kind === 'offline' ? PAYOUT.offline : PAYOUT.error;
    return (
      <Frame title="Payout" back={back} testID="payout">
        <ScreenError copy={copy} rateLimited={isRateLimited(e)} onRetry={() => void payout.refetch()} testID="payout-error" />
      </Frame>
    );
  }

  const p: PayoutDetail = payout.data;
  const problem = p.state === 'FAILED' || p.state === 'HELD';
  const fix = problem && needsFix(connect.data);
  const count = p.entry_count ?? p.entries.length;
  const openFix = async () => {
    setFixError(null);
    setOpening(true);
    try {
      await Linking.openURL(await fetchPayoutLink());
    } catch (err) {
      setFixError(toRiderError(err));
    } finally {
      setOpening(false);
    }
  };

  const facts: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Period', value: payoutPeriodLong(p) },
    { label: 'Lines', value: p.state === 'DRAFT' ? `${count} so far` : `${count}` },
    ...(problem ? [] : [{ label: 'Paid out', value: p.state === 'PAID' && p.paid_at ? longDayLabel(p.paid_at) : 'Not yet' }]),
    { label: 'Payout reference', value: p.id, mono: true },
  ];

  const footer = fix ? (
    <Button variant="primary" size="xl" fullWidth loading={opening} onPress={() => void openFix()} testID="payout-fix">
      {PAYOUT.fix}
    </Button>
  ) : null;

  return (
    <Frame title="Payout" subtitle={payoutPeriod(p)} back={back} footer={footer} testID="payout">
      <View style={{ gap: space['2'] }}>
        <Body>{payoutPeriodLong(p)}</Body>
        {/* ds-request(native): Price display-lg — EA Payout-* amount */}
        <Price cents={p.amount_cents} size="xl" testID="payout-amount" />
        {/* ds-request(native): StatusLabel (Icon + 17px word; warning icon for FAILED / HELD) — EA/PayoutStates */}
        <Text style={[typeStyle(theme, 'label.lg'), { color: problem ? theme.color.text.primary : theme.color.text.secondary }]} testID="payout-state">
          {PAYOUT_STATE_WORD[p.state]}
        </Text>
      </View>

      {problem ? (
        // ds-request(native): InlineAlert (warning) — EA Payout-failed / Payout-held. Warning, never danger: nothing is lost.
        <Banner variant="warning" title={problemTitle(p)} description={problemLines(p, fix).join('\n')} testID={`payout-problem-${p.state}`} />
      ) : (
        <Explainer lines={calmLines(p)} testID={`payout-calm-${p.state}`} />
      )}
      {fixError ? <Banner variant="neutral" title={fixError.title} description={fixError.message} testID="payout-fix-error" /> : null}

      {/* ds-request(native): KeyValueList (payout reference in mono) — EA Payout-* facts */}
      <Card variant="outlined" testID="payout-facts">
        <View style={{ gap: space['3'] }}>
          {facts.map((f) => (
            <View key={f.label} style={{ gap: space['1'] }}>
              <Text style={[typeStyle(theme, 'label.lg'), { color: theme.color.text.secondary }]}>{f.label}</Text>
              <Text style={[typeStyle(theme, f.mono ? 'mono.md' : 'body.lg'), { color: theme.color.text.primary }]}>{f.value}</Text>
            </View>
          ))}
        </View>
      </Card>

      {p.state === 'FAILED' ? (
        <View style={{ gap: space['3'] }} testID="payout-returned">
          <SectionTitle>{PAYOUT.returned.title(count)}</SectionTitle>
          <Body>{PAYOUT.returned.body}</Body>
          <Button variant="tertiary" size="xl" fullWidth onPress={() => nav.push('earningsActivity')}>
            {PAYOUT.returned.action}
          </Button>
        </View>
      ) : p.entries.length === 0 ? (
        <View style={{ gap: space['3'] }} testID="payout-no-lines">
          <Banner variant="neutral" title={PAYOUT.noLines.title} description={PAYOUT.noLines.body} />
          <Button variant="tertiary" size="xl" fullWidth onPress={() => nav.push('earningsActivity')}>
            {PAYOUT.noLines.action}
          </Button>
        </View>
      ) : (
        <View style={{ gap: space['3'] }} testID="payout-lines">
          <SectionTitle>{PAYOUT.linesHeading}</SectionTitle>
          <Body secondary>{PAYOUT.linesNote}</Body>
          {(expanded ? p.entries : p.entries.slice(0, SHOWN_LINES)).map((entry) => (
            <EntryRow key={entry.id} entry={entry} when="day" onPress={() => nav.push('earningsLine', { entry, from: 'payout' })} />
          ))}
          {p.entries.length > SHOWN_LINES ? (
            expanded ? (
              <Body secondary>{`Showing all ${p.entries.length} lines`}</Body>
            ) : (
              <Button variant="tertiary" size="xl" fullWidth onPress={() => setExpanded(true)} testID="payout-show-all">
                {`Show all ${p.entries.length} lines`}
              </Button>
            )
          ) : null}
        </View>
      )}
    </Frame>
  );
}

function problemTitle(p: PayoutDetail): string {
  return p.state === 'FAILED' ? 'This payout didn’t go through' : 'This payout is on hold';
}

/** Card order (EA/PayoutStates): "Reason given:" first, then the money, then what to do. */
function problemLines(p: PayoutDetail, fix: boolean): string[] {
  const reason = p.state === 'FAILED' ? p.failure_message : p.hold_reason;
  const out: string[] = [];
  if (reason) out.push(`Reason given: ${reason}`);
  if (p.state === 'FAILED') {
    out.push('The money is back in your balance and goes into the next Monday payout.');
    out.push(fix ? 'Stripe says your payout account needs attention. Fix it first, or the next payout won’t go through either.' : 'Your payout account needs nothing from you right now.');
  } else {
    out.push('Once the hold is lifted, it goes out on the next Monday payout. Your earnings are safe.');
    out.push(fix ? 'Stripe says your payout account needs attention.' : 'Your payout account needs nothing from you right now.');
    out.push(PAYOUT.heldLine);
  }
  return out;
}

function calmLines(p: PayoutDetail): string[] {
  if (p.state === 'PAID') {
    return p.paid_at
      ? [`Paid out through Stripe on ${longDayLabel(p.paid_at)}. Stripe sends it to your bank on its own schedule.`]
      : ['Stripe sends it to your bank on its own schedule.'];
  }
  if (p.state === 'FAILED' || p.state === 'HELD') return [];
  return CALM_NOTES[p.state];
}

/* =========================================================================== shared helpers */

/** A neutral note whose first sentence is its title (the boards draw no separate heading). */
function Explainer({ lines, testID }: { lines: string[]; testID: string }): React.ReactElement | null {
  if (lines.length === 0) return null;
  const [title, ...rest] = lines;
  return <Banner variant="neutral" title={title!} description={rest.length ? rest.join('\n') : undefined} testID={testID} />;
}

function KeyMoney({
  label,
  sub,
  cents,
  sign,
  strong = false,
  quiet = false,
  testID,
}: {
  label: string;
  sub?: string;
  cents: Cents;
  sign?: 'always';
  strong?: boolean;
  quiet?: boolean;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space['3'] }}>
      <View style={{ flex: 1 }}>
        <Text style={[typeStyle(theme, strong ? 'heading.sm' : 'body.lg'), { color: quiet ? theme.color.text.secondary : theme.color.text.primary }]}>{label}</Text>
        {sub ? <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{sub}</Text> : null}
      </View>
      <Price cents={cents} size={strong ? 'lg' : 'md'} sign={sign ?? 'auto'} testID={testID} />
    </View>
  );
}

function PausedBlock({ copy, onAccount, testID }: { copy: StateCopy; onAccount: () => void; testID: string }): React.ReactElement {
  return (
    <View style={{ gap: space['4'] }} testID={testID}>
      {/* ds-request(native): ErrorState rider variant (lock icon) — EA Activity-not-active / Payout-not-active */}
      <ErrorState variant="inline" title={copy.title} description={copy.body} />
      <Button variant="primary" size="xl" fullWidth onPress={onAccount}>
        {copy.action ?? 'Go to Account'}
      </Button>
    </View>
  );
}

function ScreenError({ copy, rateLimited, onRetry, testID }: { copy: StateCopy; rateLimited: boolean; onRetry: () => void; testID: string }): React.ReactElement {
  const waiting = useCooldown(rateLimited);
  return (
    <View style={{ gap: space['4'] }} testID={testID}>
      {/* ds-request(native): ErrorState rider variant (role=alert on heading + message, action in the bottom third) — EA *-error / *-rate-limited */}
      <ErrorState variant="inline" title={copy.title} description={copy.body} />
      {rateLimited ? <Body>{RATE_LIMITED_WAIT}</Body> : null}
      <Button variant="primary" size="xl" fullWidth disabled={waiting} onPress={onRetry} testID={`${testID}-retry`}>
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
  copy: { more: string; loading: string; error: StateCopy; end: string };
  testID: string;
}): React.ReactElement | null {
  if (!hasMore) return <Body secondary>{copy.end}</Body>;
  // Older lines are not loadable offline (EA Activity-offline): the button waits for the network.
  if (!online) return null;
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

function Frame({
  title,
  subtitle,
  back,
  footer,
  testID,
  children,
}: {
  title: string;
  subtitle?: string;
  back: { onPress: () => void; previousTitle: string };
  footer?: React.ReactNode;
  testID: string;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID={testID}>
      {/* ds-request(native): AppBar tone="field" (56px back target) — EA boards */}
      <AppBar title={title} subtitle={subtitle} back={back} />
      <ScrollView contentContainerStyle={{ padding: space['5'], gap: space['5'] }}>{children}</ScrollView>
      {footer ? (
        <View
          style={{
            paddingHorizontal: space['5'],
            paddingTop: space['3'],
            paddingBottom: space['5'],
            borderTopWidth: 1,
            borderTopColor: theme.color.border.decorative,
            backgroundColor: theme.color.surface.base,
          }}
        >
          {footer}
        </View>
      ) : null}
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

function Body({ children, secondary = false, testID }: { children: React.ReactNode; secondary?: boolean; testID?: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <Text style={[typeStyle(theme, 'body.lg'), { color: secondary ? theme.color.text.secondary : theme.color.text.primary }]} testID={testID}>
      {children}
    </Text>
  );
}

/** A polite status line for screen readers ("Loading earnings activity"); not drawn on the boards. */
function LiveStatus({ text }: { text: string }): React.ReactElement {
  return (
    <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', opacity: 0 }}>
      {text}
    </Text>
  );
}
