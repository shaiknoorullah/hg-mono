/**
 * One payout in the panel beside the history (canvas `PY` `PayoutDetail-*`). The amount is the
 * server's `amount_cents` on the payout row, the words around it depend only on its state, and
 * nothing here adds, subtracts or splits money: the contract has no per-order entries for a
 * restaurant payout (no `entries`, no reversal or adjustment lines), so the "includes a failed
 * payout" and "includes an adjustment" boards are not drawn (see the pull request).
 */
import { Badge, Button, Disclosure, KeyValueList, Price } from '../ds';
import { detailView, failText, holdText, neededCount, payoutCents, periodLabel, requirementGroups, stateView, longDate, type ConnectStatus, type Payout } from './model';

export interface LiveNotice {
  title: string;
  body: string;
}

export function PayoutDetail({
  payout,
  timezone,
  connect,
  live,
  onSupport,
  onFinishSetup,
  finishBusy,
}: {
  payout: Payout;
  timezone: string;
  connect: ConnectStatus | null;
  live: LiveNotice | null;
  onSupport: () => void;
  onFinishSetup: () => void;
  finishBusy: boolean;
}) {
  const v = detailView(payout, timezone);
  const s = stateView(payout.state);
  const amount = payoutCents(payout.amount_cents);
  const hold = payout.state === 'HELD' ? holdText(payout) : null;
  const fail = payout.state === 'FAILED' ? failText(payout) : null;
  // The Stripe block is only about the account, so it shows only while Stripe has payouts off.
  const setup = payout.state === 'HELD' && connect && !connect.payouts_enabled ? connect : null;

  return (
    <div className="flex flex-col gap-4" data-testid="payout-detail" data-state={payout.state}>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {live ? `${live.title}. ${live.body}` : ''}
      </div>
      {live ? (
        <div className="flex flex-col gap-1 rounded-md border border-feedback-info-border bg-feedback-info-tint p-3" data-testid="payout-live">
          <strong className="text-label-lg">{live.title}</strong>
          <span className="text-body-md">{live.body}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-body-sm text-fg-secondary">{v.amountLabel}</span>
        {amount !== null ? <Price cents={amount} size="xl" /> : <span className="text-heading-lg" data-testid="amount-missing">Amount not given</span>}
        <div>
          <Badge label={s.label} variant={s.tone} icon={s.icon} size="md" />
        </div>
        <p className="m-0 text-body-md">{v.sentence}</p>
      </div>

      {fail ? (
        <section aria-labelledby="why-failed" className="flex flex-col gap-2 rounded-md border border-feedback-danger-border bg-feedback-danger-tint p-3" data-testid="why-failed">
          <h3 id="why-failed" className="m-0 text-heading-sm">
            Why it failed
          </h3>
          <p className="m-0 text-body-md">{fail.text}</p>
          <p className="m-0 text-body-md">
            {fail.recorded
              ? 'This amount went back into your balance and will be included in a later payout once your bank details are fixed.'
              : "Contact support and we'll find out and tell you what to do. The money went back into your balance and is paid in a later payout."}
          </p>
          <p className="m-0 text-body-md">This payout keeps showing Failed. The later payout that includes this amount says so.</p>
          {fail.recorded ? (
            <p className="m-0 text-body-md">
              <strong>What you can do:</strong> contact support to fix the bank details on your payout account.
            </p>
          ) : null}
          <div>
            <Button variant="primary" size="md" onPress={onSupport}>
              Contact support
            </Button>
          </div>
        </section>
      ) : null}

      {hold ? (
        <section aria-labelledby="why-held" className="flex flex-col gap-2 rounded-md border border-feedback-warning-border bg-feedback-warning-tint p-3" data-testid="why-held">
          <h3 id="why-held" className="m-0 text-heading-sm">
            Why it's on hold
          </h3>
          <p className="m-0 text-body-md" data-testid="hold-reason" data-recorded={hold.recorded}>
            {hold.text}
          </p>
          {setup ? <SetupBlock connect={setup} timezone={timezone} busy={finishBusy} onFinish={onFinishSetup} /> : null}
          {!setup ? (
            <div>
              <Button variant="tertiary" size="md" onPress={onSupport}>
                Contact support
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <KeyValueList
        testId="payout-facts"
        rows={[
          { key: 'period', label: 'Period', value: periodLabel(payout.period_start, payout.period_end, timezone) },
          { key: 'paid', label: 'Paid into your bank', value: v.paid },
          { key: 'currency', label: 'Currency', value: payout.currency },
          {
            key: 'entries',
            label: 'Entries in this payout',
            value:
              typeof payout.entry_count === 'number' ? (
                <span className="flex flex-col">
                  <span>{payout.entry_count}</span>
                  <span className="text-body-sm font-normal text-fg-secondary">Settled orders and adjustments</span>
                </span>
              ) : (
                <span className="flex flex-col">
                  <span>Not given</span>
                  <span className="text-body-sm font-normal text-fg-secondary">HalalGoes didn't send a count for this payout. The amount is still exact.</span>
                </span>
              ),
          },
          { key: 'ref', label: 'Payout reference', value: <span className="break-all font-mono">{payout.id}</span> },
        ]}
      />
    </div>
  );
}

function SetupBlock({ connect, timezone, busy, onFinish }: { connect: ConnectStatus; timezone: string; busy: boolean; onFinish: () => void }) {
  const n = neededCount(connect);
  const past = connect.requirements.past_due.length;
  const deadline = connect.requirements.deadline ? longDate(connect.requirements.deadline, timezone) : null;
  const groups = requirementGroups(connect, timezone);
  return (
    <div className="flex flex-col gap-2" data-testid="held-setup">
      <p className="m-0 text-body-md">
        {n > 0 ? `Stripe needs ${n === 1 ? '1 thing' : `${n} things`}${deadline ? ` by ${deadline}` : ''}. ` : ''}
        {past > 0 ? `${past} past due. ` : ''}This applies to your whole payout account, not just this payout.
      </p>
      {past > 0 ? <p className="m-0 text-body-md">Why payouts are off: something Stripe asked for is past its due date.</p> : null}
      <div>
        <Button variant="primary" size="md" loading={busy} onPress={onFinish}>
          Finish payout setup in Stripe
        </Button>
      </div>
      {groups.length > 0 ? (
        <Disclosure summary="Stripe's exact list">
          <div className="flex flex-col gap-2">
            <span className="text-body-sm text-fg-secondary">Stripe explains each item when you open it. The Stripe reference is for HalalGoes support.</span>
            {groups.map((g) => (
              <div key={g.key} className="flex flex-col gap-1">
                <span className="text-label-lg">{g.title}</span>
                {g.items.map((it) => (
                  <span key={it.code} className="flex flex-col">
                    <span>{it.words}</span>
                    <span className="text-body-sm text-fg-secondary">
                      Stripe reference: <span lang="zxx" className="font-mono">{it.code}</span>
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
