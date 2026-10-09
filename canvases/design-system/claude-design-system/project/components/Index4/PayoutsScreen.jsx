const { DataTable, Price, Badge, Button, Icon } = window.HalalGoesDesignSystem_d11a47;

/* K-29: Payout{period, amount_cents, entry_count, state, hold_reason, failure_message, paid_at}.
   Payouts go out weekly on Monday (claims.ts MONEY.payoutDay, S-04). No gross, commission or
   statement: the contract has none of them. Readiness comes from GET /v1/connect/status. */
const PAYOUT_BADGE = {
  DRAFT: ['neutral', 'Accruing'], READY: ['neutral', 'Scheduled for Monday'], TRANSFERRING: ['info', 'On its way'],
  TRANSFERRED: ['info', 'Sent to bank'], PAID: ['neutral', 'Paid'], HELD: ['warning', 'Held'], FAILED: ['danger', 'Failed'],
};

function PayoutsScreen({ state, variant }) {
  if (variant === 'not-enabled') {
    return (
      <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: 720 }}>
        <GapBanner tone="warning" title="Payouts are not enabled yet"
          action={<Button size="sm" iconEnd="chevron-right">Finish Stripe setup</Button>}>
          Stripe still needs a few details before it can send your money (payouts_enabled is false). Nothing can be paid out until setup is complete.
        </GapBanner>
        <GapEmptyState icon="clock" title="No payouts yet" />
      </div>
    );
  }
  return (
    <Stateful state={state}
      loading={<GapSkeleton rows={3} height={48} />}
      empty={<GapEmptyState icon="clock" title="No payouts yet" body="Your first payout is sent on the Monday after the week of your first order." />}
      error={<GapErrorState title="Couldn't load payouts" body="Your payouts are not affected. Try again." onRetry={() => {}} />}>
      <div style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: 1040 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--space-4)' }}>
          <GapStat label="Next payout" sub="Monday · for 7–13 Sept"><Price cents={PAYOUTS[0].amount_cents} size="xl" /></GapStat>
          <GapStat label="Paid to" sub={'Weekly, every Monday'}>
            <span style={{ fontSize: 'var(--type-heading-lg-size)', fontWeight: 600, fontVariantNumeric: 'var(--numeric-tabular)' }}>Bank •••• {CONNECT.bank_last4}</span>
          </GapStat>
        </div>
        <DataTable caption="Payouts, newest first" hideCaption density="comfortable" rows={PAYOUTS} columns={[
          { key: 'period', label: 'Period' },
          { key: 'entry_count', label: 'Entries', align: 'end', numeric: true },
          { key: 'amount', label: 'Amount', align: 'end', numeric: true, render: r => <Price cents={r.amount_cents} size="sm" /> },
          { key: 'state', label: 'Status', render: r => (
            <div style={{ display: 'grid', gap: 2, whiteSpace: 'normal', maxWidth: 320 }}>
              <span><Badge variant={PAYOUT_BADGE[r.state][0]} size="sm">{PAYOUT_BADGE[r.state][1]}</Badge></span>
              {r.hold_reason && <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>{r.hold_reason}</span>}
              {r.failure_message && <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>{r.failure_message} — update your bank details in Stripe.</span>}
              {r.paid_at && <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{r.paid_at}</span>}
            </div>) },
        ]} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--type-caption-size)' }}>
          <Icon name="info" size="sm" /> Amounts are computed by HalalGoes from your settled orders. Entries are the ledger lines in the period.
        </div>
      </div>
    </Stateful>
  );
}
Object.assign(window, { PayoutsScreen });
