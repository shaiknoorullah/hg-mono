/* Earnings (EarningsSummary) and Payout detail (Payout). K-39: payout day comes from next_payout_at
   (weekly, Monday: claims.ts MONEY.payoutDay, S-04); unpaid_balance_cents is shown as given; the
   payouts list links to Payout detail; HELD and FAILED are designed. Every amount is a server value;
   the kit sums nothing. The hand-drawn bar chart is gone (K-05): days are list rows. */
const { Price, Badge, Card, Button } = window.HalalGoesDesignSystem_d11a47;

const EARN_VARIANTS = [
  { id: 'normal', label: 'All payouts paid' },
  { id: 'HELD', label: 'Latest payout HELD' },
  { id: 'FAILED', label: 'Latest payout FAILED' },
];
const PAYOUT_VARIANTS = [
  { id: 'PAID', label: 'PAID' }, { id: 'TRANSFERRING', label: 'TRANSFERRING' },
  { id: 'HELD', label: 'HELD (hold_reason)' }, { id: 'FAILED', label: 'FAILED (failure_message)' },
];
const HELD_REASON = 'Held while support reviews a delivery from 19 Sept. It is released on the next Monday run once the review closes.';
const FAILED_MSG = 'Your bank rejected the transfer (account closed). Update your bank details in Stripe.';

function payoutFor(v) {
  const p = PAYOUTS[0];
  if (v === 'HELD') return { ...p, state: 'HELD', paid_at: null, hold_reason: HELD_REASON };
  if (v === 'FAILED') return { ...p, state: 'FAILED', paid_at: null, failure_message: FAILED_MSG };
  if (v === 'TRANSFERRING') return { ...p, state: 'TRANSFERRING', paid_at: null };
  return p;
}

function EarningsScreen({ variant, state, go }) {
  const e = EARNINGS;
  const payouts = variant === 'normal' ? PAYOUTS : [payoutFor(variant), ...PAYOUTS.slice(1)];
  const body = () => {
    if (state === 'loading') return <GapSkeleton rows={3} />;
    if (state === 'error') return <GapErrorState title="Couldn’t load earnings" body="Your earnings are safe; we just couldn’t show them. Try again." />;
    if (state === 'empty') return <GapEmptyState icon="orders" title="No earnings yet this week" body="Deliveries you complete show here the same day. Payouts go out every Monday." action="Go online" onAction={() => go('home')} />;
    return (
      <>
        {variant === 'HELD' && <GapBanner tone="warning" title="A payout is on hold">{HELD_REASON}</GapBanner>}
        {variant === 'FAILED' && <GapBanner tone="warning" title="A payout didn’t go through" action={<Button size="sm" variant="secondary">Fix</Button>}>{FAILED_MSG}</GapBanner>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <GapStat label="Unpaid balance" sub="Next payout Mon 5 Oct"><Price cents={e.unpaid_balance_cents} size="lg" onDark /></GapStat>
          <GapStat label="This week" sub={e.total.trips + ' trips · ' + hoursText(e.total.online_seconds)}><Price cents={e.total.gross_cents} size="lg" onDark /></GapStat>
        </div>
        <Card variant="outlined" radius="lg">
          <SectionLabel>By day</SectionLabel>
          {e.buckets.map(([k, d, cents, trips]) => (
            <GapListRow key={k} title={d} sub={<span style={{ color: 'var(--text-primary)' }}>{trips} trips</span>} right={<Price cents={cents} size="md" onDark />} />
          ))}
        </Card>
        <Card variant="outlined" radius="lg">
          <SectionLabel>Payouts · weekly, every Monday</SectionLabel>
          {payouts.map(p => (
            <GapListRow key={p.id} title={p.period_start + ' – ' + p.period_end}
              sub={<span style={{ color: 'var(--text-primary)' }}>{p.entry_count} entries{p.paid_at ? ' · paid ' + p.paid_at : ''}</span>}
              right={<span style={{ display: 'grid', justifyItems: 'end', gap: 4 }}><Price cents={p.amount_cents} size="md" onDark /><Badge variant={PAYOUT_TONE[p.state]} size="sm">{PAYOUT_LABEL[p.state]}</Badge></span>}
              onClick={() => go('payout', p.state === 'PAID' ? 'PAID' : p.state)} />
          ))}
        </Card>
      </>
    );
  };
  return (
    <RiderScreen title="Earnings" subtitle="Week of 22 Sept 2026" tab="earnings" go={go}>
      <Pad>{body()}</Pad>
    </RiderScreen>
  );
}

function PayoutDetailScreen({ variant, state, go }) {
  const p = payoutFor(variant);
  return (
    <RiderScreen title="Payout" subtitle={p.period_start + ' – ' + p.period_end} onBack={() => go('earnings')} backLabel="Back to Earnings">
      <Pad>
        {state === 'loading' ? <GapSkeleton rows={2} />
          : state === 'error' ? <GapErrorState title="Couldn’t load this payout" body="Try again. If it keeps failing, contact support with the payout id." code={p.id} />
          : (
            <>
              {p.state === 'HELD' && <GapBanner tone="warning" title="On hold">{p.hold_reason}</GapBanner>}
              {p.state === 'FAILED' && <GapBanner tone="warning" title="Transfer failed" action={<Button size="sm" variant="secondary">Update bank</Button>}>{p.failure_message}</GapBanner>}
              {p.state === 'TRANSFERRING' && <GapBanner tone="info" title="On its way">Stripe is sending this to your bank. It usually lands within 2 business days.</GapBanner>}
              <div style={{ display: 'grid', gap: 4 }}>
                <Price cents={p.amount_cents} size="xl" onDark />
                <span><Badge variant={PAYOUT_TONE[p.state]}>{PAYOUT_LABEL[p.state]}</Badge></span>
              </div>
              <Card variant="outlined" radius="lg">
                <GapKeyValue labelWidth={110} rows={[
                  ['Period', p.period_start + ' – ' + p.period_end], ['Entries', String(p.entry_count)],
                  ['Paid', p.paid_at || 'Not yet'], ['Payout id', p.id, { mono: true }],
                ]} />
              </Card>
              <Body muted>The entries are the deliveries, tips and adjustments that make up this amount. Totals are computed by HalalGoes, not by the app.</Body>
            </>
          )}
      </Pad>
    </RiderScreen>
  );
}

Object.assign(window, { EarningsScreen, PayoutDetailScreen, EARN_VARIANTS, PAYOUT_VARIANTS });
