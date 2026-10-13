/**
 * Payout sent: the weekly payout reached the partner's bank account provider.
 *
 * `Amount` arrives already formatted from integer cents by the Go service
 * (money is int64 minor units everywhere: AGENTS.md "Non-negotiable
 * invariants" #3), and `SentAt` in 12-hour time (docs/decisions/README.md,
 * "Time format"). A template never does arithmetic.
 */
import { Layout, Note, P } from '../components/Layout.js';
import { defineTemplate } from '../define.js';

/** The notice that a payout left for the restaurant or rider. */
export const payoutSent = defineTemplate({
  name: 'payout_sent',
  vars: ['PayeeName', 'Amount', 'PeriodText', 'SentAt'] as const,
  subject: (v) => `HalalGoes sent you ${v.Amount}`,
  render: (v) => (
    <Layout preview={`Your payout of ${v.Amount} for ${v.PeriodText} is on its way.`} heading="Your payout is on its way">
      <P>We sent a HalalGoes payout. It can take a few business days to show in your bank account.</P>
      <Note label="Payout">
        {v.Amount} to {v.PayeeName}
        <br />
        For {v.PeriodText}
        <br />
        Sent {v.SentAt}
      </Note>
      <P muted>You can see this payout, and the orders in it, under Payouts in HalalGoes.</P>
    </Layout>
  ),
});

/**
 * Payout held: Stripe has payouts turned off for the partner until they give
 * it something more. The email names no Stripe requirement code; the payout
 * setup screen shows what is due.
 */
export const payoutHeld = defineTemplate({
  name: 'payout_held',
  vars: ['PayeeName', 'Amount', 'PeriodText'] as const,
  subject: (v) => `Your HalalGoes payout of ${v.Amount} is on hold`,
  render: (v) => (
    <Layout preview={`Your payout of ${v.Amount} for ${v.PeriodText} is on hold.`} heading="Your payout is on hold">
      <P>
        Stripe, who pays out for HalalGoes, needs more information from you before we can send this
        payout. Nothing you earned is lost: it is kept for you.
      </P>
      <Note label="Payout on hold">
        {v.Amount} to {v.PayeeName}
        <br />
        For {v.PeriodText}
      </Note>
      <P>Sign in to HalalGoes and finish your payout setup. We pay you on the next payout run after that.</P>
    </Layout>
  ),
});

/**
 * Payout failed: the payout did not reach the partner. `NextStep` is one of a
 * few fixed sentences the Go service chooses (services/hg/internal/notify/messages.go,
 * PayoutFailed): what happens next, never Stripe's own error text.
 */
export const payoutFailed = defineTemplate({
  name: 'payout_failed',
  vars: ['PayeeName', 'Amount', 'PeriodText', 'NextStep'] as const,
  subject: (v) => `Your HalalGoes payout of ${v.Amount} did not reach you`,
  render: (v) => (
    <Layout preview={`Your payout of ${v.Amount} for ${v.PeriodText} did not reach you.`} heading="Your payout did not reach you">
      <Note label="Payout">
        {v.Amount} to {v.PayeeName}
        <br />
        For {v.PeriodText}
      </Note>
      <P>{v.NextStep}</P>
      <P muted>You can see this payout under Payouts in HalalGoes.</P>
    </Layout>
  ),
});
